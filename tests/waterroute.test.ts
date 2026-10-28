import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { OsmIndex } from '../src/model/osm'
import { greatCircleNm } from '../src/model/places'
import { decodeGrid, waterRoute, type LatLon, type WaterGrid } from '../src/model/waterroute'

// Waterroute op de echte kaartdata (public/osm/, uit OpenStreetMap) voor bekende, openbare routes; marge 15%. Geen
// gegevens uit Oliviers logboek: de afstanden komen uit openbare bronnen (vaargidsen, veerdiensten).

const index = JSON.parse(readFileSync(new URL('../public/osm/gebieden.json', import.meta.url), 'utf8')) as OsmIndex
const grids = new Map<string, WaterGrid>()
function grid(id: string): WaterGrid {
  let g = grids.get(id)
  if (!g) {
    const area = index.areas.find((a) => a.id === id)!
    g = decodeGrid(area.grid, new Uint8Array(readFileSync(new URL(`../public/osm/${id}/water.bin`, import.meta.url))))
    grids.set(id, g)
  }
  return g
}

const ROUTES: { area: string; name: string; from: LatLon; to: LatLon; nm: number }[] = [
  // Drake Channel, Tortola naar de Bight van Norman Island: 6–7 nm.
  { area: 'bovenwinds', name: 'Road Town → Norman Island (The Bight)', from: { lat: 18.4205, lon: -64.6125 }, to: { lat: 18.3175, lon: -64.6172 }, nm: 6.5 },
  // Veerdienst Split–Supetar (Brač): ongeveer 9 nm.
  { area: 'dalmatie', name: 'Split → Supetar', from: { lat: 43.5025, lon: 16.4405 }, to: { lat: 43.3848, lon: 16.5518 }, nm: 9 },
  // Split naar Hvar-stad via de Splitska vrata, om Brač heen: 19–24 nm.
  { area: 'dalmatie', name: 'Split → Hvar', from: { lat: 43.5025, lon: 16.4405 }, to: { lat: 43.1715, lon: 16.4415 }, nm: 21.5 },
  // Piraeus naar de haven van Aegina: 16–17,8 nm.
  { area: 'saronisch', name: 'Piraeus → Aegina', from: { lat: 37.9415, lon: 23.6365 }, to: { lat: 37.7465, lon: 23.4265 }, nm: 16.5 },
  // Marsdiep, Den Helder naar 't Horntje (Texel): ongeveer 2,5 nm.
  { area: 'nederland', name: "Den Helder → 't Horntje (Texel)", from: { lat: 52.9645, lon: 4.7795 }, to: { lat: 53.0015, lon: 4.7955 }, nm: 2.5 },
]

describe('waterroute op openbare routes (marge 15%)', () => {
  for (const r of ROUTES) {
    it(r.name, () => {
      const route = waterRoute(grid(r.area), r.from, r.to)
      expect(route, r.name).not.toBeNull()
      expect(route!.nm).toBeGreaterThanOrEqual(r.nm * 0.85)
      expect(route!.nm).toBeLessThanOrEqual(r.nm * 1.15)
      // Nooit korter dan hemelsbreed.
      expect(route!.nm).toBeGreaterThanOrEqual(greatCircleNm(r.from, r.to) - 0.05)
    })
  }

  it('Split → Hvar gaat om Brač heen, niet eroverheen', () => {
    const g = grid('dalmatie')
    const route = waterRoute(g, ROUTES[2]!.from, ROUTES[2]!.to)!
    for (let i = 1; i < route.path.length - 2; i++) {
      // Elk stuk tussen twee punten van de route ligt over water (getest op tien tussenpunten).
      for (let s = 0; s <= 10; s++) {
        const a = route.path[i]!
        const b = route.path[i + 1]!
        const p = { lat: a.lat + ((b.lat - a.lat) * s) / 10, lon: a.lon + ((b.lon - a.lon) * s) / 10 }
        const c = Math.floor((p.lon - g.west) / g.cellLon)
        const rr = Math.floor((p.lat - g.south) / g.cellLat)
        expect(g.water[rr * g.cols + c], `${p.lat},${p.lon}`).toBe(1)
      }
    }
  })
})
