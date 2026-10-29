import { active, compareLegs, round1, totalNm } from './derive'
import { findPlace, placeKey } from './places'
import type { Leg, Place } from './types'

// De route van een trip of een dag voor de kaart: de stops in volgorde (de Van van de eerste dag, daarna elke Naar),
// genummerd vanaf 1, met de pin als die er is. Plaatsen zonder pin staan apart, zodat het tripoverzicht "Pin zetten"
// kan aanbieden. Alleen namen en punten uit het logboek; geen netwerk.

export interface RouteStop {
  /** Volgnummer op de kaart, vanaf 1. */
  n: number
  name: string
  place: Place | null
  kind: 'start' | 'stop' | 'end'
}

export interface TripRoute {
  stops: RouteStop[]
  /** Namen (zoals in de dagen) zonder pin, elk één keer, in volgorde van de route. */
  unpinned: string[]
  nm: number
  days: number
  nightHours: number
}

/** Stops uit de dagen van één trip, in volgorde; opeenvolgende gelijke plaatsen tellen één keer. */
export function routeOf(legs: readonly Leg[], places: readonly Place[]): TripRoute {
  const sorted = [...active(legs)].sort(compareLegs)
  const names: string[] = []
  const push = (name: string) => {
    const clean = name.trim()
    if (!clean) return
    if (names.length > 0 && placeKey(names.at(-1)!) === placeKey(clean)) return
    names.push(clean)
  }
  for (const leg of sorted) {
    if (names.length === 0) push(leg.fromPlace)
    else if (leg.fromPlace.trim() && placeKey(leg.fromPlace) !== placeKey(names.at(-1)!)) push(leg.fromPlace)
    push(leg.toPlace)
  }
  const stops: RouteStop[] = names.map((name, i) => ({
    n: i + 1,
    name,
    place: findPlace(places, name),
    kind: i === 0 ? 'start' : i === names.length - 1 ? 'end' : 'stop',
  }))
  const seen = new Set<string>()
  const unpinned: string[] = []
  for (const s of stops) {
    const key = placeKey(s.name)
    if (s.place || seen.has(key)) continue
    seen.add(key)
    unpinned.push(s.name)
  }
  return {
    stops,
    unpinned,
    nm: round1(sorted.reduce((n, l) => n + totalNm(l), 0)),
    days: sorted.length,
    nightHours: round1(sorted.reduce((n, l) => n + l.nightHours, 0)),
  }
}

/** De punten van de stops met een pin, in volgorde (voor de lijn op de kaart). */
export function pinnedPoints(route: TripRoute): { lat: number; lon: number }[] {
  return route.stops.filter((s) => s.place).map((s) => ({ lat: s.place!.lat, lon: s.place!.lon }))
}
