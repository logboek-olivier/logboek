import type { Reader } from '../domain/tx'
import type { Trip } from './types'
import { addDays } from '../basis/datum'

// Datums van een trip zijn gewone velden (CLAUDE.md, uitgangspunt 2): de app rekent ze nooit uit de dagen en past ze
// nooit vanzelf aan. Hier alleen wat lezen nodig heeft: de eerste en laatste dag (een trip zonder datums van vóór
// november 2026 toont die), en wanneer een trip "voorbij" is.

/** Een trip die via Toevoegen → Dag ontstond (van vóór november 2026: `datesFromDays`), is pas na drie dagen "voorbij" (anders vraagt Deze trip elke ochtend om af te ronden). */
export const DAYS_TRIP_GRACE = 3

export function endedFor(trip: Trip, endDate: string): string {
  return trip.datesFromDays ? addDays(endDate, DAYS_TRIP_GRACE) : endDate
}


/**
 * Hangt er nog iets aan de trip (inkomsten, deelnemers, studenten, planning, declaraties, review, afgerond, afgevinkte
 * lijsten, een aantal gasten, of geld zoals het salaris)? Dan verdwijnt de trip nooit vanzelf.
 */
export function hasOtherData(store: Reader, trip: Trip): boolean {
  return (
    (trip.participants?.length ?? 0) > 0 ||
    !!trip.review ||
    !!trip.closedAt ||
    (trip.guestCount ?? 0) > 0 ||
    Object.keys(trip.checks ?? {}).length > 0 ||
    store.list('transactions.json.enc').some((t) => t.tripId === trip.id) ||
    store.list('students.json.enc').some((s) => s.weekId === trip.id) ||
    store.list('plans.json.enc').some((p) => p.tripId === trip.id) ||
    store.list('claims.json.enc').some((c) => c.tripId === trip.id)
  )
}
