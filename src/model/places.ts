import type { Store } from '../storage/store'
import { active, compareLegs, round1, totalNm } from './derive'
import { newId, nowIso, type Leg, type Place } from './types'

// Plaatsen en afstanden. Een plaats is een naam met een punt op de kaart (places.json.enc). Het afstandsvoorstel
// komt uit wat Olivier echt gevaren heeft: het gemiddelde van de laatste vijf dagen met dezelfde route (van en naar,
// in beide richtingen). Hemelsbreed is alleen een hint, nooit een voorstel.

export const ROUTE_HISTORY = 5
/** Een tik binnen deze afstand van een bekende plaats kiest die plaats. */
export const SAME_PLACE_NM = 1.5
const EARTH_RADIUS_NM = 3440.065

/** Naam zonder hoofdletters, accenten en dubbele spaties, om routes en plaatsen te vergelijken. */
export function placeKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Afstand over de bol (grootcirkel) in zeemijlen. */
export function greatCircleNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface RouteSuggestion {
  /** Gemiddelde totale afstand (nm), één decimaal. */
  nm: number
  /** Aantal dagen waarop het gemiddelde rust (hoogstens ROUTE_HISTORY). */
  count: number
}

/** Voorstel voor de afstand van een route: gemiddelde van de laatste vijf keer (beide richtingen), of null. */
export function suggestDistance(legs: readonly Leg[], from: string, to: string): RouteSuggestion | null {
  const a = placeKey(from)
  const b = placeKey(to)
  if (!a || !b || a === b) return null
  const same = active(legs)
    .filter((l) => totalNm(l) > 0)
    .filter((l) => {
      const f = placeKey(l.fromPlace)
      const t = placeKey(l.toPlace)
      return (f === a && t === b) || (f === b && t === a)
    })
    .sort(compareLegs)
    .slice(-ROUTE_HISTORY)
  if (same.length === 0) return null
  return { nm: round1(same.reduce((n, l) => n + totalNm(l), 0) / same.length), count: same.length }
}

/** Plaats bij een naam (zonder hoofdletters en accenten). */
export function findPlace(places: readonly Place[], name: string): Place | null {
  const key = placeKey(name)
  return key ? (active(places).find((p) => placeKey(p.name) === key) ?? null) : null
}

/** Dichtstbijzijnde bekende plaats binnen SAME_PLACE_NM, of null. */
export function nearestPlace(places: readonly Place[], point: { lat: number; lon: number }): Place | null {
  let best: Place | null = null
  let bestNm = SAME_PLACE_NM
  for (const p of active(places)) {
    const d = greatCircleNm(p, point)
    if (d <= bestNm) {
      best = p
      bestNm = d
    }
  }
  return best
}

/** Plaatsnamen uit eerdere dagen (ook zonder punt op de kaart), meest gebruikt eerst, voor suggesties. */
export function knownPlaceNames(legs: readonly Leg[], places: readonly Place[]): string[] {
  const counts = new Map<string, { name: string; n: number }>()
  const add = (name: string, weight: number) => {
    const key = placeKey(name)
    if (!key) return
    const entry = counts.get(key) ?? { name: name.trim(), n: 0 }
    entry.n += weight
    counts.set(key, entry)
  }
  for (const p of active(places)) add(p.name, 1)
  for (const l of active(legs)) {
    add(l.fromPlace, 1)
    add(l.toPlace, 1)
  }
  return [...counts.values()].sort((x, y) => y.n - x.n).map((e) => e.name).slice(0, 200)
}

/** Slaat een plaats op (nieuw, of een bestaande met dezelfde naam krijgt het nieuwe punt). */
export async function savePlace(store: Store, name: string, point: { lat: number; lon: number }, country = ''): Promise<Place> {
  const clean = name.trim().slice(0, 80)
  const existing = findPlace(store.get('places.json.enc'), clean)
  const place: Place = {
    id: existing?.id ?? newId(),
    name: clean,
    lat: Math.round(point.lat * 1e5) / 1e5,
    lon: Math.round(point.lon * 1e5) / 1e5,
    ...(country.trim() || existing?.country ? { country: country.trim() || existing?.country } : {}),
    updatedAt: nowIso(),
    deletedAt: null,
  }
  await store.put('places.json.enc', place)
  return place
}
