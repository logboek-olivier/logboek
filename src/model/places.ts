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
 * schrijfwijze een punt op de kaart, dan krijgt `into` dat punt. Geeft een functie terug die het ongedaan maakt.
 */
export async function mergePlaces(store: Store, candidate: MergeCandidate): Promise<() => Promise<void>> {
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
  void store.sync()
  return async () => {
    const later = nowIso()
    if (legs.length > 0) await store.putMany('legs.json.enc', legs.map((l) => ({ ...l, updatedAt: later })))
    if (places.length > 0) await store.putMany('places.json.enc', places.map((p) => ({ ...p, updatedAt: later })))
    void store.sync()
  }
}

/** Een plaats zonder punt met één tik vastzetten; ongedaan maken haalt het punt weer weg. */
export async function pinPlace(store: Store, name: string, point: { lat: number; lon: number }): Promise<() => Promise<void>> {
  const before = findPlace(store.get('places.json.enc'), name)
  const saved = await savePlace(store, name, point)
  void store.sync()
  return async () => {
    const later = nowIso()
    await store.put('places.json.enc', before ? { ...before, updatedAt: later } : { ...saved, updatedAt: later, deletedAt: later })
    void store.sync()
  }
}

/** Een getypte naam die nog niet voorkomt maar lijkt op een bekende plaats: "Bedoel je …?". */
export function similarKnown(uses: readonly PlaceUse[], name: string): PlaceUse | null {
  const key = placeKey(name)
  if (!key || uses.some((u) => u.key === key)) return null
  return uses.find((u) => looksAlike(key, u.key)) ?? null
}

/** Een tijd later dan `iso` en dan nu, voor ongedaan maken. */
function laterThan(iso: string): string {
  return new Date(Math.max(Date.now(), Date.parse(iso) + 1)).toISOString()
}

function undoFor(store: Store, legs: readonly Leg[], places: readonly Place[], created: readonly Place[] = []): () => Promise<void> {
  return async () => {
    if (legs.length > 0) await store.putMany('legs.json.enc', legs.map((l) => ({ ...l, updatedAt: laterThan(l.updatedAt) })))
    const back = [...places.map((p) => ({ ...p, updatedAt: laterThan(p.updatedAt) })), ...created.map((p) => ({ ...p, updatedAt: laterThan(p.updatedAt), deletedAt: laterThan(p.updatedAt) }))]
    if (back.length > 0) await store.putMany('places.json.enc', back)
    void store.sync()
  }
}

/**
 * Hernoemen: alle dagen met deze plaats en het punt op de kaart krijgen de nieuwe naam. Bestaat de nieuwe naam al, dan
 * is het samenvoegen (zie mergePlaceInto).
 */
export async function renamePlace(store: Store, use: PlaceUse, name: string): Promise<() => Promise<void>> {
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
  void store.sync()
  return undoFor(store, legs, places)
}

/** Samenvoegen met een gekozen plaats: de dagen krijgen de naam van `into`; heeft alleen `use` een punt, dan krijgt `into` dat. */
export function mergePlaceInto(store: Store, use: PlaceUse, into: PlaceUse): Promise<() => Promise<void>> {
  return mergePlaces(store, { into, others: [use] })
}

/** Het punt weghalen: de plaats blijft als naam (in de dagen en de suggesties), zonder punt op de kaart. */
export async function removePin(store: Store, use: PlaceUse): Promise<() => Promise<void>> {
  const now = nowIso()
  const places = active(store.get('places.json.enc')).filter((p) => placeKey(p.name) === use.key)
  if (places.length > 0) await store.putMany('places.json.enc', places.map((p) => ({ ...p, updatedAt: now, deletedAt: now })))
  void store.sync()
  return undoFor(store, [], places)
}

/**
 * Een plaats verwijderen kan alleen als geen enkele dag hem gebruikt (anders zou een gelogde dag zijn plaats verliezen):
 * dan verdwijnt het punt en daarmee de plaats. Komt hij in dagen voor, dan hernoemen of samenvoegen.
 */
export async function deletePlace(store: Store, use: PlaceUse): Promise<() => Promise<void>> {
  if (use.days > 0) throw new Error('Plaats komt voor in dagen')
  return removePin(store, use)
}
