import { useMemo } from 'react'
import { tripCounters, type TripCounter } from '../model/counters'
import { currentSettings } from '../model/settings'
import type { Store } from '../storage/store'
import { useCollection } from './useCollection'

/** Volgnummer per organisatie ("SV #3") voor elke trip, bijgewerkt bij elke wijziging. */
export function useCounters(store: Store): Map<string, TripCounter> {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = useCollection(store, 'settings.json.enc')
  return useMemo(() => tripCounters(trips, legs, currentSettings(settings)), [trips, legs, settings])
}
