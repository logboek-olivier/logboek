import { describe, expect, it } from 'vitest'
import { areaStatus, areaUrls, isOffline, makeOffline, removeOffline, tripArea, type CacheLike, type CachesLike } from '../src/model/offline-maps'
import type { OsmArea, OsmIndex } from '../src/model/osm'
import type { Leg, Place, Trip } from '../src/model/types'

// Gebied offline beschikbaar maken: alle kaartbestanden van een vaargebied in de kaartcache van de service worker,
// verwijderen, en het gebied van een trip uit de punten van zijn plaatsen. Nepgebieden, nepcache.

const T = '2026-10-01T00:00:00.000Z'
const AREA: OsmArea = {
  id: 'nep',
  name: { nl: 'Nepgebied', en: 'Fake area' },
  west: 10,
  south: 40,
  east: 11,
  north: 41,
  levels: [
    { id: 'n1', minZoom: 9, tile: 1, tiles: ['1000_4000'] },
    { id: 'n2', minZoom: 12, tile: 0.25, tiles: ['1000_4000', '1025_4000'] },
  ],
  grid: { west: 10, south: 40, cellLon: 0.001, cellLat: 0.001, cols: 10, rows: 10 },
  bytes: 1234,
}
const OTHER: OsmArea = { ...AREA, id: 'ander', west: 20, east: 21 }
const INDEX: OsmIndex = { format: 'logboek-osm', attribution: '© OpenStreetMap-bijdragers', areas: [AREA, OTHER] }

function fakeCaches(): CachesLike & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  const cache: CacheLike = {
    match: async (url) => (entries.has(String(url)) ? new Response(entries.get(String(url))) : undefined),
    put: async (url, response) => {
      entries.set(String(url), await response.text())
    },
    delete: async (url) => entries.delete(String(url)),
  }
  return { entries, open: async () => cache }
}

const okFetch = (async (url: string | URL | Request) => new Response(`inhoud ${String(url)}`)) as typeof fetch

describe('offline beschikbaar maken', () => {
  it('alle vakken van elk niveau, de namen en het waterraster', () => {
    expect(areaUrls(AREA)).toEqual([
      '/osm/nep/n1/1000_4000.json',
      '/osm/nep/n2/1000_4000.json',
      '/osm/nep/n2/1025_4000.json',
      '/osm/nep/labels.json',
      '/osm/nep/water.bin',
    ])
  })

  it('ophalen, status, en verwijderen (het overzicht van de gebieden blijft)', async () => {
    const caches = fakeCaches()
    expect(await areaStatus(AREA, caches)).toEqual({ cached: 0, total: 5 })
    const progress: number[] = []
    await makeOffline(AREA, (s) => progress.push(s.cached), caches, okFetch, '/osm/gebieden.json')
    const status = await areaStatus(AREA, caches)
    expect(isOffline(status)).toBe(true)
    expect(progress.at(-1)).toBe(5)
    expect(caches.entries.has('/osm/gebieden.json')).toBe(true)
    await removeOffline(AREA, caches)
    expect(await areaStatus(AREA, caches)).toEqual({ cached: 0, total: 5 })
    expect([...caches.entries.keys()]).toEqual(['/osm/gebieden.json'])
  })

  it('verbinding weg halverwege: fout, wat binnen is blijft, een tweede poging gaat verder', async () => {
    const caches = fakeCaches()
    let calls = 0
    const flaky = (async (url: string | URL | Request) => {
      calls++
      if (calls === 3) throw new TypeError('Failed to fetch')
      return new Response(`inhoud ${String(url)}`)
    }) as typeof fetch
    await expect(makeOffline(AREA, undefined, caches, flaky)).rejects.toThrow()
    const partial = await areaStatus(AREA, caches)
    expect(partial.cached).toBeGreaterThan(0)
    expect(isOffline(partial)).toBe(false)
    // De tweede poging haalt alleen op wat nog ontbrak.
    let second = 0
    const counting = (async (url: string | URL | Request) => {
      second++
      return new Response(`inhoud ${String(url)}`)
    }) as typeof fetch
    await makeOffline(AREA, undefined, caches, counting)
    expect(isOffline(await areaStatus(AREA, caches))).toBe(true)
    expect(second).toBe(5 - partial.cached)
  })

  it('een fout van de server (404) zet niets in de cache', async () => {
    const caches = fakeCaches()
    const missing = (async () => new Response('', { status: 404 })) as typeof fetch
    await expect(makeOffline(AREA, undefined, caches, missing)).rejects.toThrow()
    expect(caches.entries.size).toBe(0)
  })

  it('zonder Cache API: niet offline, en niets te doen', async () => {
    expect(await areaStatus(AREA, null)).toEqual({ cached: 0, total: 5 })
    await expect(makeOffline(AREA, undefined, null)).rejects.toThrow()
  })
})

describe('gebied van een trip', () => {
  const place = (name: string, lat: number, lon: number): Place => ({ id: name, name, lat, lon, updatedAt: T, deletedAt: null })
  const trip: Trip = { id: 't', name: 'Nep', base: 'Nephaven', updatedAt: T, deletedAt: null }
  const leg = (from: string, to: string): Leg => ({
    id: `${from}-${to}`,
    tripId: 't',
    date: '2026-10-02',
    fromPlace: from,
    fromCountry: '',
    toPlace: to,
    toCountry: '',
    role: 'schipper',
    boat: '',
    nmInland: 0,
    nmSea: 1,
    nmTidal: 0,
    nightHours: 0,
    dateEstimated: false,
    source: 'manual',
    updatedAt: T,
    deletedAt: null,
  })

  it('het gebied waar de meeste plaatsen van de trip liggen; plaatsen zonder punt tellen niet', () => {
    const places = [place('Nephaven', 40.5, 10.5), place('Nepbaai', 40.6, 10.6), place('Verweg', 40.5, 20.5)]
    expect(tripArea(INDEX, trip, [leg('Nephaven', 'Nepbaai'), leg('Nepbaai', 'Zonder punt')], places)?.id).toBe('nep')
    expect(tripArea(INDEX, { ...trip, base: '' }, [leg('Verweg', 'Zonder punt')], places)?.id).toBe('ander')
    expect(tripArea(INDEX, { ...trip, base: '' }, [], places)).toBeNull()
    expect(tripArea(null, trip, [], places)).toBeNull()
  })
})
