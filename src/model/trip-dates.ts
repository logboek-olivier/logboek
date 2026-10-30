import type { Store } from '../storage/store'
import type { DateRange } from './calendar'
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
 * Na een nieuwe, verschoven, verplaatste of verwijderde dag (en na het ongedaan maken daarvan): de datums van deze trips
 * volgen hun dagen. Een trip met zelf ingestelde datums blijft ongemoeid, net als een geïmporteerde tocht zonder datums
 * (die volgt de import). De agenda wordt hier niet aangepast: zelf ingestelde dagen tussen twee gelogde dagen blijven
 * staan (eigen instelling gaat voor), zodat een verkeerd getypte datum nooit dagen in de agenda wist. Raakt een trip uit
 * Toevoegen → Dag zijn laatste dag kwijt en hangt er verder niets aan, dan verdwijnt hij, zoals bij een dag verwijderen.
 */
export async function followDays(store: Store, tripIds: readonly (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(tripIds.filter((id): id is string => !!id))]
  let changed = false
  for (const id of ids) {
    const legs = store.list('legs.json.enc')
    const trip = store.list('trips.json.enc').find((t) => t.id === id)
    if (!trip || !datesFollowDays(trip)) continue
    const own = legs.filter((l) => l.tripId === id)
    // Een geïmporteerde tocht zonder datums: de datums komen uit de import, niet vastleggen.
    if (!trip.datesFromDays && own.some((l) => l.source === 'import')) continue
    const range = daysRange(id, legs)
    if (!range) {
      if (trip.datesFromDays && !hasOtherData(store, trip)) {
        const now = new Date().toISOString()
        await store.put('trips.json.enc', { ...trip, updatedAt: now, deletedAt: now })
        const settings = store.list('settings.json.enc').find((x) => x.id === 'settings')
        if (settings?.activeWeekId === id) await store.put('settings.json.enc', { ...settings, activeWeekId: null, updatedAt: now })
        changed = true
      }
      continue
    }
    if (trip.startDate === range.start && trip.endDate === range.end && trip.datesFromDays) continue
    await store.put('trips.json.enc', { ...trip, startDate: range.start, endDate: range.end, datesFromDays: true, updatedAt: new Date().toISOString() })
    changed = true
  }
  if (changed) void store.sync()
}

/**
 * Hangt er nog iets aan de trip (inkomsten, deelnemers, studenten, planning, declaraties, review, afgerond, afgevinkte
 * lijsten, of een salaris dat Olivier zelf invulde of ontving)? Dan verdwijnt de trip nooit vanzelf.
 */
export function hasOtherData(store: Store, trip: Trip): boolean {
  return (
    (trip.participants?.length ?? 0) > 0 ||
    !!trip.review ||
    !!trip.closedAt ||
    (!!trip.salary && (trip.salary.source === 'eigen' || trip.salary.status === 'ontvangen')) ||
    Object.keys(trip.checks ?? {}).length > 0 ||
    store.list('transactions.json.enc').some((t) => t.tripId === trip.id) ||
    store.list('students.json.enc').some((s) => s.weekId === trip.id) ||
    store.list('plans.json.enc').some((p) => p.tripId === trip.id) ||
    store.list('claims.json.enc').some((c) => c.tripId === trip.id)
  )
}
