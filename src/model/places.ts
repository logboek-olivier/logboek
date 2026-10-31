import type { Tx } from '../domain/tx'
import { distanceToCountryNm } from './countries'
import { active, compareLegs, round1, totalNm } from './derive'
import { newId, type Leg, type Place } from './types'
import { nowIso } from '../basis/datum'

// Plaatsen en afstanden. Een plaats is een naam met een punt op de kaart (places.json.enc). Het afstandsvoorstel
// komt uit wat Olivier echt gevaren heeft: het gemiddelde van de laatste vijf dagen met dezelfde route (van en naar,
// in beide richtingen). Hemelsbreed is alleen een hint, nooit een voorstel.

export const ROUTE_HISTORY = 5
/** Een tik binnen deze afstand van een bekende plaats kiest die plaats. */
export const SAME_PLACE_NM = 1.5
const EARTH_RADIUS_NM = 3440.065

/** Naam zonder hoofdletters, accenten, spaties en leestekens ("Tiha bay" = "Tihabay"), om plaatsen te vergelijken. */
export function placeKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Aantal letters toevoegen, weglaten of vervangen tussen twee sleutels (Levenshtein), afgebroken boven `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j]!)
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]!
}

/**
 * Dezelfde plaats voor het afstandsvoorstel: gelijke sleutel, of een kleine spelvariant van een lange naam
 * ("Palmizana" / "Palimizana": één letter verschil bij 8 letters of meer). Twijfelgevallen worden een voorstel om
 * samen te voegen (zie mergeCandidates), nooit stil gekoppeld.
 */
export function samePlace(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return Math.min(a.length, b.length) >= 8 && editDistance(a, b, 1) <= 1
}

/** Mogelijk dezelfde plaats: één letter verschil vanaf 5 letters, twee vanaf 10. */
function looksAlike(a: string, b: string): boolean {
  const shortest = Math.min(a.length, b.length)
  if (shortest < 5) return false
  return editDistance(a, b, 2) <= (shortest >= 10 ? 2 : 1)
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
  if (!a || !b || samePlace(a, b)) return null
  const same = active(legs)
    .filter((l) => totalNm(l) > 0)
    .filter((l) => {
      const f = placeKey(l.fromPlace)
      const t = placeKey(l.toPlace)
      return (samePlace(f, a) && samePlace(t, b)) || (samePlace(f, b) && samePlace(t, a))
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
export async function savePlace(store: Tx, name: string, point: { lat: number; lon: number }, country = ''): Promise<Place> {
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

export interface PlaceUse {
  name: string
  key: string
  /** Aantal dagen met deze plaats (van of naar). */
  days: number
  place: Place | null
  /** Andere plaatsen op dezelfde dagen, om de kaart op te centreren. */
  neighbours: string[]
}

/** Alle plaatsnamen uit de dagen en de kaart, meest gebruikt eerst, met hun punt (als dat er is). */
export function placeUses(legs: readonly Leg[], places: readonly Place[]): PlaceUse[] {
  type Entry = PlaceUse & { names: Map<string, number> }
  const byKey = new Map<string, Entry>()
  const add = (name: string, other: string) => {
    const key = placeKey(name)
    if (!key) return
    const entry: Entry = byKey.get(key) ?? { name: name.trim(), key, days: 0, place: null, neighbours: [], names: new Map<string, number>() }
    entry.days++
    entry.names.set(name.trim(), (entry.names.get(name.trim()) ?? 0) + 1)
    if (other.trim() && !entry.neighbours.includes(other.trim())) entry.neighbours.push(other.trim())
    byKey.set(key, entry)
  }
  for (const l of active(legs)) {
    add(l.fromPlace, l.toPlace)
    add(l.toPlace, l.fromPlace)
  }
  for (const p of active(places)) {
    const key = placeKey(p.name)
    const entry: Entry = byKey.get(key) ?? { name: p.name, key, days: 0, place: null, neighbours: [], names: new Map<string, number>() }
    entry.place = p
    byKey.set(key, entry)
  }
  return [...byKey.values()]
    .map(({ names, ...use }) => ({ ...use, name: use.place?.name ?? [...names.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? use.name }))
    .sort((x, y) => y.days - x.days || x.name.localeCompare(y.name))
}

export interface MergeCandidate {
  /** De meest gebruikte schrijfwijze; de andere worden daarnaar hernoemd. */
  into: PlaceUse
  others: PlaceUse[]
}

/** Voorstellen om plaatsen samen te voegen: namen die op een kleine spelvariant na gelijk zijn. */
export function mergeCandidates(uses: readonly PlaceUse[]): MergeCandidate[] {
  const result: MergeCandidate[] = []
  const taken = new Set<string>()
  for (const use of uses) {
    if (taken.has(use.key)) continue
    const others = uses.filter((o) => o.key !== use.key && !taken.has(o.key) && looksAlike(use.key, o.key))
    if (others.length === 0) continue
    for (const o of others) taken.add(o.key)
    taken.add(use.key)
    result.push({ into: use, others })
  }
  return result
}

/**
 * Samenvoegen: alle dagen met een van de andere schrijfwijzen krijgen de naam van `into`; heeft alleen een andere
 * schrijfwijze een punt op de kaart, dan krijgt `into` dat punt.
 */
export async function mergePlaces(store: Tx, candidate: MergeCandidate): Promise<void> {
  const keys = new Set(candidate.others.map((o) => o.key))
  const name = candidate.into.name
  const now = nowIso()
  const legs = active(store.get('legs.json.enc')).filter((l) => keys.has(placeKey(l.fromPlace)) || keys.has(placeKey(l.toPlace)))
  const changed = legs.map((l) => ({
    ...l,
    ...(keys.has(placeKey(l.fromPlace)) ? { fromPlace: name } : {}),
    ...(keys.has(placeKey(l.toPlace)) ? { toPlace: name } : {}),
    updatedAt: now,
  }))
  const places = active(store.get('places.json.enc')).filter((p) => keys.has(placeKey(p.name)))
  const intoPlace = findPlace(store.get('places.json.enc'), name)
  const placeChanges: Place[] = places.map((p, i) => (!intoPlace && i === 0 ? { ...p, name, updatedAt: now } : { ...p, updatedAt: now, deletedAt: now }))
  if (changed.length > 0) await store.putMany('legs.json.enc', changed)
  if (placeChanges.length > 0) await store.putMany('places.json.enc', placeChanges)
}

/** Een plaats zonder punt met één tik vastzetten. */
export async function pinPlace(store: Tx, name: string, point: { lat: number; lon: number }): Promise<void> {
  await savePlace(store, name, point)
}

/** Een getypte naam die nog niet voorkomt maar lijkt op een bekende plaats: "Bedoel je …?". */
export function similarKnown(uses: readonly PlaceUse[], name: string): PlaceUse | null {
  const key = placeKey(name)
  if (!key || uses.some((u) => u.key === key)) return null
  return uses.find((u) => looksAlike(key, u.key)) ?? null
}

/**
 * Hernoemen: alle dagen met deze plaats en het punt op de kaart krijgen de nieuwe naam. Bestaat de nieuwe naam al, dan
 * is het samenvoegen (zie mergePlaceInto).
 */
export async function renamePlace(store: Tx, use: PlaceUse, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80)
  const existing = placeUses(store.get('legs.json.enc'), store.get('places.json.enc')).find((u) => u.key === placeKey(clean) && u.key !== use.key)
  if (existing) return mergePlaceInto(store, use, existing)
  const now = nowIso()
  const legs = active(store.get('legs.json.enc')).filter((l) => placeKey(l.fromPlace) === use.key || placeKey(l.toPlace) === use.key)
  const changed = legs.map((l) => ({
    ...l,
    ...(placeKey(l.fromPlace) === use.key ? { fromPlace: clean } : {}),
    ...(placeKey(l.toPlace) === use.key ? { toPlace: clean } : {}),
    updatedAt: now,
  }))
  const places = active(store.get('places.json.enc')).filter((p) => placeKey(p.name) === use.key)
  if (changed.length > 0) await store.putMany('legs.json.enc', changed)
  if (places.length > 0) await store.putMany('places.json.enc', places.map((p) => ({ ...p, name: clean, updatedAt: now })))
}

/** Samenvoegen met een gekozen plaats: de dagen krijgen de naam van `into`; heeft alleen `use` een punt, dan krijgt `into` dat. */
export function mergePlaceInto(store: Tx, use: PlaceUse, into: PlaceUse): Promise<void> {
  return mergePlaces(store, { into, others: [use] })
}

/** Het punt weghalen: de plaats blijft als naam (in de dagen en de suggesties), zonder punt op de kaart. */
export async function removePin(store: Tx, use: PlaceUse): Promise<void> {
  const now = nowIso()
  const places = active(store.get('places.json.enc')).filter((p) => placeKey(p.name) === use.key)
  if (places.length > 0) await store.putMany('places.json.enc', places.map((p) => ({ ...p, updatedAt: now, deletedAt: now })))
}

/**
 * Een plaats verwijderen kan alleen als geen enkele dag hem gebruikt (anders zou een gelogde dag zijn plaats verliezen):
 * dan verdwijnt het punt en daarmee de plaats. Komt hij in dagen voor, dan hernoemen of samenvoegen.
 */
export async function deletePlace(store: Tx, use: PlaceUse): Promise<void> {
  if (use.days > 0) throw new Error('Plaats komt voor in dagen')
  return removePin(store, use)
}

/** Het land van een plaats: dat van het punt, anders het meest gebruikte land in de dagen met die plaats. */
export function placeCountry(legs: readonly Leg[], places: readonly Place[], name: string): string {
  const own = findPlace(places, name)?.country?.trim()
  if (own) return own
  const key = placeKey(name)
  const counts = new Map<string, number>()
  for (const l of active(legs)) {
    if (placeKey(l.fromPlace) === key && l.fromCountry.trim()) counts.set(l.fromCountry.trim(), (counts.get(l.fromCountry.trim()) ?? 0) + 1)
    if (placeKey(l.toPlace) === key && l.toCountry.trim()) counts.set(l.toCountry.trim(), (counts.get(l.toCountry.trim()) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** Verder dan dit van het land van de plaats: eerst vragen of de plaats klopt. */
export const FAR_FROM_COUNTRY_NM = 300
/** Een pin minder dan dit verschuiven is een kleine correctie: niet vragen. */
export const QUIET_MOVE_NM = 1

/**
 * Wat er gevraagd moet worden voordat een pin voor `name` op `point` komt; null als er niets te vragen is. Een pin
 * koppelen of vervangen gebeurt nooit stil: een bestaande pin verplaatsen, of een pin ver van het land van de plaats.
 */
export interface PinQuestion {
  name: string
  /** Bestaande pin die verplaatst zou worden (meer dan een kleine correctie). */
  existing: Place | null
  /** Afstand van de oude naar de nieuwe pin, in nm. */
  moveNm: number | null
  /** Land van de plaats waar de nieuwe pin ver vandaan ligt. */
  farFrom: string | null
}

export function pinQuestion(legs: readonly Leg[], places: readonly Place[], name: string, point: { lat: number; lon: number }): PinQuestion | null {
  const existing = findPlace(places, name)
  const moveNm = existing ? greatCircleNm(existing, point) : null
  const moving = existing !== null && moveNm !== null && moveNm >= QUIET_MOVE_NM
  const country = placeCountry(legs, places, name)
  const far = country ? distanceToCountryNm(country, point) : null
  const farFrom = far !== null && far > FAR_FROM_COUNTRY_NM ? country : null
  if (!moving && !farFrom) return null
  return { name: name.trim(), existing: moving ? existing : null, moveNm: moving ? moveNm : null, farFrom }
}

/**
 * Van, standaard: de Naar van de vorige dag binnen dezelfde trip (tot en met die datum); is die er niet, dan de basis
 * van de trip (de eerste dag begint op de basis). Nooit een plaats uit een andere trip: zonder trip of basis leeg, en
 * dan kiest het scherm de dichtstbijzijnde bekende plaats via GPS.
 */
export function defaultFromPlace(legs: readonly Leg[], trip: { id: string; base?: string } | null | undefined, date: string): string {
  if (!trip) return ''
  const previous = active(legs)
    .filter((l) => l.tripId === trip.id && l.date <= date && l.toPlace.trim())
    .sort(compareLegs)
    .at(-1)
  return previous?.toPlace.trim() ?? trip.base?.trim() ?? ''
}

/** De dichtstbijzijnde bekende plaats binnen `maxNm` (voor Van via GPS); null als er geen in de buurt is. */
export function nearestKnownPlace(places: readonly Place[], point: { lat: number; lon: number }, maxNm: number): Place | null {
  let best: Place | null = null
  let bestNm = maxNm
  for (const p of active(places)) {
    const d = greatCircleNm(p, point)
    if (d <= bestNm) {
      best = p
      bestNm = d
    }
  }
  return best
}
