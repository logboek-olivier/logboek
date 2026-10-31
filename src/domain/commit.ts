import type { CollectionPath, SyncRecord } from '../model/types'
import type { Store } from '../storage/store'
import { tombstone } from './tombstone'
import { Tx } from './tx'

// De enige poort naar de opslag (docs/FUNDERING.md). Een opdracht werkt op een transactie; `commit` legt die in één keer
// vast: alle bestanden en de outbox samen, of niets. Daarna kan de opdracht ongedaan gemaakt worden, als eigen opdracht:
// per veld komt de waarde van vooraf terug, alleen waar nog staat wat de opdracht schreef (zie `reverted`).

export type Undo = () => Promise<void>

/** Eén record dat een opdracht veranderde: de versie vooraf (null = nieuw) en de vastgelegde versie. */
export interface Written {
  path: CollectionPath
  before: SyncRecord | null
  after: SyncRecord
}

export interface Committed<T> {
  result: T
  undo: Undo
  written: Written[]
}

/**
 * Opdrachten op dezelfde Store na elkaar: een opdracht leest nooit een toestand die een andere net aan het schrijven is.
 * Is er geen opdracht bezig, dan begint deze meteen (niet pas na een tik van de event-loop): zo is een opdracht die
 * vóór het vergrendelen begon, echt begonnen, en wordt hij afgemaakt.
 */
const queues = new WeakMap<Store, { tail: Promise<unknown>; pending: number }>()

function serial<T>(store: Store, task: () => Promise<T>): Promise<T> {
  const queue = queues.get(store) ?? { tail: Promise.resolve(), pending: 0 }
  queues.set(store, queue)
  const next = queue.pending === 0 ? task() : queue.tail.then(task, task)
  queue.pending++
  const done = () => {
    queue.pending--
  }
  queue.tail = next.then(done, done)
  return next
}

/** Zelfde inhoud (los van updatedAt): dan valt er niets te schrijven. */
function same(a: SyncRecord | undefined, b: SyncRecord): boolean {
  if (!a) return false
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })
}

/** De opdracht `name` uitvoeren en in één keer vastleggen. */
export function commit<T>(store: Store, name: string, work: (tx: Tx) => Promise<T> | T): Promise<Committed<T>> {
  void name
  return serial(store, async () => {
    const tx = new Tx(store, new Date().toISOString())
    const result = await work(tx)
    const written: Written[] = []
    const entries: Array<{ path: CollectionPath; records: SyncRecord[] }> = []
    for (const { path, records } of tx.entries()) {
      const current = new Map(tx.base(path).map((r) => [r.id, r as SyncRecord]))
      const changed = records.filter((r) => !same(current.get(r.id), r))
      if (changed.length === 0) continue
      for (const r of changed) written.push({ path, before: current.get(r.id) ?? null, after: r })
      entries.push({ path, records: changed })
    }
    // De vastgelegde versies (de Store kan updatedAt net later zetten dan een versie met een tijd in de toekomst).
    const final = new Map<string, SyncRecord>()
    if (entries.length > 0) for (const { path, records } of await tx.write(entries)) for (const r of records) final.set(`${path}\n${r.id}`, r)
    const stored = written.map((w) => ({ ...w, after: final.get(`${w.path}\n${w.after.id}`) ?? w.after }))
    for (const followUp of tx.followUps()) await followUp().catch(() => undefined)
    return { result, undo: undoFor(store, stored), written: stored }
  })
}

/** Een opdracht uitvoeren; geeft ongedaan maken terug. */
export async function run(store: Store, name: string, work: (tx: Tx) => Promise<unknown> | unknown): Promise<Undo> {
  return (await commit(store, name, work)).undo
}

function undoFor(store: Store, written: readonly Written[]): Undo {
  if (written.length === 0) return async () => {}
  return async () => {
    await commit(store, 'ongedaanMaken', async (tx) => {
      for (const w of written) {
        const current = tx.get(w.path).find((r) => r.id === w.after.id)
        const back = current ? reverted(current, w, tx.now) : null
        if (back) await tx.put(w.path, back as never)
      }
    })
  }
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Ongedaan maken per veld: alleen wat de opdracht veranderde, en alleen waar het nog staat zoals de opdracht het
 * achterliet. Een latere wijziging (hier of op een ander apparaat) aan hetzelfde of een ander veld blijft staan. Een
 * record dat de opdracht nieuw maakte, gaat weer weg. Null: niets terug te zetten.
 */
function reverted(current: SyncRecord, w: Written, now: string): SyncRecord | null {
  if (!w.before) return current.deletedAt === null ? tombstone(w.path, current, now) : null
  const before = w.before as unknown as Record<string, unknown>
  const after = w.after as unknown as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  let changed = false
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updatedAt' || equal(before[key], after[key]) || !equal(next[key], after[key])) continue
    if (before[key] === undefined) delete next[key]
    else next[key] = before[key]
    changed = true
  }
  return changed ? ({ ...next, updatedAt: now } as unknown as SyncRecord) : null
}
