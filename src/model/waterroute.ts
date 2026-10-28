// Waterroute: de kortste route over water tussen twee punten, om land heen, met een kleine veiligheidsmarge. Op een
// raster van ongeveer 100 bij 100 meter per vaargebied (public/osm/<gebied>/water.bin, gebouwd door
// scripts/build-osm.mjs uit de OpenStreetMap-kustlijnen). Zonder netwerk: alleen rekenen.
//
// Werkwijze: begin- en eindpunt naar de dichtstbijzijnde watercel (havens liggen vaak net op "land"); A* met acht
// richtingen, waarbij cellen direct naast land duurder zijn (marge); daarna de route strakker trekken met
// zichtlijnen die niet over land of langs de kust gaan (behalve vlak bij begin en eind). Afstand in zeemijlen over de
// punten van de route.

export interface LatLon {
  lat: number
  lon: number
}

export interface GridMeta {
  west: number
  south: number
  cellLon: number
  cellLat: number
  cols: number
  rows: number
}

export interface WaterGrid extends GridMeta {
  /** 1 = water, 0 = land; rij 0 is het zuiden. */
  water: Uint8Array
}

export interface WaterRoute {
  /** Zeemijlen over water. */
  nm: number
  path: LatLon[]
}

/** Zo ver (in cellen) zoeken we water rond een haven die op land valt. */
const SNAP_RADIUS = 30
/** Grotere vensters rekenen we op een grover raster, zodat het ook op een telefoon snel gaat. */
const MAX_CELLS = 2_500_000
/** Een cel direct naast land kost zoveel meer (veiligheidsmarge). */
const NEAR_LAND_COST = 1.6
/** Zo dichtbij begin of eind mag de route langs de kust (havens). */
const ENDPOINT_FREE = 3

/** Run-length per rij (afwisselend land en water, beginnend met land), als varints; zie scripts/osm-lib.mjs. */
export function decodeGrid(meta: GridMeta, bytes: Uint8Array): WaterGrid {
  const water = new Uint8Array(meta.cols * meta.rows)
  let pos = 0
  const varint = () => {
    let n = 0
    let shift = 0
    for (;;) {
      const b = bytes[pos++]
      if (b === undefined) throw new Error('Raster afgekapt')
      n += (b & 0x7f) * 2 ** shift
      if (b < 0x80) return n
      shift += 7
    }
  }
  for (let r = 0; r < meta.rows; r++) {
    let c = 0
    let value = 0
    while (c < meta.cols) {
      const n = varint()
      if (value === 1) water.fill(1, r * meta.cols + c, r * meta.cols + Math.min(meta.cols, c + n))
      c += n
      value ^= 1
    }
  }
  return { ...meta, water }
}

export function inGrid(grid: GridMeta, p: LatLon): boolean {
  return p.lon >= grid.west && p.lat >= grid.south && p.lon < grid.west + grid.cols * grid.cellLon && p.lat < grid.south + grid.rows * grid.cellLat
}

const NM_PER_DEG = 60

function haversineNm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Een grof of fijn venster op het raster: cel (x, y) in het venster = blok van k × k cellen in het raster. */
interface View {
  x0: number
  y0: number
  w: number
  h: number
  k: number
  /** 1 = water. */
  cells: Uint8Array
  /** 1 = water direct naast land (of de rand van het raster). */
  near: Uint8Array
}

function makeView(grid: WaterGrid, x0: number, y0: number, x1: number, y1: number): View {
  const area = (x1 - x0 + 1) * (y1 - y0 + 1)
  const k = Math.max(1, Math.ceil(Math.sqrt(area / MAX_CELLS)))
  const w = Math.ceil((x1 - x0 + 1) / k)
  const h = Math.ceil((y1 - y0 + 1) / k)
  const cells = new Uint8Array(w * h)
  // Grof: een blok is water als er water in zit (smalle doorgangen blijven open).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let wet = 0
      for (let dy = 0; dy < k && !wet; dy++) {
        const gy = y0 + y * k + dy
        if (gy >= grid.rows) break
        const row = gy * grid.cols
        for (let dx = 0; dx < k; dx++) {
          const gx = x0 + x * k + dx
          if (gx >= grid.cols) break
          if (grid.water[row + gx]) {
            wet = 1
            break
          }
        }
      }
      cells[y * w + x] = wet
    }
  }
  const near = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue
      let n = 0
      for (let dy = -1; dy <= 1 && !n; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !cells[ny * w + nx]) {
            n = 1
            break
          }
        }
      near[y * w + x] = n
    }
  }
  return { x0, y0, w, h, k, cells, near }
}

/** Dichtstbijzijnde watercel rond (x, y) in het venster, of -1. */
function snap(view: View, x: number, y: number): number {
  const radius = Math.max(2, Math.ceil(SNAP_RADIUS / view.k))
  let best = -1
  let bestD = Infinity
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= view.w || ny >= view.h || !view.cells[ny * view.w + nx]) continue
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = ny * view.w + nx
      }
    }
  }
  return best
}

/** Binaire heap met indexen, laagste f eerst. */
class Heap {
  private ids: number[] = []
  private keys: number[] = []
  get size() {
    return this.ids.length
  }
  push(id: number, key: number) {
    const ids = this.ids
    const keys = this.keys
    let i = ids.length
    ids.push(id)
    keys.push(key)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p]! <= key) break
      ids[i] = ids[p]!
      keys[i] = keys[p]!
      i = p
    }
    ids[i] = id
    keys[i] = key
  }
  pop(): number {
    const ids = this.ids
    const keys = this.keys
    const top = ids[0]!
    const lastId = ids.pop()!
    const lastKey = keys.pop()!
    if (ids.length > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= ids.length) break
        const r = l + 1
        const c = r < ids.length && keys[r]! < keys[l]! ? r : l
        if (keys[c]! >= lastKey) break
        ids[i] = ids[c]!
        keys[i] = keys[c]!
        i = c
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}

/**
 * De kortste route over water tussen twee punten in hetzelfde raster, of null als er geen is (een punt buiten het
 * raster, geen water in de buurt, of geen verbinding).
 */
export function waterRoute(grid: WaterGrid, from: LatLon, to: LatLon): WaterRoute | null {
  if (!inGrid(grid, from) || !inGrid(grid, to)) return null
  const col = (p: LatLon) => Math.floor((p.lon - grid.west) / grid.cellLon)
  const row = (p: LatLon) => Math.floor((p.lat - grid.south) / grid.cellLat)
  const [fc, fr, tc, tr] = [col(from), row(from), col(to), row(to)]
  const span = Math.max(Math.abs(tc - fc), Math.abs(tr - fr))
  // Eerst een venster rond de twee punten; gaat de route daarbuiten (om een groot eiland heen), dan ruimer, tot het
  // hele raster.
  for (const pad of [Math.max(60, Math.ceil(span * 0.6)), Math.max(400, span * 2), grid.cols + grid.rows]) {
    const route = routeIn(grid, from, to, fc, fr, tc, tr, pad)
    if (route) return route
    if (pad >= grid.cols + grid.rows) break
  }
  return null
}

function routeIn(grid: WaterGrid, from: LatLon, to: LatLon, fc: number, fr: number, tc: number, tr: number, pad: number): WaterRoute | null {
  const x0 = Math.max(0, Math.min(fc, tc) - pad)
  const y0 = Math.max(0, Math.min(fr, tr) - pad)
  const x1 = Math.min(grid.cols - 1, Math.max(fc, tc) + pad)
  const y1 = Math.min(grid.rows - 1, Math.max(fr, tr) + pad)
  const view = makeView(grid, x0, y0, x1, y1)
  const { w, h, k } = view
  const vx = (c: number) => Math.min(w - 1, Math.floor((c - x0) / k))
  const vy = (r: number) => Math.min(h - 1, Math.floor((r - y0) / k))
  const start = snap(view, vx(fc), vy(fr))
  const goal = snap(view, vx(tc), vy(tr))
  if (start < 0 || goal < 0) return null

  // Afstanden in zeemijlen per stap (oost-west hangt af van de breedte).
  const midLat = grid.south + ((y0 + y1) / 2) * grid.cellLat
  const stepX = grid.cellLon * k * NM_PER_DEG * Math.cos((midLat * Math.PI) / 180)
  const stepY = grid.cellLat * k * NM_PER_DEG
  const stepD = Math.hypot(stepX, stepY)
  const gx = goal % w
  const gy = Math.floor(goal / w)
  const heuristic = (i: number) => {
    const dx = Math.abs((i % w) - gx) * stepX
    const dy = Math.abs(Math.floor(i / w) - gy) * stepY
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const g = new Float32Array(w * h).fill(Infinity)
  const parent = new Int32Array(w * h).fill(-1)
  const closed = new Uint8Array(w * h)
  const heap = new Heap()
  g[start] = 0
  heap.push(start, heuristic(start))
  const moves: [number, number, number][] = [
    [1, 0, stepX],
    [-1, 0, stepX],
    [0, 1, stepY],
    [0, -1, stepY],
    [1, 1, stepD],
    [1, -1, stepD],
    [-1, 1, stepD],
    [-1, -1, stepD],
  ]
  let found = false
  while (heap.size > 0) {
    const i = heap.pop()
    if (closed[i]) continue
    if (i === goal) {
      found = true
      break
    }
    closed[i] = 1
    const x = i % w
    const y = Math.floor(i / w)
    for (const [dx, dy, cost] of moves) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (!view.cells[j] || closed[j]) continue
      // Schuin langs een hoek van land: niet erdoorheen snijden.
      if (dx !== 0 && dy !== 0 && (!view.cells[y * w + nx] || !view.cells[ny * w + x])) continue
      const next = g[i]! + cost * (view.near[j] ? NEAR_LAND_COST : 1)
      if (next < g[j]!) {
        g[j] = next
        parent[j] = i
        heap.push(j, next + heuristic(j))
      }
    }
  }
  if (!found) return null

  const cells: number[] = []
  for (let i = goal; i >= 0; i = parent[i]!) {
    cells.push(i)
    if (i === start) break
  }
  cells.reverse()

  // Strakker trekken: van elk ankerpunt zo ver mogelijk vooruit met vrij zicht.
  const sx = start % w
  const sy = Math.floor(start / w)
  const nearEnd = (x: number, y: number) => Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= ENDPOINT_FREE || Math.max(Math.abs(x - gx), Math.abs(y - gy)) <= ENDPOINT_FREE
  const clear = (a: number, b: number) => {
    let x = a % w
    let y = Math.floor(a / w)
    const x2 = b % w
    const y2 = Math.floor(b / w)
    const dx = Math.abs(x2 - x)
    const dy = Math.abs(y2 - y)
    const sxs = x < x2 ? 1 : -1
    const sys = y < y2 ? 1 : -1
    let err = dx - dy
    for (;;) {
      const j = y * w + x
      if (!view.cells[j] || (view.near[j] && !nearEnd(x, y))) return false
      if (x === x2 && y === y2) return true
      const e2 = 2 * err
      // Diagonale stap: beide buurcellen moeten water zijn (geen hoek afsnijden).
      if (e2 > -dy && e2 < dx) {
        if (!view.cells[y * w + x + sxs] || !view.cells[(y + sys) * w + x]) return false
      }
      if (e2 > -dy) {
        err -= dy
        x += sxs
      }
      if (e2 < dx) {
        err += dx
        y += sys
      }
    }
  }
  const points: number[] = [cells[0]!]
  let anchor = 0
  while (anchor < cells.length - 1) {
    let next = anchor + 1
    for (let j = cells.length - 1; j > anchor + 1; j--) {
      if (clear(cells[anchor]!, cells[j]!)) {
        next = j
        break
      }
    }
    points.push(cells[next]!)
    anchor = next
  }

  const center = (i: number): LatLon => ({
    lon: grid.west + (x0 + ((i % w) + 0.5) * k) * grid.cellLon,
    lat: grid.south + (y0 + (Math.floor(i / w) + 0.5) * k) * grid.cellLat,
  })
  const path = [from, ...points.map(center), to]
  let nm = 0
  for (let i = 1; i < path.length; i++) nm += haversineNm(path[i - 1]!, path[i]!)
  return { nm: Math.round(nm * 10) / 10, path }
}

// ---------- Persoonlijke factor ----------

export const DEFAULT_FACTOR = 1.2
/** Zoveel dagen met twee punten en een waterroute zijn nodig voor een eigen factor. */
export const MIN_FACTOR_DAYS = 5

/** Gelogde nm gedeeld door de waterroute (mediaan), uit dagen waarvan beide plaatsen een punt hebben. */
export function personalFactor(samples: readonly { nm: number; water: number }[]): { factor: number; days: number } {
  const ratios = samples
    .filter((s) => s.nm > 0 && s.water >= 0.5)
    .map((s) => s.nm / s.water)
    // Uitschieters (een omweg via een andere haven, een tikfout) tellen niet mee.
    .filter((r) => r >= 0.8 && r <= 3)
    .sort((a, b) => a - b)
  if (ratios.length < MIN_FACTOR_DAYS) return { factor: DEFAULT_FACTOR, days: ratios.length }
  const mid = ratios.length / 2
  const median = ratios.length % 2 ? ratios[Math.floor(mid)]! : (ratios[mid - 1]! + ratios[mid]!) / 2
  return { factor: Math.round(Math.max(1, median) * 20) / 20, days: ratios.length }
}
