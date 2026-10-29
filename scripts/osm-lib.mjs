// Bouwstenen voor scripts/build-osm.mjs (en de tests): shapefile lezen, vereenvoudigen, knippen per vak, coderen,
// een raster water/land maken en dat compact (run-length) opslaan, en ringen samenstellen uit OpenStreetMap-wegen.
// Zonder afhankelijkheden: alleen Node.

import { closeSync, openSync, readSync } from 'node:fs'

// ---------- Shapefile (alleen polygonen, type 5) ----------

/**
 * Leest polygonen uit een .shp-bestand en geeft per record de ringen ([[lon, lat], …]) als het kader van het record een
 * van de gevraagde gebieden raakt. Leest in blokken, zodat ook een bestand van meer dan een gigabyte past.
 */
export function* readShpPolygons(path, boxes) {
  const fd = openSync(path, 'r')
  const CHUNK = 64 * 1024 * 1024
  let buffer = Buffer.alloc(CHUNK)
  let start = 0 // positie in het bestand van buffer[0]
  let length = 0 // geldige bytes in de buffer
  const ensure = (pos, n) => {
    if (pos >= start && pos + n <= start + length) return true
    if (n > buffer.length) buffer = Buffer.alloc(n * 2)
    start = pos
    length = readSync(fd, buffer, 0, buffer.length, pos)
    return length >= n
  }
  try {
    if (!ensure(0, 100)) return
    const fileBytes = buffer.readInt32BE(24) * 2
    let pos = 100
    while (pos + 8 <= fileBytes) {
      if (!ensure(pos, 8)) break
      const contentBytes = buffer.readInt32BE(pos - start + 4) * 2
      const recordStart = pos + 8
      pos = recordStart + contentBytes
      if (contentBytes < 44 || !ensure(recordStart, contentBytes)) continue
      const o = recordStart - start
      const type = buffer.readInt32LE(o)
      if (type !== 5) continue
      const minX = buffer.readDoubleLE(o + 4)
      const minY = buffer.readDoubleLE(o + 12)
      const maxX = buffer.readDoubleLE(o + 20)
      const maxY = buffer.readDoubleLE(o + 28)
      if (!boxes.some((b) => maxX >= b.west && minX <= b.east && maxY >= b.south && minY <= b.north)) continue
      const numParts = buffer.readInt32LE(o + 36)
      const numPoints = buffer.readInt32LE(o + 40)
      const partsAt = o + 44
      const pointsAt = partsAt + numParts * 4
      const rings = []
      for (let p = 0; p < numParts; p++) {
        const from = buffer.readInt32LE(partsAt + p * 4)
        const to = p + 1 < numParts ? buffer.readInt32LE(partsAt + (p + 1) * 4) : numPoints
        const ring = []
        for (let i = from; i < to; i++) ring.push([buffer.readDoubleLE(pointsAt + i * 16), buffer.readDoubleLE(pointsAt + i * 16 + 8)])
        if (ring.length >= 4) rings.push(ring)
      }
      yield { box: [minX, minY, maxX, maxY], rings }
    }
  } finally {
    closeSync(fd)
  }
}

/** Een klein .shp-bestand schrijven (alleen voor tests). */
export function writeShpPolygons(polygons) {
  const records = polygons.map((rings) => {
    const points = rings.flat()
    const content = Buffer.alloc(44 + rings.length * 4 + points.length * 16)
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    content.writeInt32LE(5, 0)
    content.writeDoubleLE(Math.min(...xs), 4)
    content.writeDoubleLE(Math.min(...ys), 12)
    content.writeDoubleLE(Math.max(...xs), 20)
    content.writeDoubleLE(Math.max(...ys), 28)
    content.writeInt32LE(rings.length, 36)
    content.writeInt32LE(points.length, 40)
    let index = 0
    rings.forEach((ring, i) => {
      content.writeInt32LE(index, 44 + i * 4)
      index += ring.length
    })
    points.forEach(([x, y], i) => {
      content.writeDoubleLE(x, 44 + rings.length * 4 + i * 16)
      content.writeDoubleLE(y, 44 + rings.length * 4 + i * 16 + 8)
    })
    return content
  })
  const header = Buffer.alloc(100)
  const total = 100 + records.reduce((n, r) => n + 8 + r.length, 0)
  header.writeInt32BE(9994, 0)
  header.writeInt32BE(total / 2, 24)
  header.writeInt32LE(1000, 28)
  header.writeInt32LE(5, 32)
  const parts = [header]
  records.forEach((r, i) => {
    const h = Buffer.alloc(8)
    h.writeInt32BE(i + 1, 0)
    h.writeInt32BE(r.length / 2, 4)
    parts.push(h, r)
  })
  return Buffer.concat(parts)
}

// ---------- Vereenvoudigen, knippen, coderen ----------

/** Douglas-Peucker, iteratief; tolerantie in graden (lengte gecorrigeerd voor de breedte). */
export function simplify(points, tolerance, lonScale = 1) {
  if (points.length <= 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  const t2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()
    const ax = points[a][0] * lonScale
    const ay = points[a][1]
    const dx = points[b][0] * lonScale - ax
    const dy = points[b][1] - ay
    const len2 = dx * dx + dy * dy
    let max = -1
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const px = points[i][0] * lonScale
      const py = points[i][1]
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
export function clipRect(ring, x0, y0, x1, y1) {
  const inside = [(p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1]
  const cross = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
  ]
  let out = ring
  for (let e = 0; e < 4 && out.length > 0; e++) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      if (inside[e](cur)) {
        if (!inside[e](prev)) out.push(cross[e](prev, cur))
        out.push(cur)
      } else if (inside[e](prev)) out.push(cross[e](prev, cur))
    }
  }
  return out
}

/** Ring naar [x0, y0, dx1, dy1, …] in 1/scale graden; null als er te weinig punten overblijven. */
export function encodeRing(ring, scale) {
  const out = []
  let px = 0
  let py = 0
  for (const [x, y] of ring) {
    const qx = Math.round(x * scale)
    const qy = Math.round(y * scale)
    if (out.length > 0 && qx === px && qy === py) continue
    out.push(qx - px, qy - py)
    px = qx
    py = qy
  }
  return out.length >= 6 ? out : null
}

export function ringBox(ring) {
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

// ---------- Raster water/land ----------

/**
 * Even-oneven scanlijn over alle ringen: 1 = water, 0 = land. Cellen zijn `cellLon` × `cellLat` graden, rij 0 is het
 * zuiden. `water` zijn ringen die daarna weer water worden (meren binnen het land, zoals het IJsselmeer).
 */
export function rasterize(grid, landRings, waterRings = []) {
  const { west, south, cellLon, cellLat, cols, rows } = grid
  const cells = new Uint8Array(cols * rows).fill(1)
  const fill = (rings, value) => {
    const crossings = Array.from({ length: rows }, () => [])
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        if (y1 === y2) continue
        const lo = Math.min(y1, y2)
        const hi = Math.max(y1, y2)
        const r0 = Math.max(0, Math.ceil((lo - south) / cellLat - 0.5))
        const r1 = Math.min(rows - 1, Math.ceil((hi - south) / cellLat - 0.5) - 1)
        for (let r = r0; r <= r1; r++) {
          const y = south + (r + 0.5) * cellLat
          crossings[r].push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      const xs = crossings[r].sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - west) / cellLon - 0.5))
        const c1 = Math.min(cols - 1, Math.ceil((xs[k + 1] - west) / cellLon - 0.5) - 1)
        if (c1 >= c0) cells.fill(value, r * cols + c0, r * cols + c1 + 1)
      }
    }
  }
  fill(landRings, 0)
  if (waterRings.length > 0) fill(waterRings, 1)
  return cells
}

function pushVarint(out, n) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  out.push(n)
}

/** Per rij afwisselend aantallen land- en watercellen (beginnend met land, eventueel 0), als varints. */
export function rleEncode(cells, cols, rows) {
  const out = []
  for (let r = 0; r < rows; r++) {
    let c = 0
    let value = 0
    while (c < cols) {
      let n = 0
      while (c < cols && cells[r * cols + c] === value) {
        n++
        c++
      }
      pushVarint(out, n)
      value ^= 1
    }
  }
  return Uint8Array.from(out)
}

// ---------- Ringen uit OpenStreetMap-wegen (Overpass, out geom) ----------

/** Open wegen aan elkaar knopen tot gesloten ringen (buitenringen van een multipolygoon); losse einden vallen weg. */
export function assembleRings(ways) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`
  const rings = []
  const open = []
  for (const w of ways) {
    if (w.length < 2) continue
    if (key(w[0]) === key(w[w.length - 1])) rings.push(w)
    else open.push([...w])
  }
  while (open.length > 0) {
    let ring = open.pop()
    let grown = true
    while (grown && key(ring[0]) !== key(ring[ring.length - 1])) {
      grown = false
      const end = key(ring[ring.length - 1])
      for (let i = 0; i < open.length; i++) {
        const w = open[i]
        if (key(w[0]) === end) ring = ring.concat(w.slice(1))
        else if (key(w[w.length - 1]) === end) ring = ring.concat([...w].reverse().slice(1))
        else continue
        open.splice(i, 1)
        grown = true
        break
      }
    }
    if (key(ring[0]) === key(ring[ring.length - 1]) && ring.length >= 4) rings.push(ring)
  }
  return rings
}

// ---------- Labels ----------

/** Soort label uit de OSM-tags; null = geen label. */
export function labelKind(tags) {
  if (tags.place === 'city' || tags.place === 'town') return 'stad'
  if (tags.place === 'village') return 'dorp'
  if (tags.place === 'island') return 'eiland'
  if (tags.place === 'islet') return 'eilandje'
  if (tags.natural === 'bay') return 'baai'
  if (tags.leisure === 'marina') return 'marina'
  if (tags['seamark:type'] === 'anchorage') return 'ankerplek'
  if (tags.harbour === 'yes' || tags['seamark:type'] === 'harbour') return 'haven'
  return null
}

/** Grootte in km (diagonaal van het kader) van een vlak, of null voor een punt. */
export function sizeKm(bounds) {
  if (!bounds) return null
  const lat = (bounds.minlat + bounds.maxlat) / 2
  const dx = (bounds.maxlon - bounds.minlon) * 111.32 * Math.cos((lat * Math.PI) / 180)
  const dy = (bounds.maxlat - bounds.minlat) * 110.57
  return Math.hypot(dx, dy)
}

/**
 * Vanaf welke zoom een label verschijnt: grote steden, eilanden en baaien eerder, kleine pas verder ingezoomd. Zo komen
 * er bij het inzoomen steeds meer namen bij.
 */
export function labelZoom(kind, tags, km) {
  const bySize = (base, offset, min, max) => (km === null || !(km > 0) ? base : Math.max(min, Math.min(max, Math.round(offset - Math.log2(km)))))
  const population = Number(tags.population) || 0
  switch (kind) {
    case 'stad':
      return tags.place === 'city' ? (population >= 250_000 ? 7 : 8) : 10
    case 'dorp':
      return population >= 3_000 ? 11 : 12
    case 'eiland':
      return bySize(11, 14, 8, 12)
    case 'eilandje':
      return km !== null && km >= 1 ? 12 : 13
    case 'baai':
      return bySize(12, 13.5, 10, 13)
    case 'marina':
    case 'haven':
      return 12
    case 'ankerplek':
      return 13
    default:
      return 13
  }
}

/** Volgorde bij gelijke zoom: wat het belangrijkst is, krijgt eerst een plek (labels overlappen elkaar nooit). */
export const LABEL_ORDER = ['stad', 'eiland', 'dorp', 'baai', 'marina', 'haven', 'ankerplek', 'eilandje']

/**
 * Labels uit de Overpass-elementen: elementen met coördinaten (`center` of `lat`/`lon`) worden labels; elementen met
 * `bounds` (dezelfde vlakken, tweede uitvoer) geven alleen de grootte. Per soort en naam binnen ca. 2 km één label;
 * gesorteerd op zoom, dan soort, dan grootte (groot eerst).
 */
export function buildLabels(elements, latinName) {
  const sizes = new Map()
  for (const el of elements) if (el.bounds) sizes.set(`${el.type}/${el.id}`, sizeKm(el.bounds))
  const out = []
  const seen = new Set()
  for (const el of elements) {
    if (el.bounds && el.lat === undefined && !el.center) continue
    const tags = el.tags ?? {}
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    const k = labelKind(tags)
    const n = latinName(tags).trim().slice(0, 40)
    if (!k || !n || typeof lat !== 'number' || typeof lon !== 'number') continue
    const key = `${k}|${n}|${lat.toFixed(2)}|${lon.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    const km = sizes.get(`${el.type}/${el.id}`) ?? null
    out.push({ n, k, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, z: labelZoom(k, tags, km), s: km === null ? 0 : Math.round(km * 10) / 10 })
  }
  out.sort((a, b) => a.z - b.z || LABEL_ORDER.indexOf(a.k) - LABEL_ORDER.indexOf(b.k) || b.s - a.s || a.n.localeCompare(b.n))
  return out.map(({ n, k, lat, lon, z }) => ({ n, k, lat, lon, z }))
}
