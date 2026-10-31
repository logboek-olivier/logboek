import type { Store } from '../storage/store'
import { followTrip, tripRange } from './calendar'
import type { Undo } from './edit'
import { saveSettings, currentSettings } from './settings'
import { scrubbed } from './students'
import { active } from './derive'
import type { Claim, Leg, Participant, Student, SyncRecord, Transaction, Trip, WeekPlan } from './types'
import { applyChanges, undoableIn, type Change } from './changes'
import { scrubbedClaim } from './claims'
import { scrubbedDocument } from './documents'
import { syncParticipants } from './weeks'
import { datesFollowDays, followDays } from './trip-dates'

// Trips als geheel: verwijderen met de keuze wat er met dagen, inkomsten, deelnemers, studenten en planningen gebeurt
// ("Meenemen naar trip …" of "Ook verwijderen"), overlappende trips samenvoegen of vervangen, en deelnemers los bewerken
// of verwijderen. Elke handeling geeft ongedaan maken terug: de vorige versies komen terug met een latere updatedAt.

/** Alles wat aan een trip hangt. */
export interface TripDependents {
  legs: Leg[]
  transactions: Transaction[]
  participants: Participant[]
  students: Student[]
  plans: WeekPlan[]
  claims: Claim[]
}

export function tripDependents(store: Store, trip: Trip): TripDependents {
  return {
    legs: store.list('legs.json.enc').filter((l) => l.tripId === trip.id),
    transactions: store.list('transactions.json.enc').filter((t) => t.tripId === trip.id),
    participants: trip.participants ?? [],
    students: store.list('students.json.enc').filter((s) => s.weekId === trip.id),
    plans: store.list('plans.json.enc').filter((p) => p.tripId === trip.id),
    claims: store.list('claims.json.enc').filter((c) => c.tripId === trip.id),
  }
}

export function hasDependents(d: TripDependents): boolean {
  return d.legs.length + d.transactions.length + d.participants.length + d.students.length + d.plans.length + d.claims.length > 0
}

/**
 * De agenda volgt een trip (zie followTrip); ook dat hoort bij ongedaan maken: zelf ingestelde dagen en periodes aan
 * land die daardoor veranderden (en het geld dat meeging), komen terug zoals ze waren.
 */
function followUndoable(store: Store, follow: () => Promise<void>): Promise<Undo> {
  return undoableIn(store, ['calendar.json.enc', 'periods.json.enc', 'transactions.json.enc'], follow)
}

const apply = (store: Store, changes: Change[]) => applyChanges(store, changes)

function both(a: Undo, b: Undo): Undo {
  return async () => {
    await b()
    await a()
  }
}

function moved<T extends SyncRecord>(record: T, patch: Partial<T>, now: string): T {
  return { ...record, ...patch, updatedAt: now }
}

function gone<T extends SyncRecord>(record: T, now: string): T {
  return { ...record, updatedAt: now, deletedAt: now }
}

/** Deelnemers samenvoegen zonder dubbelen (zelfde id). */
function joinParticipants(a: readonly Participant[], b: readonly Participant[]): Participant[] {
  return [...a, ...b.filter((p) => !a.some((q) => q.id === p.id))]
}

/** Wat er van `from` naar `to` gaat: dagen, inkomsten, studenten en planningen krijgen de andere trip. */
function moveChanges(store: Store, from: Trip, to: Trip, now: string): Change[] {
  const d = tripDependents(store, from)
  return [
    ...d.legs.map((l): Change => ({ path: 'legs.json.enc', before: l, after: moved(l, { tripId: to.id }, now) })),
    ...d.transactions.map((t): Change => ({ path: 'transactions.json.enc', before: t, after: moved(t, { tripId: to.id }, now) })),
    ...d.students.map((s): Change => ({ path: 'students.json.enc', before: s, after: moved(s, { weekId: to.id }, now) })),
    ...d.plans.map((p): Change => ({ path: 'plans.json.enc', before: p, after: moved(p, { tripId: to.id }, now) })),
    ...d.claims.map((c): Change => ({ path: 'claims.json.enc', before: c, after: moved(c, { tripId: to.id }, now) })),
  ]
}

/** De lopende trip wijst niet meer naar een verwijderde trip. */
async function forgetActive(store: Store, removed: Trip, replacement: Trip | null): Promise<void> {
  const settings = currentSettings(store.get('settings.json.enc'))
  if (settings.activeWeekId === removed.id) await saveSettings(store, { activeWeekId: replacement?.id ?? undefined })
}

/**
 * Trip verwijderen. `moveTo`: dagen, inkomsten, deelnemers, studenten en planningen gaan naar die trip; zonder: alles
 * gaat mee weg (studenten als geschoonde tombstone, regel 14).
 */
export async function deleteTripWith(store: Store, trip: Trip, moveTo: Trip | null): Promise<Undo> {
  const now = new Date().toISOString()
  const legs = store.list('legs.json.enc')
  const range = tripRange(trip, legs)
  const d = tripDependents(store, trip)
  const changes: Change[] = [{ path: 'trips.json.enc', before: trip, after: gone(trip, now) }]
  if (moveTo) {
    changes.push(...moveChanges(store, trip, moveTo, now))
    if (d.participants.length > 0) {
      changes.push({ path: 'trips.json.enc', before: moveTo, after: moved(moveTo, { participants: joinParticipants(moveTo.participants ?? [], d.participants) }, now) })
    }
  } else {
    changes.push(
      ...d.legs.map((l): Change => ({ path: 'legs.json.enc', before: l, after: gone(l, now) })),
      ...d.transactions.map((t): Change => ({ path: 'transactions.json.enc', before: t, after: gone(t, now) })),
      ...d.students.map((s): Change => ({ path: 'students.json.enc', before: s, after: scrubbed(s, now) })),
      ...d.plans.map((p): Change => ({ path: 'plans.json.enc', before: p, after: gone(p, now) })),
      // Declaraties gaan mee weg zonder notitie of bedrag, met hun bonnetje uit de kluis.
      ...d.claims.map((c): Change => ({ path: 'claims.json.enc', before: c, after: scrubbedClaim(c, now) })),
      ...d.claims.flatMap((c): Change[] => {
        const doc = c.documentId ? store.list('documents/index.json.enc').find((x) => x.id === c.documentId) : undefined
        return doc ? [{ path: 'documents/index.json.enc', before: doc, after: scrubbedDocument(doc, now) }] : []
      }),
    )
  }
  const undo = await apply(store, changes)
  const calendar = await followUndoable(store, () => followTrip(store, trip.id, range, null))
  // Dagen naar een trip waarvan de datums de dagen volgen: die schuiven mee (en terug bij ongedaan maken).
  if (moveTo) await followDays(store, [moveTo.id])
  await forgetActive(store, trip, moveTo)
  const back = both(undo, calendar)
  return async () => {
    await back()
    await followDays(store, [moveTo?.id, trip.id])
  }
}

/** Twee trips die op dezelfde dagen liggen (meer dan alleen een wisseldag: de laatste dag van de een is de eerste van de ander). */
export interface Overlap {
  a: Trip
  b: Trip
  from: string
  to: string
}

export function tripOverlaps(trips: readonly Trip[], legs: readonly Leg[]): Overlap[] {
  const live = active(legs)
  const ranged = active(trips)
    .map((trip) => ({ trip, range: tripRange(trip, live) }))
    .filter((x): x is { trip: Trip; range: { start: string; end: string } } => x.range !== null)
    .sort((x, y) => (x.range.start < y.range.start ? -1 : x.range.start > y.range.start ? 1 : x.trip.id < y.trip.id ? -1 : 1))
  const out: Overlap[] = []
  for (let i = 0; i < ranged.length; i++) {
    for (let j = i + 1; j < ranged.length; j++) {
      const x = ranged[i]!
      const y = ranged[j]!
      if (y.range.start > x.range.end) break
      const from = y.range.start > x.range.start ? y.range.start : x.range.start
      const to = y.range.end < x.range.end ? y.range.end : x.range.end
      if (from > to) continue
      // Wisseldag: de een eindigt op de dag dat de ander begint (gasten eraf, nieuwe gasten erop).
      const changeover = from === to && ((x.range.end === from && y.range.start === from) || (y.range.end === from && x.range.start === from))
      if (!changeover) out.push({ a: x.trip, b: y.trip, from, to })
    }
  }
  return out
}

/**
 * Samenvoegen: `other` gaat op in `keep`. Dagen, inkomsten, deelnemers, studenten en planningen gaan mee; lege velden
 * van `keep` worden aangevuld uit `other`; de datums lopen over beide trips. `other` verdwijnt.
 */
export async function mergeTrips(store: Store, keep: Trip, other: Trip): Promise<Undo> {
  const now = new Date().toISOString()
  const legs = store.list('legs.json.enc')
  const keepRange = tripRange(keep, legs)
  const otherRange = tripRange(other, legs)
  const start = [keepRange?.start, otherRange?.start].filter((x): x is string => !!x).sort()[0]
  const end = [keepRange?.end, otherRange?.end].filter((x): x is string => !!x).sort().at(-1)
  const fill: Partial<Trip> = {}
  for (const key of ['type', 'boat', 'boatModel', 'boatLengthFt', 'boatKind', 'base', 'charter', 'area', 'organisation', 'note'] as const) {
    if (keep[key] === undefined && other[key] !== undefined) (fill as Record<string, unknown>)[key] = other[key]
  }
  const merged: Trip = moved(keep, { ...fill, ...(start ? { startDate: start } : {}), ...(end ? { endDate: end } : {}), participants: joinParticipants(keep.participants ?? [], other.participants ?? []) }, now)
  // De datums volgen alleen nog de dagen als dat voor beide trips gold; anders staan de samengevoegde datums vast.
  if (keep.datesFromDays && !datesFollowDays(other)) delete merged.datesFromDays
  const changes: Change[] = [
    { path: 'trips.json.enc', before: keep, after: merged },
    { path: 'trips.json.enc', before: other, after: gone(other, now) },
    ...moveChanges(store, other, keep, now),
  ]
  const undo = await apply(store, changes)
  const calendar = await followUndoable(store, () => followTrip(store, keep.id, keepRange, tripRange(merged, store.list('legs.json.enc'))))
  await forgetActive(store, other, keep)
  await syncParticipants(store, merged)
  return both(undo, calendar)
}

/**
 * Vervangen: `keep` blijft zoals hij is (ook de datums), `other` verdwijnt. Wat aan `other` hing (dagen, inkomsten,
 * deelnemers, studenten, planningen) gaat naar `keep`, zodat er niets verloren gaat.
 */
export async function replaceTrip(store: Store, keep: Trip, other: Trip): Promise<Undo> {
  return deleteTripWith(store, other, keep)
}

/** Eén deelnemer bewerken of (zonder `next`) uit de trip halen. Zijn fooideel telt dan als onbekend. */
export async function changeParticipant(store: Store, trip: Trip, id: string, next: Participant | null): Promise<Undo> {
  const now = new Date().toISOString()
  const participants = (trip.participants ?? []).flatMap((p) => (p.id !== id ? [p] : next ? [next] : []))
  const updated = moved(trip, { participants }, now)
  const undo = await apply(store, [{ path: 'trips.json.enc', before: trip, after: updated }])
  await syncParticipants(store, updated)
  return undo
}
