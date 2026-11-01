// Opdrachten voor de prullenbak en de geschiedenis: terugzetten, en na 30 dagen definitief opruimen. Elke wijziging is
// een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { active } from '../model/derive'
import { currentSettings, saveSettings } from '../model/settings'
import { scrubbed } from '../model/students'
import { movedAway, trashItemForTrip, trashItems } from '../model/trash'
import type { CollectionPath, HistoryEntry, Participant, Student, SyncRecord, Trip } from '../model/types'
import { HISTORY_DAYS, HISTORY_PATH, revertChange } from './history'
import { tombstone } from './tombstone'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

const DAY_MS = 86_400_000

/**
 * Iets uit de prullenbak terugzetten, met wat eraan hing. Uit de geschiedenis per veld (een latere wijziging blijft
 * staan); van vóór de geschiedenis de tombstones van dezelfde opdracht. `relink`: wat Olivier aanvinkte om weer aan de
 * teruggezette trip te hangen (dagen en geld die bij het verwijderen naar een andere trip gingen, en geld rond de datums). Er verhuist niets anders: overlapt de periode nu met een andere, dan staat
 * dat in Nakijken. Geeft het aantal teruggezette records.
 */
export async function restoreTrash(tx: Tx, key: string, relink: readonly string[] = []): Promise<number> {
  const item = trashItems(tx, tx.now).find((i) => i.key === key)
  if (!item) return 0
  let count = 0
  const put = async (path: string, record: SyncRecord) => {
    await tx.put(path as CollectionPath, record as never)
    count++
  }
  if (item.entry) return revertEntry(tx, item.entry, item.kind === 'deelnemer')
  for (const { path, record } of item.legacy) {
    const current = tx.get(path).find((r) => r.id === record.id)
    if (current && current.deletedAt === record.deletedAt) await put(path, { ...current, deletedAt: null, updatedAt: tx.now })
  }
  const trip = item.legacy.find((r) => r.path === 'trips.json.enc')?.record
  if (trip) {
    const chosen = new Set(relink)
    const away = movedAway(tx, item)
    // Wat bij het verwijderen naar een andere trip ging, en geld dat Olivier aanvinkte: weer aan deze trip.
    for (const moved of away) {
      if (!chosen.has(moved.record.id)) continue
      const field = moved.path === 'students.json.enc' ? 'weekId' : 'tripId'
      await put(moved.path, { ...moved.record, [field]: trip.id, updatedAt: tx.now } as SyncRecord)
      chosen.delete(moved.record.id)
    }
    for (const id of chosen) {
      const money = tx.list('transactions.json.enc').find((t) => t.id === id)
      if (money && money.tripId !== trip.id) await put('transactions.json.enc', { ...money, tripId: trip.id, updatedAt: tx.now } as SyncRecord)
    }
  }
  return count
}

/**
 * Na 30 dagen definitief: de regels in de geschiedenis verliezen hun inhoud, en een student die met zijn trip mee weg
 * ging, verliest zijn naam (regel 14). Vanzelf na de eerste sync van een sessie.
 */
export async function pruneTrash(tx: Tx, now = tx.now): Promise<void> {
  const old = (at: string | null) => !!at && Date.parse(now) - Date.parse(at) > HISTORY_DAYS * DAY_MS
  const entries: HistoryEntry[] = tx
    .get(HISTORY_PATH)
    .filter((e) => old(e.at) && (e.deletedAt === null || e.changes.length > 0))
    // Zo klein mogelijk: alleen het tijdstip blijft (dat geeft het begin van de geschiedenis aan, zie trash.ts).
    .map((e) => ({ id: e.id, at: e.at, command: '', changes: [], updatedAt: tx.now, deletedAt: e.deletedAt ?? tx.now }))
  await tx.putMany(HISTORY_PATH, entries)
  const students: Student[] = tx
    .get('students.json.enc')
    .filter((s) => s.deletedAt !== null && old(s.deletedAt) && s.firstName !== '')
    .map((s) => scrubbed(s, tx.now))
  await tx.putMany('students.json.enc', students)
}

/**
 * Eén regel uit de geschiedenis terugzetten: per veld de waarde vooraf, alleen waar nog de waarde erna staat (een latere
 * wijziging blijft staan); wat de regel nieuw maakte, gaat weg. `participants`: verwijderde deelnemers terug in de trip
 * zoals hij nu is. Geeft het aantal teruggezette records.
 */
export async function revertEntry(tx: Tx, entry: HistoryEntry, participants = false): Promise<number> {
  let count = 0
  const removedTrips: string[] = []
  // Trips en periodes als laatste: wat deze opdracht eraan hing (een gelogde dag), is dan al teruggezet.
  const isPeriod = (c: { path: string }) => c.path === 'trips.json.enc' || c.path === 'periods.json.enc'
  const changes = [...entry.changes].reverse()
  for (const change of [...changes.filter((c) => !isPeriod(c)), ...changes.filter(isPeriod)]) {
    const current = tx.get(change.path as CollectionPath).find((r) => r.id === change.id)
    if (!current) continue
    // Een trip of periode die deze opdracht maakte en waar intussen dagen, geld, studenten of een planning aan hangen,
    // blijft staan: anders zouden die stil zonder periode komen te staan.
    if (change.before === null && !change.after.deletedAt && isPeriod(change) && hasDependents(tx, change.id)) continue
    if (participants && change.path === 'trips.json.enc') {
      const trip = current as Trip
      const was = (change.before?.participants ?? []) as Participant[]
      const back = was.filter((p) => !(change.after.participants as Participant[] | undefined)?.some((q) => q.id === p.id) && !trip.participants?.some((q) => q.id === p.id))
      if (back.length > 0) {
        await tx.put('trips.json.enc', { ...trip, participants: [...(trip.participants ?? []), ...back], updatedAt: tx.now })
        count++
      }
      continue
    }
    const reverted = revertChange(current, change, tx.now, (path, record, at) => tombstone(path as CollectionPath, record, at), entry.at)
    if (reverted) {
      await tx.put(change.path as CollectionPath, reverted as never)
      if (change.path === 'trips.json.enc' && reverted.deletedAt !== null) removedTrips.push(change.id)
      count++
    }
  }
  // Een lopende trip die zo weggaat, is niet meer lopend.
  const running = currentSettings(tx.list('settings.json.enc')).activeWeekId
  if (running && removedTrips.includes(running)) await saveSettings(tx, { activeWeekId: undefined })
  const stored = tx.list(HISTORY_PATH).find((h) => h.id === entry.id)
  if (stored && !stored.undoneAt) await tx.put(HISTORY_PATH, { ...stored, undoneAt: tx.now, updatedAt: tx.now })
  return count
}

/** Hangt er nog iets aan deze trip of periode (dagen, geld, studenten, planningen, declaraties)? */
function hasDependents(tx: Tx, id: string): boolean {
  const linked = (records: readonly { tripId?: string | null }[]) => active(records as { tripId?: string | null; deletedAt: string | null }[]).some((r) => r.tripId === id)
  return (
    linked(tx.get('legs.json.enc')) ||
    linked(tx.get('transactions.json.enc')) ||
    linked(tx.get('plans.json.enc')) ||
    linked(tx.get('claims.json.enc')) ||
    active(tx.get('students.json.enc')).some((s) => s.weekId === id)
  )
}

/** Een regel uit Meer → Geschiedenis terugzetten (niet als hij al teruggezet of opgeruimd is). */
export async function restoreEntry(tx: Tx, entryId: string): Promise<number> {
  const entry = tx.list(HISTORY_PATH).find((h) => h.id === entryId)
  if (!entry || entry.undoneAt || entry.changes.length === 0) return 0
  return revertEntry(tx, entry, entry.command === 'deelnemerVerwijderen')
}

/** De verwijderde trip met deze id uit de prullenbak terugzetten (vanuit Nakijken: dagen zonder trip). */
export async function restoreTrip(tx: Tx, tripId: string): Promise<number> {
  const item = trashItemForTrip(tx, tripId, tx.now)
  return item ? restoreTrash(tx, item.key) : 0
}

export const terugzetten = opdrachtMet('terugzetten', restoreTrash)
export const tripTerugzetten = opdracht('tripTerugzetten', restoreTrip)
export const geschiedenisTerugzetten = opdracht('geschiedenisTerugzetten', restoreEntry)
export const geschiedenisOpruimen = opdracht('geschiedenisOpruimen', pruneTrash)
