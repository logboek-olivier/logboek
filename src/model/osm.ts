import { decodeGrid, type GridMeta, type LatLon, type WaterGrid } from './waterroute'

// Gedetailleerde kaartdata uit OpenStreetMap (© OpenStreetMap-bijdragers, ODbL) voor vier vaargebieden, gebouwd door
// scripts/build-osm.mjs naar public/osm/. Alleen van de eigen site, pas geladen als een gebied nodig is; de service
// worker bewaart het daarna offline. Zonder data (offline nog nooit geladen, of buiten de gebieden) valt de kaart terug
// op Natural Earth en is er geen waterroute.

export interface OsmLevel {
  id: string
  minZoom: number
  /** Vakgrootte in graden. */
  tile: number
  tiles: string[]
}

export interface OsmArea {
  id: string
  name: { nl: string; en: string }
  west: number
  south: number
  east: number
  north: number
  levels: OsmLevel[]
  grid: GridMeta
}

export interface OsmIndex {
  format: 'logboek-osm'
  attribution: string
  areas: OsmArea[]
}

/** Soorten namen op de kaart; `plaats` is de oude naam van `stad` (kaartdata van vóór de soorten). */
export type LabelKind = 'stad' | 'plaats' | 'dorp' | 'eiland' | 'eilandje' | 'baai' | 'marina' | 'haven' | 'ankerplek'

export interface OsmLabel {
  n: string
  k: LabelKind
  lat: number
  lon: number
  /** Vanaf welke zoom het label verschijnt (ontbreekt in oudere kaartdata: dan per soort). */
  z?: number
}

const base = () => `${import.meta.env.BASE_URL}osm/`
let index: Promise<OsmIndex | null> | null = null
const grids = new Map<string, Promise<WaterGrid | null>>()
const labels = new Map<string, Promise<OsmLabel[]>>()

function isIndex(value: unknown): value is OsmIndex {
  return typeof value === 'object' && value !== null && (value as OsmIndex).format === 'logboek-osm' && Array.isArray((value as OsmIndex).areas)
}

/** De gebieden; null als de data er (nog) niet is. Een mislukte poging wordt later opnieuw gedaan. */
export function loadOsmIndex(): Promise<OsmIndex | null> {
  index ??= fetch(`${base()}gebieden.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: unknown) => (isIndex(d) ? d : null))
    .catch(() => null)
    .then((d) => {
      if (!d) index = null
      return d
    })
  return index
}

export function areaAt(idx: OsmIndex | null, p: LatLon): OsmArea | null {
  return idx?.areas.find((a) => p.lon >= a.west && p.lon < a.east && p.lat >= a.south && p.lat < a.north) ?? null
}

export function tileUrl(area: OsmArea, level: OsmLevel, key: string): string {
  return `${base()}${area.id}/${level.id}/${key}.json`
}

export function tileKey(x: number, y: number): string {
  return `${Math.round(x * 100)}_${Math.round(y * 100)}`
}

/** Raster water/land van een gebied voor de waterroute. */
export function loadGrid(area: OsmArea): Promise<WaterGrid | null> {
  let p = grids.get(area.id)
  if (!p) {
    p = fetch(`${base()}${area.id}/water.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? decodeGrid(area.grid, new Uint8Array(b)) : null))
      .catch(() => null)
    p.then((g) => {
      if (!g) grids.delete(area.id)
    })
    grids.set(area.id, p)
  }
  return p
}

export function loadLabels(area: OsmArea): Promise<OsmLabel[]> {
  let p = labels.get(area.id)
  if (!p) {
    p = fetch(`${base()}${area.id}/labels.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: unknown) => (Array.isArray(d) ? (d as OsmLabel[]) : []))
      .catch(() => [])
    labels.set(area.id, p)
  }
  return p
}
