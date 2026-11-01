import type { Reader } from '../domain/tx'
import type { DateRange } from './calendar'
import { active } from './derive'
import type { Leg, Trip } from './types'
import { addDays } from '../basis/datum'

// Datums van een trip zijn gewone velden (CLAUDE.md, uitgangspunt 2): de app rekent ze nooit uit de dagen en past ze
// nooit vanzelf aan. Hier alleen wat lezen nodig heeft: de eerste en laatste dag (een trip zonder datums van vóór
// november 2026 toont die), en wanneer een trip "voorbij" is.

/** Eerste en laatste gelogde dag van een trip; null zonder dagen. */
export function daysRange(tripId: string, legs: readonly Leg[]): DateRange | null {
  const dates = active(legs)
    .filter((l) => l.tripId === tripId && /^\d{4}-\d{2}-\d{2}$/.test(l.date))
    .map((l) => l.date)
    .sort()
  return dates.length > 0 ? { start: dates[0]!, end: dates.at(-1)! } : null
}

/** Een trip die via Toevoegen → Dag ontstond (van vóór november 2026: `datesFromDays`), is pas na drie dagen "voorbij" (anders vraagt Deze trip elke ochtend om af te ronden). */
export const DAYS_TRIP_GRACE = 3

export function endedFor(trip: Trip, endDate: string): string {
  return trip.datesFromDays ? addDays(endDate, DAYS_TRIP_GRACE) : endDate
}


/**
 * Hangt er nog iets aan de trip (inkomsten, deelnemers, studenten, planning, declaraties, review, afgerond, afgevinkte
 * lijsten, of een salaris dat Olivier zelf invulde of ontving)? Dan verdwijnt de trip nooit vanzelf.
 */
export function hasOtherData(store: Reader, trip: Trip): boolean {
  return (
    (trip.participants?.length ?? 0) > 0 ||
    !!trip.review ||
    !!trip.closedAt ||
    (!!trip.salary && (trip.salary.source === 'eigen' || trip.salary.status !== 'verwacht')) ||
    Object.keys(trip.checks ?? {}).length > 0 ||
    store.list('transactions.json.enc').some((t) => t.tripId === trip.id) ||
    store.list('students.json.enc').some((s) => s.weekId === trip.id) ||
    store.list('plans.json.enc').some((p) => p.tripId === trip.id) ||
    store.list('claims.json.enc').some((c) => c.tripId === trip.id)
  )
}
