import type { Leg, Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { ImportResult } from './mileage-csv'

// Een import vervangt alle eerdere import-legs; handmatige legs blijven. Tochten die daardoor leeg raken
// krijgen een tombstone. Zo levert opnieuw importeren nooit dubbele dagen op.

export async function applyImport(store: Store, result: ImportResult): Promise<void> {
  const now = new Date().toISOString()
  const legs = store.get('legs.json.enc')
  const trips = store.get('trips.json.enc')

  const removedLegs: Leg[] = legs
    .filter((l) => l.deletedAt === null && l.source === 'import')
    .map((l) => ({ ...l, updatedAt: now, deletedAt: now }))
  const removedIds = new Set(removedLegs.map((l) => l.id))
  const stillUsed = new Set(legs.filter((l) => l.deletedAt === null && !removedIds.has(l.id)).map((l) => l.tripId))
  const removedTrips: Trip[] = trips
    .filter((t) => t.deletedAt === null && !stillUsed.has(t.id))
    .map((t) => ({ ...t, updatedAt: now, deletedAt: now }))

  await store.putMany('trips.json.enc', [...removedTrips, ...result.trips])
  await store.putMany('legs.json.enc', [...removedLegs, ...result.legs])
}
