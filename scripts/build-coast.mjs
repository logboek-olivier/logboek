// Bouwt de offline kaart (public/coast/) uit Natural Earth (publiek domein, naturalearthdata.com).
// Gebruik: node scripts/build-coast.mjs <ne_10m_land.geojson> <ne_10m_minor_islands.geojson> <ne_50m_land.geojson>
// Bronbestanden: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
//
// Uitvoer, alleen land als polygonen, coördinaten in tienduizendste graden:
// - public/coast/wereld.json: grof (50m-bron), voor uitgezoomd;
// - public/coast/<lon>_<lat>.json: fijn (10m-bron plus kleine eilanden), per vak van 10 × 10 graden, alleen vakken
//   met land. Elke ring is [x0, y0, dx1, dy1, …] (eerste punt absoluut, daarna verschillen).
// De app laadt alleen deze bestanden van de eigen site (geen kaartdienst; werkt offline via de precache).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const TILE = 10
const SCALE = 10000
const FINE_TOLERANCE = 0.0012
const COARSE_TOLERANCE = 0.04
const [landPath, islandsPath, coarsePath] = process.argv.slice(2)
if (!landPath || !islandsPath || !coarsePath) {
  console.error('Gebruik: node scripts/build-coast.mjs <ne_10m_land> <ne_10m_minor_islands> <ne_50m_land>')
  process.exit(1)
}

function rings(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const out = []
  for (const feature of data.features) {
    const g = feature.geometry
    if (!g) continue
    const polygons = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
    for (const polygon of polygons) for (const ring of polygon) out.push(ring)
  }
  return out
}

/** Douglas-Peucker, iteratief. */
function simplify(points, tolerance) {
  if (points.length <= 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  const t2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let max = -1
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      let d2
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
      }
      if (d2 > max) {
        max = d2
        index = i
      }
    }
    if (max > t2) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Sutherland-Hodgman tegen een rechthoek; genoeg voor gevulde landvlakken. */
function clip(ring, x0, y0, x1, y1) {
  const edges = [
    (p) => p[0] >= x0,
    (p) => p[0] <= x1,
    (p) => p[1] >= y0,
    (p) => p[1] <= y1,
  ]
  const cross = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
  ]
  let out = ring
  for (let e = 0; e < 4; e++) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      const inCur = edges[e](cur)
      const inPrev = edges[e](prev)
      if (inCur) {
        if (!inPrev) out.push(cross[e](prev, cur))
        out.push(cur)
      } else if (inPrev) out.push(cross[e](prev, cur))
    }
    if (out.length === 0) break
  }
  return out
}

function encode(ring) {
  const out = []
  let px = 0
  let py = 0
  for (const [x, y] of ring) {
    const qx = Math.round(x * SCALE)
    const qy = Math.round(y * SCALE)
    if (out.length > 0 && qx === px && qy === py) continue
    out.push(qx - px, qy - py)
    px = qx
    py = qy
  }
  return out.length >= 6 ? out : null
}

function bbox(ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

rmSync('public/coast', { recursive: true, force: true })
mkdirSync('public/coast', { recursive: true })

// Grof: één bestand.
const coarse = rings(coarsePath)
  .map((r) => encode(simplify(r, COARSE_TOLERANCE)))
  .filter(Boolean)
writeFileSync('public/coast/wereld.json', JSON.stringify({ scale: SCALE, rings: coarse }))

// Fijn: per vak van 10 × 10 graden.
const tiles = new Map()
for (const ring of [...rings(landPath), ...rings(islandsPath)]) {
  const simple = simplify(ring, FINE_TOLERANCE)
  if (simple.length < 4) continue
  const [minX, minY, maxX, maxY] = bbox(simple)
  for (let tx = Math.floor(minX / TILE) * TILE; tx <= maxX; tx += TILE) {
    for (let ty = Math.floor(minY / TILE) * TILE; ty <= maxY; ty += TILE) {
      const inside = minX >= tx && maxX <= tx + TILE && minY >= ty && maxY <= ty + TILE
      const part = inside ? simple : clip(simple, tx, ty, tx + TILE, ty + TILE)
      const encoded = part.length >= 3 ? encode(part) : null
      if (!encoded) continue
      const key = `${tx}_${ty}`
      if (!tiles.has(key)) tiles.set(key, [])
      tiles.get(key).push(encoded)
    }
  }
}
let total = 0
for (const [key, list] of tiles) {
  const text = JSON.stringify({ scale: SCALE, rings: list })
  total += text.length
  writeFileSync(`public/coast/${key}.json`, text)
}
writeFileSync('public/coast/vakken.json', JSON.stringify({ tile: TILE, tiles: [...tiles.keys()].sort() }))
console.log(`wereld.json ${coarse.length} ringen; ${tiles.size} vakken, samen ${(total / 1024 / 1024).toFixed(1)} MB`)
