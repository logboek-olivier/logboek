import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error: Node-script zonder typen
import { assembleRings, clipRect, encodeRing, rasterize, readShpPolygons, rleEncode, simplify, writeShpPolygons } from '../scripts/osm-lib.mjs'
import { decodeGrid, personalFactor, waterRoute, type GridMeta } from '../src/model/waterroute'

// De bouwstenen van de kaartdata (scripts/osm-lib.mjs) en de waterroute op een verzonnen raster.

const dir = mkdtempSync(join(tmpdir(), 'logboek-osm-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
]

describe('kaartdata bouwen', () => {
  it('leest polygonen uit een shapefile, alleen binnen de gevraagde gebieden', () => {
    const path = join(dir, 'land.shp')
    writeFileSync(path, writeShpPolygons([[square(16, 43, 0.1)], [square(5, 52, 0.2), square(5.05, 52.05, 0.05)], [square(100, 10, 1)]]))
    const found = [...readShpPolygons(path, [{ west: 14, south: 42, east: 18, north: 45 }, { west: 3, south: 51, east: 7, north: 54 }])]
    expect(found.map((f) => f.rings.length)).toEqual([1, 2])
    expect(found[0]!.rings[0]![2]).toEqual([16.1, 43.1])
  })

  it('vereenvoudigt, knipt per vak en codeert verschillen', () => {
    const line: [number, number][] = [
      [0, 0],
      [0.5, 0.00001],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]
    expect(simplify(line, 0.001)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ])
    const clipped = clipRect(square(0, 0, 2), 0.5, 0.5, 1.5, 1.5)
    expect(clipped.every(([x, y]: number[]) => x! >= 0.5 && x! <= 1.5 && y! >= 0.5 && y! <= 1.5)).toBe(true)
    expect(encodeRing(square(1, 2, 0.5), 10)).toEqual([10, 20, 5, 0, 0, 5, -5, 0, 0, -5])
  })

  it('stelt ringen samen uit losse wegen (een meer van twee stukken)', () => {
    const rings = assembleRings([
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [
        [0, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [5, 5],
        [6, 6],
      ],
    ])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
  })

  it('raster: land, meren weer water, run-length heen en terug', () => {
    const meta: GridMeta = { west: 0, south: 0, cellLon: 0.1, cellLat: 0.1, cols: 20, rows: 10 }
    const cells = rasterize(meta, [square(0.5, 0.2, 1)], [square(0.8, 0.4, 0.3)])
    // Land in het midden van het eiland, water erbuiten en in het meer.
    expect(cells[5 * 20 + 6]).toBe(0)
    expect(cells[5 * 20 + 9]).toBe(1)
    expect(cells[5 * 20 + 18]).toBe(1)
    const grid = decodeGrid(meta, rleEncode(cells, meta.cols, meta.rows))
    expect([...grid.water]).toEqual([...cells])
  })
})

describe('waterroute', () => {
  // Verzonnen: een eiland van west naar oost tussen twee havens; de route moet eromheen.
  const meta: GridMeta = { west: 0, south: 0, cellLon: 0.001, cellLat: 0.001, cols: 200, rows: 200 }
  const wall: [number, number][] = [
    [0.03, 0.095],
    [0.17, 0.095],
    [0.17, 0.105],
    [0.03, 0.105],
    [0.03, 0.095],
  ]
  const grid = decodeGrid(meta, rleEncode(rasterize(meta, [wall]), meta.cols, meta.rows))

  it('gaat om land heen en is nooit korter dan hemelsbreed', () => {
    const from = { lat: 0.08, lon: 0.1 }
    const to = { lat: 0.12, lon: 0.1 }
    const route = waterRoute(grid, from, to)!
    // Hemelsbreed 2,4 nm; om de west- of oostpunt ongeveer 9,2 nm, plus de marge.
    expect(route.nm).toBeGreaterThan(9)
    expect(route.nm).toBeLessThan(10.5)
    for (const p of route.path.slice(1, -1)) {
      const c = Math.floor((p.lon - meta.west) / meta.cellLon)
      const r = Math.floor((p.lat - meta.south) / meta.cellLat)
      expect(grid.water[r * meta.cols + c]).toBe(1)
    }
  })

  it('open water: ongeveer hemelsbreed', () => {
    const route = waterRoute(grid, { lat: 0.02, lon: 0.02 }, { lat: 0.02, lon: 0.18 })!
    expect(route.nm).toBeGreaterThan(9.4)
    expect(route.nm).toBeLessThan(9.9)
  })

  it('buiten het raster of zonder water in de buurt: geen route', () => {
    expect(waterRoute(grid, { lat: 1, lon: 1 }, { lat: 0.02, lon: 0.02 })).toBeNull()
  })
})

describe('persoonlijke factor', () => {
  it('mediaan van gelogd gedeeld door waterroute; te weinig dagen of uitschieters: 1,2', () => {
    expect(personalFactor([{ nm: 12, water: 10 }])).toEqual({ factor: 1.2, days: 1 })
    const days = [11, 13, 12.5, 14, 13.2, 40].map((nm) => ({ nm, water: 10 }))
    expect(personalFactor(days)).toEqual({ factor: 1.3, days: 5 })
  })
})
