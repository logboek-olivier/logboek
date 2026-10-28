import type { Store } from '../storage/store'
import { parseShip } from './boats'
import { active, compareLegs } from './derive'
import { addDays } from './money'
import { followTrip, tripRange } from './calendar'
import { DEFAULT_WEEK_DAYS } from './weeks'
import type { Leg, Trip } from './types'

// Niets is verplicht: een trip of dag zonder bootgegevens of plaats wordt gewoon opgeslagen en krijgt de badge
// "Onvolledig". Op zondag zet Vandaag de lege velden op een rij; Olivier vult ze één voor één aan (of slaat over).

export type TripField = 'boat' | 'boatModel' | 'boatLengthFt' | 'base' | 'startDate'
export type LegField = 'fromPlace' | 'toPlace'

/** Lege velden van een trip. Een trip zonder startdatum maar met dagen heeft afgeleide datums en mist niets. */
export function tripGaps(trip: Trip, legs: readonly Leg[]): TripField[] {
  const gaps: TripField[] = []
  const own = legs.filter((l) => l.deletedAt === null && l.tripId === trip.id)
  if (!trip.boat?.trim()) gaps.push('boat')
  if (!trip.boatModel?.trim()) gaps.push('boatModel')
  if (!trip.boatLengthFt || trip.boatLengthFt <= 0) gaps.push('boatLengthFt')
  if (!trip.base?.trim()) gaps.push('base')
  if (!trip.startDate && own.length === 0) gaps.push('startDate')
  return gaps
}

export function legGaps(leg: Leg): LegField[] {
  const gaps: LegField[] = []
  if (!leg.fromPlace.trim()) gaps.push('fromPlace')
  if (!leg.toPlace.trim()) gaps.push('toPlace')
  return gaps
}

export function tripIncomplete(trip: Trip, legs: readonly Leg[]): boolean {
  return tripGaps(trip, legs).length > 0
}

/**
 * Eén leeg veld om aan te vullen. Model en lengte horen bij de boot: één antwoord vult alle trips met die boot.
 * `suggestion` is een voorstel uit de dagen (boot, basis, vorige of volgende plaats); nooit stil opgeslagen.
 */
export type Gap =
  | { kind: 'boat'; key: string; boat: string; field: 'boatModel' | 'boatLengthFt'; tripIds: string[]; suggestion: string }
  | { kind: 'trip'; key: string; trip: Trip; field: TripField; suggestion: string }
  | { kind: 'leg'; key: string; leg: Leg; trip: Trip | undefined; field: LegField; suggestion: string }

const boatKey = (name: string) => name.trim().toLowerCase()

/** Alle lege velden: eerst per boot, dan per trip (nieuwste eerst), dan per dag (nieuwste eerst). */
export function collectGaps(trips: readonly Trip[], legs: readonly Leg[]): Gap[] {
  const liveLegs = active(legs).sort(compareLegs)
  const legsOf = new Map<string, Leg[]>()
  for (const leg of liveLegs) legsOf.set(leg.tripId, [...(legsOf.get(leg.tripId) ?? []), leg])
  const sorted = active(trips).sort((a, b) => (tripDate(a, legsOf) < tripDate(b, legsOf) ? 1 : -1))
  const boats = new Map<string, Extract<Gap, { kind: 'boat' }>>()
  const tripItems: Gap[] = []
  for (const trip of sorted) {
    const own = legsOf.get(trip.id) ?? []
    const boatName = trip.boat?.trim() || ''
    for (const field of tripGaps(trip, liveLegs)) {
      if ((field === 'boatModel' || field === 'boatLengthFt') && boatName) {
        const key = `boat|${boatKey(boatName)}|${field}`
        const existing = boats.get(key)
        if (existing) existing.tripIds.push(trip.id)
        else {
          const known = sorted.find((t) => boatKey(t.boat ?? '') === boatKey(boatName) && t[field])
          const value = known?.[field]
          boats.set(key, { kind: 'boat', key, boat: boatName, field, tripIds: [trip.id], suggestion: value === undefined ? '' : String(value) })
        }
        continue
      }
      const ship = parseShip(mostCommon(own.map((l) => l.boat)))
      if (field === 'boat') tripItems.push({ kind: 'trip', key: `trip|${trip.id}|boat`, trip, field, suggestion: ship.name })
      if (field === 'base') tripItems.push({ kind: 'trip', key: `trip|${trip.id}|base`, trip, field, suggestion: own[0]?.fromPlace.trim() ?? '' })
      // Model en lengte zonder bootnaam: per trip; met een naam komen ze per boot.
      if (field === 'boatModel') tripItems.push({ kind: 'trip', key: `trip|${trip.id}|boatModel`, trip, field, suggestion: ship.model })
      if (field === 'startDate' || field === 'boatLengthFt') tripItems.push({ kind: 'trip', key: `trip|${trip.id}|${field}`, trip, field, suggestion: '' })
    }
  }
  const tripById = new Map(sorted.map((t) => [t.id, t]))
  const legItems: Gap[] = []
  for (const leg of [...liveLegs].reverse()) {
    const own = legsOf.get(leg.tripId) ?? []
    const i = own.findIndex((l) => l.id === leg.id)
    for (const field of legGaps(leg)) {
      const suggestion = field === 'fromPlace' ? (own[i - 1]?.toPlace ?? tripById.get(leg.tripId)?.base ?? '') : (own[i + 1]?.fromPlace ?? '')
      legItems.push({ kind: 'leg', key: `leg|${leg.id}|${field}`, leg, trip: tripById.get(leg.tripId), field, suggestion: suggestion.trim() })
    }
  }
  return [...boats.values(), ...tripItems, ...legItems]
}

function tripDate(trip: Trip, legsOf: Map<string, Leg[]>): string {
  return trip.startDate ?? legsOf.get(trip.id)?.[0]?.date ?? ''
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) if (v.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** Een ingevuld veld opslaan. Boot: model of lengte op alle trips met die boot waar het nog ontbreekt. */
export async function fillGap(store: Store, gap: Gap, value: string | number): Promise<void> {
  const now = new Date().toISOString()
  if (gap.kind === 'boat') {
    const trips = store.get('trips.json.enc').filter((t) => gap.tripIds.includes(t.id) && t.deletedAt === null && !t[gap.field])
    await store.putMany('trips.json.enc', trips.map((t) => ({ ...t, [gap.field]: value, updatedAt: now })))
  } else if (gap.kind === 'trip') {
    const trip = store.get('trips.json.enc').find((t) => t.id === gap.trip.id) ?? gap.trip
    const next = { ...trip, [gap.field]: value, ...(gap.field === 'startDate' && !trip.endDate ? { endDate: addDays(value as string, DEFAULT_WEEK_DAYS - 1) } : {}), updatedAt: now }
    await store.put('trips.json.enc', next)
    if (gap.field === 'startDate') {
      const legs = store.list('legs.json.enc')
      await followTrip(store, trip.id, tripRange(trip, legs), tripRange(next, legs))
    }
  } else {
    const leg = store.get('legs.json.enc').find((l) => l.id === gap.leg.id) ?? gap.leg
    await store.put('legs.json.enc', { ...leg, [gap.field]: value, updatedAt: now })
  }
  void store.sync()
}

/** Zondag: de dag van de weekkaart "N dingen aanvullen". */
export function isSunday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() === 0
}
