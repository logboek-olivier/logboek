import type { Store } from '../storage/store'
import { followTrip, type DateRange } from './calendar'
import { active } from './derive'
import { addDays } from './money'
import type { Leg, Trip } from './types'

// Datums van een trip die de dagen volgen (aangemaakt via Toevoegen → Dag, of een trip zonder datums): begin en eind
// komen uit de gelogde dagen en schuiven mee als er dagen bijkomen of weggaan. Stelt Olivier de datums zelf in (Trip
// bewerken, verlengen of inkorten in de agenda), dan staan ze vast en raakt dit ze niet meer.

/** Volgen de datums van deze trip de dagen? Ja als hij zo is aangemaakt, of als hij nog helemaal geen datums heeft. */
export function datesFollowDays(trip: Trip): boolean {
  return trip.datesFromDays === true || (!trip.startDate && !trip.endDate)
}

/** Eerste en laatste gelogde dag van een trip; null zonder dagen. */
export function daysRange(tripId: string, legs: readonly Leg[]): DateRange | null {
  const dates = active(legs)
    .filter((l) => l.tripId === tripId && /^\d{4}-\d{2}-\d{2}$/.test(l.date))
    .map((l) => l.date)
    .sort()
  return dates.length > 0 ? { start: dates[0]!, end: dates.at(-1)! } : null
}

/** Een trip waarvan de datums de dagen volgen, is pas na drie dagen zonder nieuwe dag "voorbij" (anders vraagt Deze trip elke ochtend om af te ronden). */
export const DAYS_TRIP_GRACE = 3

export function endedFor(trip: Trip, endDate: string): string {
  return trip.datesFromDays ? addDays(endDate, DAYS_TRIP_GRACE) : endDate
}

/**
 * Na een nieuwe, gewijzigde, verplaatste of verwijderde dag (en na het ongedaan maken daarvan): de datums van deze trips
 * volgen hun dagen. Een trip zonder dagen houdt zijn datums; een trip met zelf ingestelde datums blijft ongemoeid. De
 * agenda volgt mee (zie followTrip).
 */
export async function followDays(store: Store, tripIds: readonly (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(tripIds.filter((id): id is string => !!id))]
  let changed = false
  for (const id of ids) {
    const legs = store.list('legs.json.enc')
    const trip = store.list('trips.json.enc').find((t) => t.id === id)
    if (!trip || !datesFollowDays(trip)) continue
    const range = daysRange(id, legs)
    if (!range || (trip.startDate === range.start && trip.endDate === range.end && trip.datesFromDays)) continue
    const before = trip.startDate && trip.endDate ? { start: trip.startDate, end: trip.endDate } : range
    await store.put('trips.json.enc', { ...trip, startDate: range.start, endDate: range.end, datesFromDays: true, updatedAt: new Date().toISOString() })
    await followTrip(store, id, before, range)
    changed = true
  }
  if (changed) void store.sync()
}
