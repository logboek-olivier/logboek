import type { Tx, Reader } from '../domain/tx'
import { saveSettings, currentSettings } from './settings'
import type { Claim, Leg, Participant, Student, SyncRecord, Transaction, Trip, WeekPlan } from './types'
import { applyChanges, type Change } from './changes'
import { scrubbedClaim } from './claims'
import { scrubbedDocument } from './documents'
import { syncParticipants } from './weeks'

// Trips als geheel: verwijderen met de keuze wat er met dagen, inkomsten, deelnemers, studenten en planningen gebeurt
// ("Geld en dagen behouden" of "Alles naar de prullenbak"), en deelnemers los bewerken of verwijderen. Trips mogen
// overlappen; samenvoegen of vervangen bestaat niet meer. Ongedaan maken regelt de opdracht (src/domain).

/** Alles wat aan een trip hangt. */
export interface TripDependents {
  legs: Leg[]
  transactions: Transaction[]
  participants: Participant[]
  students: Student[]
  plans: WeekPlan[]
  claims: Claim[]
}

export function tripDependents(store: Reader, trip: Trip): TripDependents {
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

function moved<T extends SyncRecord>(record: T, patch: Partial<T>, now: string): T {
  return { ...record, ...patch, updatedAt: now }
}

function gone<T extends SyncRecord>(record: T, now: string): T {
  return { ...record, updatedAt: now, deletedAt: now }
}

/** De lopende trip wijst niet meer naar een verwijderde trip. */
async function forgetActive(store: Tx, removed: Trip): Promise<void> {
  const settings = currentSettings(store.get('settings.json.enc'))
  if (settings.activeWeekId === removed.id) await saveSettings(store, { activeWeekId: undefined })
}

/**
 * Een trip verwijderen (hij gaat naar de prullenbak, src/model/trash.ts):
 * - "behouden": alleen de trip; dagen, geld, studenten, planningen en declaraties blijven staan en wijzen nog naar de trip
 *   (zonder periode, in Nakijken), zodat terugzetten ze vanzelf weer koppelt;
 * - "alles": ook wat eraan hangt, als tombstones met inhoud (declaraties en hun bonnetje geschoond, de inhoud staat 30
 *   dagen in de geschiedenis).
 */
export async function deleteTripWith(store: Tx, trip: Trip, choice: 'behouden' | 'alles'): Promise<void> {
  const now = store.now
  const d = tripDependents(store, trip)
  const changes: Change[] = [{ path: 'trips.json.enc', before: trip, after: gone(trip, now) }]
  if (choice === 'alles') {
    changes.push(
      ...d.legs.map((l): Change => ({ path: 'legs.json.enc', before: l, after: gone(l, now) })),
      ...d.transactions.map((t): Change => ({ path: 'transactions.json.enc', before: t, after: gone(t, now) })),
      // Studenten met hun naam: zo komen ze terug uit de prullenbak; na 30 dagen gaat de naam weg (regel 14).
      ...d.students.map((s): Change => ({ path: 'students.json.enc', before: s, after: gone(s, now) })),
      ...d.plans.map((p): Change => ({ path: 'plans.json.enc', before: p, after: gone(p, now) })),
      // Declaraties gaan mee weg zonder notitie of bedrag, met hun bonnetje uit de kluis.
      ...d.claims.map((c): Change => ({ path: 'claims.json.enc', before: c, after: scrubbedClaim(c, now) })),
      ...d.claims.flatMap((c): Change[] => {
        const doc = c.documentId ? store.list('documents/index.json.enc').find((x) => x.id === c.documentId) : undefined
        return doc ? [{ path: 'documents/index.json.enc', before: doc, after: scrubbedDocument(doc, now) }] : []
      }),
    )
  }
  await applyChanges(store, changes)
  await forgetActive(store, trip)
}

/** Een deelnemer uit de trip halen (naar de prullenbak). Zijn fooideel telt dan als onbekend. */
export function removeParticipant(store: Tx, trip: Trip, id: string): Promise<void> {
  return changeParticipant(store, trip, id, null)
}

/** Eén deelnemer bewerken of (zonder `next`) uit de trip halen. Zijn fooideel telt dan als onbekend. */
export async function changeParticipant(store: Tx, trip: Trip, id: string, next: Participant | null): Promise<void> {
  const now = store.now
  const participants = (trip.participants ?? []).flatMap((p) => (p.id !== id ? [p] : next ? [next] : []))
  const updated = moved(trip, { participants }, now)
  await applyChanges(store, [{ path: 'trips.json.enc', before: trip, after: updated }])
  await syncParticipants(store, updated)
}
