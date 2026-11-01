import { addDays } from '../basis/datum'
import { HISTORY_DAYS, HISTORY_PATH } from '../domain/history'
import type { Reader } from '../domain/tx'
import { tripRange } from './calendar'
import { active } from './derive'
import type { CollectionPath, HistoryChange, HistoryEntry, Leg, Participant, SyncRecord, Transaction, Trip } from './types'

// De prullenbak (Meer → Prullenbak): wat in de laatste 30 dagen verwijderd werd, terug te zetten met wat eraan hing.
// Alles komt uit de geschiedenis (history.json.enc): één regel per verwijderopdracht. Wat verwijderd werd vóór de
// geschiedenis bestond, komt uit de tombstones (die houden hun inhoud): die van dezelfde opdracht hebben dezelfde tijd.

export type TrashKind = 'periode' | 'dag' | 'geld' | 'deelnemer' | 'plaats' | 'boot' | 'document'

export interface TrashItem {
  key: string
  kind: TrashKind
  /** Naam van wat verwijderd werd (periode, plaats, boot, document) of de dag/het geld zelf. */
  title: string
  /** Datum waar het om gaat (dag, geld), of de periode. */
  date: string | null
  deletedAt: string
  /** Tot dan terug te zetten. */
  until: string
  /** Wat er mee terugkomt. */
  counts: { days: number; money: number; participants: number }
  /** Uit de geschiedenis, of losse tombstones van vóór de geschiedenis. */
  entry: HistoryEntry | null
  legacy: Array<{ path: CollectionPath; record: SyncRecord }>
}

/** Verwijderopdrachten en wat ze in de prullenbak zijn. */
const DELETE_COMMANDS: Record<string, TrashKind> = {
  periodeVerwijderen: 'periode',
  // Vervangen en samenvoegen halen ook een periode weg (zijn dagen gaan naar de andere): terugzetten splitst ze weer.
  periodeVervangen: 'periode',
  samenvoegen: 'periode',
  landperiodeVerwijderen: 'periode',
  dagVerwijderen: 'dag',
  geldVerwijderen: 'geld',
  declaratieVerwijderen: 'geld',
  deelnemerVerwijderen: 'deelnemer',
  plaatsVerwijderen: 'plaats',
  bootVerwijderen: 'boot',
  documentVerwijderen: 'document',
}

const DAY_MS = 86_400_000

export function trashUntil(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + HISTORY_DAYS * DAY_MS).toISOString()
}

function recent(at: string, now: string): boolean {
  const age = Date.parse(now) - Date.parse(at)
  return Number.isFinite(age) && age <= HISTORY_DAYS * DAY_MS
}

const deletedBy = (c: HistoryChange) => typeof c.after.deletedAt === 'string' && (c.before === null || !c.before.deletedAt)

function find(reader: Reader, path: string, id: string): SyncRecord | undefined {
  return reader.get(path as CollectionPath).find((r) => r.id === id)
}

/** De naam van een record zoals Olivier het kent: de versie vooraf uit de regel, aangevuld met de tombstone. */
function before(reader: Reader, change: HistoryChange): Record<string, unknown> {
  return { ...(find(reader, change.path, change.id) as unknown as Record<string, unknown> | undefined), ...(change.before ?? {}) }
}

function legLabel(leg: Partial<Leg>): string {
  const route = [leg.fromPlace, leg.toPlace].filter((x) => !!x?.trim()).join(' → ')
  return route || '—'
}

function moneyLabel(tx: Partial<Transaction>): string {
  return tx.note?.trim() || tx.category || tx.kind || '—'
}

function fromEntry(reader: Reader, entry: HistoryEntry): TrashItem | null {
  const kind = DELETE_COMMANDS[entry.command]
  if (!kind) return null
  const removed = entry.changes.filter(deletedBy)
  // Wat terugkomt: verwijderd, of (bij vervangen en samenvoegen) naar een andere periode verhuisd.
  const days = entry.changes.filter((c) => c.path === 'legs.json.enc' && (deletedBy(c) || 'tripId' in c.after)).length
  const money = entry.changes.filter((c) => (c.path === 'transactions.json.enc' || c.path === 'claims.json.enc') && (deletedBy(c) || 'tripId' in c.after)).length
  const item = (title: string, date: string | null, participants = 0): TrashItem => ({
    key: `h:${entry.id}`,
    kind,
    title,
    date,
    deletedAt: entry.at,
    until: trashUntil(entry.at),
    counts: { days, money, participants },
    entry,
    legacy: [],
  })
  if (kind === 'periode') {
    const main = removed.find((c) => c.path === 'trips.json.enc' || c.path === 'periods.json.enc')
    if (!main || find(reader, main.path, main.id)?.deletedAt == null) return null
    const record = before(reader, main)
    const participants = Array.isArray(record.participants) ? record.participants.length : 0
    return item(String(record.name ?? ''), typeof record.startDate === 'string' ? record.startDate : null, participants)
  }
  if (kind === 'deelnemer') {
    const trip = entry.changes.find((c) => c.path === 'trips.json.enc')
    const was = (trip?.before?.participants ?? []) as Participant[]
    const now = (trip?.after.participants ?? []) as Participant[]
    const gone = was.filter((p) => !now.some((q) => q.id === p.id))
    if (!trip || gone.length === 0) return null
    const current = find(reader, 'trips.json.enc', trip.id) as Trip | undefined
    // Al terug, of al bij een (andere) trip (een deelnemer hoort bij één trip), of de trip is weg: niet meer in de prullenbak.
    const placed = new Set(active(reader.get('trips.json.enc')).flatMap((t) => (t.participants ?? []).map((q) => q.id)))
    if (!current || current.deletedAt !== null || gone.every((p) => placed.has(p.id))) return null
    return item(`${gone.map((p) => p.firstName).join(', ')} · ${current.name}`, null)
  }
  if (kind === 'boot') {
    const name = entry.changes.map((c) => c.before?.boat).find((b): b is string => typeof b === 'string' && !!b)
    // Staat de boot alweer overal terug (zelf ingevuld, of een ander apparaat), dan valt er niets terug te zetten.
    const back = entry.changes.every((c) => (find(reader, c.path, c.id) as { boat?: string } | undefined)?.boat === c.before?.boat)
    if (!name || back) return null
    return item(name, null)
  }
  const main = removed[0]
  // Het record moet hier bestaan en nog verwijderd zijn (anders is er niets terug te zetten).
  if (!main || find(reader, main.path, main.id)?.deletedAt == null) return null
  const record = before(reader, main)
  if (kind === 'dag') return item(legLabel(record as Partial<Leg>), String(record.date ?? ''))
  if (kind === 'geld') return item(moneyLabel(record as Partial<Transaction>), String(record.date ?? ''))
  if (kind === 'plaats') return item(String(record.name ?? ''), null)
  return item(String(record.title ?? ''), null)
}

/** Paden waarvan een tombstone van vóór de geschiedenis in de prullenbak komt (met inhoud, niet geschoond). */
// Geen plaatsen (die verdwenen vooral door samenvoegen) en geen geld van een declaratie (dat volgt zijn declaratie).
// Planningen alleen samen met hun trip.
const LEGACY_PATHS: readonly CollectionPath[] = ['trips.json.enc', 'legs.json.enc', 'transactions.json.enc', 'plans.json.enc']

function legacyItems(reader: Reader, covered: ReadonlySet<string>, now: string, since: string | null): TrashItem[] {
  const groups = new Map<string, Array<{ path: CollectionPath; record: SyncRecord }>>()
  // Een import vervangt zijn dagen en ruimt zijn tochten op: wat op hetzelfde moment wegging, verwijderde Olivier niet.
  const imported = new Set(reader.get('legs.json.enc').filter((l) => l.deletedAt && l.source === 'import').map((l) => l.deletedAt!))
  for (const path of LEGACY_PATHS) {
    for (const record of reader.get(path)) {
      if (!record.deletedAt || !recent(record.deletedAt, now) || covered.has(`${path}\n${record.id}`)) continue
      // Alleen wat vóór de geschiedenis verwijderd werd (daarna heeft elke verwijdering een regel).
      if (since && record.deletedAt >= since) continue
      if (imported.has(record.deletedAt)) continue
      if (path === 'trips.json.enc' && !(record as Trip).name) continue
      if (path === 'transactions.json.enc' && ((record as Transaction).claimId || (record as Transaction).fixedCostId)) continue
      groups.set(record.deletedAt, [...(groups.get(record.deletedAt) ?? []), { path, record }])
    }
  }
  // Planningen alleen met hun trip; een groep met alleen planningen staat er niet.
  for (const [at, records] of groups) {
    const kept = records.some((r) => r.path === 'trips.json.enc') ? records : records.filter((r) => r.path !== 'plans.json.enc')
    if (kept.length > 0) groups.set(at, kept)
    else groups.delete(at)
  }
  return [...groups.entries()].map(([deletedAt, records]) => {
    const trip = records.find((r) => r.path === 'trips.json.enc')?.record as Trip | undefined
    const legs = records.filter((r) => r.path === 'legs.json.enc').map((r) => r.record as Leg)
    const money = records.filter((r) => r.path === 'transactions.json.enc').map((r) => r.record as Transaction)
    const kind: TrashKind = trip ? 'periode' : legs.length > 0 ? 'dag' : 'geld'
    const title = trip ? trip.name : legs[0] ? legLabel(legs[0]) : money[0] ? moneyLabel(money[0]) : ''
    const date = trip ? (tripRange(trip, reader.get('legs.json.enc'))?.start ?? null) : (legs[0]?.date ?? money[0]?.date ?? null)
    return {
      key: `l:${deletedAt}`,
      kind,
      title,
      date,
      deletedAt,
      until: trashUntil(deletedAt),
      counts: { days: legs.length, money: money.length, participants: trip?.participants?.length ?? 0 },
      entry: null,
      legacy: records,
    }
  })
}

/** Alles in de prullenbak, laatst verwijderd eerst. */
export function trashItems(reader: Reader, now = new Date().toISOString()): TrashItem[] {
  const entries = active(reader.get(HISTORY_PATH)).filter((e) => recent(e.at, now))
  const covered = new Set(entries.flatMap((e) => e.changes.map((c) => `${c.path}\n${c.id}`)))
  const fromHistory = entries.filter((e) => !e.undoneAt).flatMap((e) => fromEntry(reader, e) ?? [])
  // De oudste regel in de geschiedenis: wat daarna verwijderd werd zonder regel (vanzelf, of een import), hoort niet in de prullenbak.
  // Ook opgeruimde regels tellen: die gaven het begin van de geschiedenis aan.
  const all = reader.get(HISTORY_PATH)
  const since = all.length > 0 ? all.map((e) => e.at).sort()[0]! : null
  return [...fromHistory, ...legacyItems(reader, covered, now, since)].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** Het item in de prullenbak waarmee deze trip (op id) verwijderd werd, of undefined. Nooit op naam. */
export function trashItemForTrip(reader: Reader, tripId: string, now = new Date().toISOString()): TrashItem | undefined {
  return trashItems(reader, now).find(
    (i) =>
      i.kind === 'periode' &&
      (i.legacy.some((r) => r.path === 'trips.json.enc' && r.record.id === tripId) || !!i.entry?.changes.some((c) => c.path === 'trips.json.enc' && c.id === tripId && typeof c.after.deletedAt === 'string')),
  )
}

/**
 * Bij een periode van vóór de geschiedenis: geld rond de datums van de trip dat nu bij geen trip hoort (een periode aan
 * land of geen periode). Olivier vinkt zelf aan wat er terug moet; niets gaat vanzelf.
 */
export function relinkCandidates(reader: Reader, item: TrashItem): Transaction[] {
  const trip = item.legacy.find((r) => r.path === 'trips.json.enc')?.record as Trip | undefined
  if (!trip) return []
  const range = tripRange(trip, reader.get('legs.json.enc'))
  if (!range) return []
  const from = addDays(range.start, -60)
  const to = addDays(range.end, 14)
  const trips = new Set(active(reader.get('trips.json.enc')).map((x) => x.id))
  const moved = new Set(movedAway(reader, item).map((m) => m.record.id))
  return active(reader.get('transactions.json.enc'))
    .filter((tx) => tx.date >= from && tx.date <= to && !tx.claimId && !tx.fixedCostId && !(tx.tripId && trips.has(tx.tripId)) && !moved.has(tx.id))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Wat bij een andere trip hangt in plaats van bij deze (dagen, geld, studenten, planningen, declaraties). */
export interface MovedRecord {
  path: CollectionPath
  record: SyncRecord
  /** De trip waar het nu bij hangt. */
  tripId: string
}

const LINK: ReadonlyArray<{ path: CollectionPath; field: 'tripId' | 'weekId' }> = [
  { path: 'legs.json.enc', field: 'tripId' },
  { path: 'transactions.json.enc', field: 'tripId' },
  { path: 'students.json.enc', field: 'weekId' },
  { path: 'plans.json.enc', field: 'tripId' },
  { path: 'claims.json.enc', field: 'tripId' },
]

/**
 * Bij een periode van vóór de geschiedenis: wat bij het verwijderen naar een andere trip ging ("Meenemen naar trip …"
 * of "Vervangen"). Die opdracht gaf alles dezelfde tijd als de verwijderde trip; zo is het precies terug te vinden.
 */
export function movedAway(reader: Reader, item: TrashItem): MovedRecord[] {
  const trip = item.legacy.find((r) => r.path === 'trips.json.enc')?.record as Trip | undefined
  if (!trip) return []
  const out: MovedRecord[] = []
  for (const { path, field } of LINK) {
    for (const record of active(reader.get(path) as readonly SyncRecord[])) {
      const link = (record as unknown as Record<string, unknown>)[field]
      if (record.updatedAt === item.deletedAt && typeof link === 'string' && link !== trip.id) out.push({ path, record, tripId: link })
    }
  }
  return out
}
