import type { Store } from '../storage/store'
import { followDays } from './trip-dates'
import { active, compareLegs, totalNm } from './derive'
import { placeKey, suggestDistance } from './places'
import { saveSettings } from './settings'
import { newId, nowIso, type Leg, type PlannedLeg, type Settings, type Trip } from './types'
import { roleForType, weekView } from './weeks'

// Route-sjablonen: terugkerende reeksen etappes uit de historie (bijvoorbeeld dezelfde Yacht Week-route), en
// "Herhaal vorige trip". Een trip die zo start, krijgt boot, gebied, organisatie en de geplande etappes mee; op
// Vandaag logt "Zoals gepland" de etappe van vandaag met één tik.

/** Twee trips volgen dezelfde route als ze minstens de helft van hun etappes (in beide richtingen) delen. */
const SIMILAR = 0.5

function dayIndex(start: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
}

/** De gevaren etappes van een trip als planning (dag 0 = eerste dag); zonder dagen de opgeslagen planning. */
export function tripRoute(trip: Trip, legs: readonly Leg[]): PlannedLeg[] {
  const own = active(legs)
    .filter((l) => l.tripId === trip.id && (l.fromPlace.trim() || l.toPlace.trim()))
    .sort(compareLegs)
  if (own.length === 0) return trip.route ?? []
  const start = own[0]!.date
  return own.map((l) => ({ day: Math.max(0, dayIndex(start, l.date)), from: l.fromPlace.trim(), to: l.toPlace.trim(), ...(totalNm(l) > 0 ? { nm: totalNm(l) } : {}) }))
}

function pairs(route: readonly PlannedLeg[]): Set<string> {
  return new Set(
    route
      .map((r) => [placeKey(r.from), placeKey(r.to)].sort().join('>'))
      .filter((k) => !k.startsWith('>') && !k.endsWith('>')),
  )
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const k of a) if (b.has(k)) shared++
  return shared / Math.min(a.size, b.size)
}

export interface RouteTemplate {
  /** Het id van de nieuwste trip met deze route. */
  id: string
  /** De nieuwste trip: boot, gebied en organisatie komen hiervandaan. */
  source: Trip
  route: PlannedLeg[]
  /** Hoe vaak Olivier deze route gevaren heeft. */
  times: number
  /** Begin- en eindplaats, bijvoorbeeld "Nephaven → Nepbaai". */
  label: string
}

/** Terugkerende routes: groepen van minstens twee trips met grotendeels dezelfde etappes, nieuwste trip eerst. */
export function routeTemplates(trips: readonly Trip[], legs: readonly Leg[]): RouteTemplate[] {
  const withRoute = active(trips)
    .map((trip) => ({ trip, route: tripRoute(trip, legs), date: weekView(trip, legs).startDate }))
    .filter((x) => x.route.length >= 2)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const groups: { first: (typeof withRoute)[number]; keys: Set<string>; times: number }[] = []
  for (const item of withRoute) {
    const keys = pairs(item.route)
    const group = groups.find((g) => similarity(g.keys, keys) >= SIMILAR)
    if (group) group.times++
    else groups.push({ first: item, keys, times: 1 })
  }
  return groups
    .filter((g) => g.times >= 2)
    .map((g) => ({
      id: g.first.trip.id,
      source: g.first.trip,
      route: g.first.route,
      times: g.times,
      label: [g.first.route[0]!.from, g.first.route.at(-1)!.to].filter(Boolean).join(' → '),
    }))
}

/** De laatste trip (met dagen of een boot), voor "Herhaal vorige trip". */
export function previousTrip(trips: readonly Trip[], legs: readonly Leg[], today: string): Trip | null {
  return (
    active(trips)
      .map((trip) => ({ trip, date: weekView(trip, legs).startDate }))
      .filter((x) => x.date && x.date <= today && (tripRoute(x.trip, legs).length > 0 || x.trip.boat))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.trip ?? null
  )
}

/** Korte weergave van een planning: "Nephaven → Nepbaai → Nepdorp" (hoogstens zes plaatsen). */
export function routeLine(route: readonly PlannedLeg[]): string {
  const stops = route.length === 0 ? [] : [route[0]!.from, ...route.map((r) => r.to)].filter(Boolean)
  return stops.length > 6 ? `${stops.slice(0, 5).join(' → ')} → … → ${stops.at(-1)}` : stops.join(' → ')
}

/** De geplande etappe van een datum in de lopende trip, als die dag nog niet gelogd is. */
export function plannedFor(trip: Trip | null, legs: readonly Leg[], date: string): PlannedLeg | null {
  if (!trip?.route?.length || !trip.startDate) return null
  if (active(legs).some((l) => l.tripId === trip.id && l.date === date)) return null
  const day = dayIndex(trip.startDate, date)
  return trip.route.find((r) => r.day === day) ?? null
}

/** Afstand voor een geplande etappe: het voorstel uit de historie, anders wat de etappe in het sjabloon was. */
export function plannedNm(legs: readonly Leg[], planned: PlannedLeg): number | null {
  return suggestDistance(legs, planned.from, planned.to)?.nm ?? planned.nm ?? null
}

/** "Zoals gepland": de etappe van vandaag loggen met boot en rol uit de trip. */
export async function logPlanned(store: Store, trip: Trip, planned: PlannedLeg, date: string, settings: Settings): Promise<Leg> {
  const legs = store.get('legs.json.enc')
  const nm = plannedNm(legs, planned) ?? 0
  const water = settings.lastWater ?? 'zee'
  const last = [...active(legs)].sort(compareLegs).at(-1)
  const leg: Leg = {
    id: newId(),
    tripId: trip.id,
    date,
    fromPlace: planned.from,
    fromCountry: last?.toCountry ?? '',
    toPlace: planned.to,
    toCountry: last?.toCountry ?? '',
    role: (trip.type ? roleForType(trip.type) : null) ?? settings.lastRole,
    boat: trip.boat || settings.lastBoat,
    nmInland: water === 'binnen' ? nm : 0,
    nmSea: water === 'zee' ? nm : 0,
    nmTidal: water === 'getij' ? nm : 0,
    nightHours: 0,
    dateEstimated: false,
    source: 'manual',
    updatedAt: nowIso(),
    deletedAt: null,
  }
  await store.put('legs.json.enc', leg)
  await followDays(store, [trip.id])
  await saveSettings(store, { lastTripId: trip.id, ...(leg.boat ? { lastBoat: leg.boat } : {}), lastRole: leg.role })
  void store.sync()
  return leg
}

/** Aantal dagen dat een planning beslaat. */
export function routeDays(route: readonly PlannedLeg[]): number {
  return route.reduce((n, r) => Math.max(n, r.day + 1), 0)
}
