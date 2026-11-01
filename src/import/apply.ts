import { summarizeTrips } from '../model/derive'
import { hasOtherData } from '../model/trip-dates'
import type { Leg, Trip } from '../model/types'
import type { Tx } from '../domain/tx'
import type { ImportResult } from './mileage-csv'

// Een import vervangt alle eerdere import-legs; handmatige legs blijven. Tochten die daardoor leeg raken
// krijgen een tombstone. Zo levert opnieuw importeren nooit dubbele dagen op. Een geïmporteerde tocht met dezelfde
// naam en eerste dag als een bestaande tocht houdt het bestaande id, zodat weekgegevens (type, deelnemers, review)
// een nieuwe import overleven.

export async function applyImport(store: Tx, input: ImportResult): Promise<void> {
  const now = new Date().toISOString()
  const legs = store.get('legs.json.enc')
  const trips = store.get('trips.json.enc')
  const result = keepWeeks(input, trips, legs)

  const removedLegs: Leg[] = legs
    .filter((l) => l.deletedAt === null && l.source === 'import')
    .map((l) => ({ ...l, updatedAt: now, deletedAt: now }))
  const removedIds = new Set(removedLegs.map((l) => l.id))
  const stillUsed = new Set([
    ...legs.filter((l) => l.deletedAt === null && !removedIds.has(l.id)).map((l) => l.tripId),
    ...result.legs.map((l) => l.tripId),
  ])
  // Alleen gewone (geïmporteerde) tochten opruimen; een vastgelegde week blijft, ook zonder dagen, net als een tocht
  // waar iets aan hangt (inkomsten, deelnemers, review, salaris, organisatie, ...): nooit iets weggooien dat Olivier
  // zelf toevoegde.
  const removedTrips: Trip[] = trips
    .filter((t) => t.deletedAt === null && !stillUsed.has(t.id) && !t.type && !t.startDate && !t.organisation && !hasOtherData(store, t))
    .map((t) => ({ ...t, updatedAt: now, deletedAt: now }))

  await store.putMany('trips.json.enc', [...removedTrips, ...result.trips])
  await store.putMany('legs.json.enc', [...removedLegs, ...result.legs])
}

function keepWeeks(result: ImportResult, trips: readonly Trip[], legs: readonly Leg[]): ImportResult {
  const existing = new Map(summarizeTrips(trips, legs).map((s) => [`${s.trip.name.trim().toLowerCase()}|${s.startDate}`, s.trip]))
  const firstDay = new Map<string, string>()
  for (const leg of result.legs) {
    const day = firstDay.get(leg.tripId)
    if (!day || leg.date < day) firstDay.set(leg.tripId, leg.date)
  }
  const rename = new Map<string, string>()
  const newTrips: Trip[] = []
  for (const trip of result.trips) {
    const match = existing.get(`${trip.name.trim().toLowerCase()}|${firstDay.get(trip.id) ?? ''}`)
    if (match) rename.set(trip.id, match.id)
    else newTrips.push(trip)
  }
  if (rename.size === 0) return result
  return { ...result, trips: newTrips, legs: result.legs.map((l) => (rename.has(l.tripId) ? { ...l, tripId: rename.get(l.tripId)! } : l)) }
}
