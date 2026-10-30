import type { Store } from '../storage/store'
import type { CollectionPath, Collections, SyncRecord } from './types'

// Een groep wijzigingen over meerdere bestanden in één keer opslaan, met ongedaan maken: elke vorige versie komt terug
// met een latere updatedAt (of wat nieuw was, wordt een tombstone).

export type Undo = () => Promise<void>

export type Change = { [P in CollectionPath]: { path: P; before: Collections[P] | null; after: Collections[P] } }[CollectionPath]

/** Een tijd die later is dan `iso` en dan nu (een record kan van een apparaat met een voorlopende klok komen). */
export function later(iso: string): string {
  return new Date(Math.max(Date.now(), Date.parse(iso) + 1)).toISOString()
}

function putGroup(store: Store, path: CollectionPath, records: SyncRecord[]): Promise<void> {
  // Alle records hieronder zijn records van dit pad (voor of na de wijziging).
  return store.putMany(path, records as Collections[typeof path][])
}

/** Wijzigingen opslaan, per bestand in één keer; ongedaan maken zet elke vorige versie terug (of verwijdert wat nieuw was). */
export async function applyChanges(store: Store, changes: readonly Change[], sync = true): Promise<Undo> {
  const byPath = new Map<CollectionPath, Change[]>()
  for (const c of changes) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c])
  for (const [path, list] of byPath) await putGroup(store, path, list.map((c) => c.after))
  if (sync && changes.length > 0) void store.sync()
  return async () => {
    for (const [path, list] of byPath) {
      const back = list.map((c) => {
        const at = later(c.after.updatedAt)
        return c.before ? { ...c.before, updatedAt: at } : { ...c.after, updatedAt: at, deletedAt: at }
      })
      await putGroup(store, path, back)
    }
    if (changes.length > 0) void store.sync()
  }
}

export function bothUndo(...undos: Undo[]): Undo {
  return async () => {
    for (const undo of [...undos].reverse()) await undo()
  }
}

/**
 * Wat een handeling in deze bestanden veranderde (vergeleken op updatedAt), als ongedaan maken: vorige versies terug,
 * nieuwe records weg. Voor handelingen die zelf geen lijst van wijzigingen bijhouden (de agenda die een trip volgt).
 */
export async function undoableIn(store: Store, paths: readonly CollectionPath[], action: () => Promise<void>): Promise<Undo> {
  const before = new Map(paths.map((path) => [path, new Map(store.get(path).map((r) => [r.id, r as SyncRecord]))]))
  await action()
  const changed = paths.map((path) => ({ path, records: store.get(path).filter((r) => before.get(path)!.get(r.id)?.updatedAt !== r.updatedAt) as SyncRecord[] }))
  return async () => {
    for (const { path, records } of changed) {
      if (records.length === 0) continue
      const old = before.get(path)!
      await putGroup(
        store,
        path,
        records.map((r) => {
          const prev = old.get(r.id)
          const at = later(r.updatedAt)
          return prev ? { ...prev, updatedAt: at } : { ...r, updatedAt: at, deletedAt: at }
        }),
      )
    }
  }
}
