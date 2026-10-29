import { areaAt, loadOsmIndex, osmBase, osmIndexUrl, tileUrl, type OsmArea, type OsmIndex } from './osm'
import { findPlace } from './places'
import type { Leg, Place, Settings, Trip } from './types'
import { activeWeek } from './weeks'

// Gebied offline beschikbaar maken (Meer → Kaarten): alle kaartbestanden van een vaargebied (de kustlijnen op elk
// detailniveau, de namen en het waterraster voor de waterroute) in dezelfde cache die de service worker voor de kaart
// gebruikt ('kaart-osm', zie vite.config.ts: StaleWhileRevalidate). Daarna werkt de kaart in dat gebied ook zonder
// verbinding, overal en op elke zoom, en niet alleen waar Olivier al eens keek. Alleen bestanden van de eigen site;
// niets gaat naar buiten. Verwijderen haalt de bestanden van het gebied weer uit de cache (het overzicht van de
// gebieden blijft staan, dat delen ze). Het gebied van de lopende trip zet de app vanzelf offline.

export const OSM_CACHE = 'kaart-osm'

export type CacheLike = Pick<Cache, 'match' | 'put' | 'delete'>
export type CachesLike = { open(name: string): Promise<CacheLike> }

function defaultCaches(): CachesLike | null {
  return typeof caches === 'undefined' ? null : caches
}

/** Alle bestanden van een gebied, als URL's van de eigen site. */
export function areaUrls(area: OsmArea): string[] {
  const base = osmBase()
  return [
    ...area.levels.flatMap((level) => level.tiles.map((key) => tileUrl(area, level, key))),
    `${base}${area.id}/labels.json`,
    `${base}${area.id}/water.bin`,
  ]
}

export interface AreaStatus {
  cached: number
  total: number
}

export function isOffline(status: AreaStatus): boolean {
  return status.total > 0 && status.cached >= status.total
}

export async function areaStatus(area: OsmArea, store: CachesLike | null = defaultCaches()): Promise<AreaStatus> {
  const urls = areaUrls(area)
  if (!store) return { cached: 0, total: urls.length }
  const cache = await store.open(OSM_CACHE)
  const hits = await Promise.all(urls.map((u) => cache.match(u).then((r) => !!r)))
  return { cached: hits.filter(Boolean).length, total: urls.length }
}

/**
 * Alle bestanden ophalen en in de cache zetten (vier tegelijk); wat er al staat, wordt overgeslagen. Mislukt er een
 * (verbinding weg), dan stopt het met een fout: wat al binnen is, blijft staan en een volgende poging gaat verder.
 */
export async function makeOffline(
  area: OsmArea,
  onProgress?: (status: AreaStatus) => void,
  store: CachesLike | null = defaultCaches(),
  fetchImpl: typeof fetch = fetch,
  index?: string,
): Promise<void> {
  if (!store) throw new Error('geen cache')
  const cache = await store.open(OSM_CACHE)
  const urls = areaUrls(area)
  // Het overzicht van de gebieden hoort er ook bij: zonder dat weet de kaart offline niet welke vakken er zijn.
  const all = index ? [index, ...urls] : urls
  let done = 0
  const queue = [...all]
  const report = () => onProgress?.({ cached: Math.min(done, urls.length), total: urls.length })
  let failed = false
  async function worker() {
    for (let url = queue.shift(); url !== undefined && !failed; url = queue.shift()) {
      try {
        if (!(await cache.match(url))) {
          const response = await fetchImpl(url, { cache: 'no-cache' })
          if (!response.ok) throw new Error(`kaartbestand ${response.status}`)
          await cache.put(url, response)
        }
      } catch (error) {
        // Na de eerste fout geen nieuwe bestanden meer; wat al onderweg is, mag afmaken.
        failed = true
        throw error
      }
      if (url !== index) {
        done++
        report()
      }
    }
  }
  report()
  const results = await Promise.allSettled([worker(), worker(), worker(), worker()])
  const error = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (error) throw error.reason
}

export async function removeOffline(area: OsmArea, store: CachesLike | null = defaultCaches()): Promise<void> {
  if (!store) return
  const cache = await store.open(OSM_CACHE)
  await Promise.all(areaUrls(area).map((u) => cache.delete(u)))
}

/**
 * Het vaargebied van een trip: uit de punten van zijn plaatsen (van en naar van de dagen, en de basis), het gebied waar
 * de meeste in liggen. Zonder punten in een vaargebied: null.
 */
export function tripArea(index: OsmIndex | null, trip: Trip, legs: readonly Leg[], places: readonly Place[]): OsmArea | null {
  if (!index) return null
  const names = [trip.base ?? '', ...legs.filter((l) => l.tripId === trip.id && !l.deletedAt).flatMap((l) => [l.fromPlace, l.toPlace])]
  const counts = new Map<string, { area: OsmArea; n: number }>()
  for (const name of names) {
    const place = name.trim() ? findPlace(places, name) : null
    if (!place) continue
    const area = areaAt(index, place)
    if (!area) continue
    const c = counts.get(area.id) ?? { area, n: 0 }
    c.n++
    counts.set(area.id, c)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.area ?? null
}

// ---------- Vanzelf: het gebied van de lopende trip ----------

let autoId: string | null = null
const tried = new Set<string>()
const listeners = new Set<() => void>()

/** Het gebied dat de app in deze sessie vanzelf offline zette (lopende trip), of null. */
export function autoAreaId(): string | null {
  return autoId
}

export function subscribeOfflineMaps(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Het gebied van de lopende trip vanzelf offline zetten: op de achtergrond, alleen met verbinding, hoogstens één poging
 * per gebied per sessie. Lukt het niet (verbinding weg), dan blijft wat binnen is staan en probeert de volgende sessie
 * het opnieuw. Nooit in de demo (die roept dit niet aan).
 */
export async function offlineActiveTrip(trips: readonly Trip[], legs: readonly Leg[], places: readonly Place[], settings: Settings, today: string, store: CachesLike | null = defaultCaches()): Promise<void> {
  if (!store || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  const trip = activeWeek(trips, settings, today)
  if (!trip) return
  const index = await loadOsmIndex()
  const area = tripArea(index, trip, legs, places)
  if (!area || tried.has(area.id)) return
  tried.add(area.id)
  try {
    if (!isOffline(await areaStatus(area, store))) await makeOffline(area, undefined, store, fetch, osmIndexUrl())
    autoId = area.id
  } catch {
    tried.delete(area.id)
    return
  }
  for (const l of listeners) l()
}
