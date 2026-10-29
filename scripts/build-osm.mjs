// Bouwt gedetailleerde OpenStreetMap-kaartdata (© OpenStreetMap-bijdragers, ODbL) voor vier vaargebieden naar
// public/osm/. Draait in GitHub Actions (.github/workflows/kaart.yml), want de bronnen staan buiten de app:
// - land: osmdata.openstreetmap.de, land-polygons-split-4326 (shapefile, uit de OSM-kustlijnen);
// - meren in Nederland (IJsselmeer, Markermeer, …) en labels (steden, dorpen, eilanden, eilandjes, baaien, marina's,
//   havens en ankerplekken): de Overpass API.
// Gebruik: node scripts/build-osm.mjs <land_polygons.shp>
//
// Uitvoer (de app laadt alleen deze bestanden van de eigen site, pas als een gebied in beeld komt, en bewaart ze
// daarna offline):
// - public/osm/gebieden.json: de gebieden met hun kader, detailniveaus, vakken, raster en grootte in bytes (voor
//   Meer → Kaarten);
// - public/osm/<gebied>/<niveau>/<vak>.json: {scale, rings, lakes}, ringen als [x0, y0, dx1, dy1, …];
// - public/osm/<gebied>/water.bin: raster water/land (run-length, zie scripts/osm-lib.mjs) voor de waterroute;
// - public/osm/<gebied>/labels.json: [{n, k, lat, lon, z}] met k = stad | dorp | eiland | eilandje | baai | marina | haven
//   | ankerplek en z = vanaf welke zoom (grote eerder dan kleine; zie labelZoom in osm-lib.mjs), belangrijkste eerst.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { assembleRings, buildLabels, clipRect, encodeRing, rasterize, readShpPolygons, ringBox, rleEncode, simplify } from './osm-lib.mjs'

export const AREAS = [
  { id: 'bovenwinds', name: { nl: 'Bovenwindse Eilanden en BVI', en: 'Leeward Islands and BVI' }, west: -65.15, south: 17.4, east: -62.55, north: 18.8 },
  { id: 'dalmatie', name: { nl: 'Dalmatië', en: 'Dalmatia' }, west: 14.2, south: 42.3, east: 18.6, north: 44.6 },
  { id: 'saronisch', name: { nl: 'Saronische Golf en Cycladen', en: 'Saronic Gulf and Cyclades' }, west: 22.8, south: 36.3, east: 26.2, north: 38.1 },
  { id: 'nederland', name: { nl: 'Nederland en de Waddenzee', en: 'The Netherlands and the Wadden Sea' }, west: 3.3, south: 51.25, east: 7.25, north: 53.65 },
]

/** Detailniveaus: vanaf welke zoom, tolerantie (graden), vakgrootte (graden) en schaal van de coördinaten. */
const LEVELS = [
  { id: 'n1', minZoom: 9, tolerance: 0.0005, tile: 1, scale: 10_000 },
  { id: 'n2', minZoom: 12, tolerance: 0.00004, tile: 0.25, scale: 100_000 },
]

/** Rastercel voor de waterroute: ongeveer 100 bij 100 meter. */
const CELL_LAT = 0.0009
/** Meren kleiner dan dit (graden², ca. 1 km²) laten we weg. */
const MIN_LAKE = 0.0001
const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'

const landPath = process.argv[2]
if (!landPath) {
  console.error('Gebruik: node scripts/build-osm.mjs <land_polygons.shp>')
  process.exit(1)
}

async function overpass(query) {
  // Alleen voor een lokale proef zonder netwerk: geen meren en geen labels.
  if (process.env.OSM_OFFLINE) return { elements: [] }
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'logboek-kaartdata (github.com/logboek-olivier/logboek)' },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (response.ok) return response.json()
    console.warn(`Overpass ${response.status}, poging ${attempt}`)
    await sleep(attempt * 30_000)
  }
  throw new Error('Overpass niet bereikbaar')
}

const bbox = (a) => `${a.south},${a.west},${a.north},${a.east}`
/** Het gebied afgerond op hele graden: vakken aan de rand lopen tot daar, dus daar moet ook het land in staan. */
const outer = (a) => ({ west: Math.floor(a.west), south: Math.floor(a.south), east: Math.ceil(a.east), north: Math.ceil(a.north) })

/** Latijnse naam: Griekse namen via name:en of int_name. */
function latinName(tags) {
  const name = tags.name ?? ''
  if (/\p{Script=Greek}/u.test(name)) return tags['name:en'] ?? tags.int_name ?? tags['name:latin'] ?? ''
  return name
}

async function labels(area) {
  const b = bbox(area)
  // Eerst elk element met zijn middelpunt (het label), dan de vlakken nog eens met hun kader (de grootte, voor de zoom
  // vanaf waar het label verschijnt).
  const data = await overpass(`[out:json][timeout:240];
(
  nwr["place"~"^(island|islet)$"]["name"](${b});
  node["place"~"^(city|town|village)$"]["name"](${b});
  nwr["natural"="bay"]["name"](${b});
  nwr["leisure"="marina"]["name"](${b});
  nwr["seamark:type"~"^(harbour|anchorage)$"]["name"](${b});
  node["harbour"="yes"]["name"](${b});
)->.all;
.all out center tags;
(way.all; relation.all;)->.vlakken;
.vlakken out bb tags;`)
  const out = buildLabels(data.elements ?? [], latinName)
  const counts = {}
  for (const l of out) counts[l.k] = (counts[l.k] ?? 0) + 1
  console.log(`${area.id} labels: ${JSON.stringify(counts)}`)
  return out
}

async function lakes(area) {
  if (area.id !== 'nederland') return []
  const b = bbox(outer(area))
  const data = await overpass(`[out:json][timeout:300];
(
  way["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"](${b});
  relation["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"](${b});
);
out geom;`)
  const rings = []
  for (const el of data.elements ?? []) {
    if (el.type === 'way' && el.geometry) rings.push(el.geometry.map((p) => [p.lon, p.lat]))
    if (el.type === 'relation') {
      const outer = (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]))
      rings.push(...assembleRings(outer))
    }
  }
  return rings.filter((r) => {
    if (r.length < 4) return false
    const [x0, y0, x1, y1] = ringBox(r)
    return (x1 - x0) * (y1 - y0) >= MIN_LAKE
  })
}

function tileKey(x, y) {
  return `${Math.round(x * 100)}_${Math.round(y * 100)}`
}

/** Vakken binnen het gebied (een groot landvlak kan ver buiten het gebied doorlopen). */
function tiled(rings, level, lonScale, area) {
  const tiles = new Map()
  for (const ring of rings) {
    const simple = simplify(ring, level.tolerance, lonScale)
    if (simple.length < 4) continue
    const box = ringBox(simple)
    const [minX, minY] = [Math.max(box[0], area.west), Math.max(box[1], area.south)]
    const [maxX, maxY] = [Math.min(box[2], area.east), Math.min(box[3], area.north)]
    if (minX > maxX || minY > maxY) continue
    for (let tx = Math.floor(minX / level.tile) * level.tile; tx < maxX; tx += level.tile) {
      for (let ty = Math.floor(minY / level.tile) * level.tile; ty < maxY; ty += level.tile) {
        const inside = box[0] >= tx && box[2] <= tx + level.tile && box[1] >= ty && box[3] <= ty + level.tile
        const part = inside ? simple : clipRect(simple, tx, ty, tx + level.tile, ty + level.tile)
        const encoded = part.length >= 3 ? encodeRing(part, level.scale) : null
        if (!encoded) continue
        const key = tileKey(tx, ty)
        if (!tiles.has(key)) tiles.set(key, [])
        tiles.get(key).push(encoded)
      }
    }
  }
  return tiles
}

// ---------- Bouwen ----------

const land = new Map(AREAS.map((a) => [a.id, []]))
for (const { box, rings } of readShpPolygons(landPath, AREAS.map(outer))) {
  for (const a of AREAS) {
    const o = outer(a)
    if (box[2] >= o.west && box[0] <= o.east && box[3] >= o.south && box[1] <= o.north) land.get(a.id).push(...rings)
  }
}

rmSync('public/osm', { recursive: true, force: true })
mkdirSync('public/osm', { recursive: true })
const index = { format: 'logboek-osm', attribution: '© OpenStreetMap-bijdragers', license: 'ODbL', areas: [] }

for (const area of AREAS) {
  const rings = land.get(area.id)
  const lonScale = Math.cos((((area.south + area.north) / 2) * Math.PI) / 180)
  const waterRings = await lakes(area)
  const areaLabels = await labels(area)
  const entry = { ...area, levels: [], grid: null, labels: areaLabels.length, bytes: 0 }
  for (const level of LEVELS) {
    const landTiles = tiled(rings, level, lonScale, outer(area))
    const lakeTiles = tiled(waterRings, level, lonScale, outer(area))
    const keys = [...new Set([...landTiles.keys(), ...lakeTiles.keys()])].sort()
    mkdirSync(`public/osm/${area.id}/${level.id}`, { recursive: true })
    let bytes = 0
    for (const key of keys) {
      const text = JSON.stringify({ scale: level.scale, rings: landTiles.get(key) ?? [], lakes: lakeTiles.get(key) ?? [] })
      bytes += text.length
      writeFileSync(`public/osm/${area.id}/${level.id}/${key}.json`, text)
    }
    entry.bytes += bytes
    entry.levels.push({ id: level.id, minZoom: level.minZoom, tile: level.tile, tiles: keys })
    console.log(`${area.id} ${level.id}: ${keys.length} vakken, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  }
  const cellLon = Math.round((CELL_LAT / lonScale) * 1e7) / 1e7
  const grid = {
    west: area.west,
    south: area.south,
    cellLon,
    cellLat: CELL_LAT,
    cols: Math.ceil((area.east - area.west) / cellLon),
    rows: Math.ceil((area.north - area.south) / CELL_LAT),
  }
  const cells = rasterize(grid, rings, waterRings)
  const rle = rleEncode(cells, grid.cols, grid.rows)
  writeFileSync(`public/osm/${area.id}/water.bin`, rle)
  entry.grid = grid
  const labelText = JSON.stringify(areaLabels)
  writeFileSync(`public/osm/${area.id}/labels.json`, labelText)
  entry.bytes += rle.length + labelText.length
  index.areas.push(entry)
  console.log(`${area.id}: ${rings.length} landringen, ${waterRings.length} meren, ${areaLabels.length} labels, raster ${grid.cols}×${grid.rows} (${(rle.length / 1024).toFixed(0)} kB)`)
}

writeFileSync('public/osm/gebieden.json', JSON.stringify(index))
