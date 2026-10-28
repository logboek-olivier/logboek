import { Crosshair, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../i18n'
import { loadLabels, loadOsmIndex, tileKey, tileUrl, type LabelKind, type OsmIndex, type OsmLabel } from '../model/osm'
import { Icon } from './Icon'

// Offline zeekaart in eigen SVG: alleen land. Overal Natural Earth uit public/coast/ (publiek domein, in de precache;
// zie scripts/build-coast.mjs). In vier vaargebieden vanaf zoom 9 gedetailleerde OpenStreetMap-kustlijnen met meren en
// namen van eilanden, havens en plaatsen (public/osm/, scripts/build-osm.mjs), pas geladen als het gebied in beeld
// komt en daarna offline bewaard; daar wordt Natural Earth weggeknipt. Geen kaartdienst, geen netwerk buiten de eigen
// site. Verschuiven met één vinger, zoomen met twee vingers of de knoppen; tikken zet een punt.

export interface LatLon {
  lat: number
  lon: number
}

export interface MapPlace extends LatLon {
  id: string
  name: string
}

const TILE_DEG = 10
const FINE_SPAN_DEG = 40
/** Wereldcoördinaten (Mercator, 0..1) maal deze factor in de SVG-paden, zodat afronding geen rol speelt. */
const WORLD = 1_000_000
const MIN_ZOOM = 2
const MAX_ZOOM = 16

type Rings = number[][]
const cache = new Map<string, Promise<string>>()
let tileIndex: Promise<Set<string>> | null = null
const osmCache = new Map<string, Promise<{ land: string; lakes: string } | null>>()
let clipCounter = 0

/** Vanaf welke zoom een soort naam verschijnt. */
const LABEL_ZOOM: Record<LabelKind, number> = { eiland: 10, plaats: 10, dorp: 12, haven: 12, eilandje: 13 }

function mercX(lon: number): number {
  return (lon + 180) / 360
}

function mercY(lat: number): number {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

function lonOf(x: number): number {
  return x * 360 - 180
}

function latOf(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
}

/** Ringen (tienduizendste graden, verschilgecodeerd) naar één SVG-pad in wereldcoördinaten. */
function toPath(rings: Rings, scale: number): string {
  const parts: string[] = []
  for (const ring of rings) {
    let x = 0
    let y = 0
    let d = ''
    for (let i = 0; i < ring.length; i += 2) {
      x += ring[i]!
      y += ring[i + 1]!
      const px = Math.round(mercX(x / scale) * WORLD)
      const py = Math.round(mercY(y / scale) * WORLD)
      d += `${i === 0 ? 'M' : 'L'}${px} ${py}`
    }
    parts.push(`${d}Z`)
  }
  return parts.join('')
}

function load(name: string): Promise<string> {
  let p = cache.get(name)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}coast/${name}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ scale: number; rings: Rings }>) : { scale: 1, rings: [] }))
      .then((d) => toPath(d.rings, d.scale))
      .catch(() => '')
    cache.set(name, p)
  }
  return p
}

function loadOsmTile(url: string): Promise<{ land: string; lakes: string } | null> {
  let p = osmCache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<{ scale: number; rings: Rings; lakes?: Rings }>) : null))
      .then((d) => (d ? { land: toPath(d.rings, d.scale), lakes: toPath(d.lakes ?? [], d.scale) } : null))
      .catch(() => null)
    // Mislukt (offline en nog nooit geladen): later opnieuw proberen.
    p.then((v) => {
      if (!v) osmCache.delete(url)
    })
    osmCache.set(url, p)
  }
  return p
}

interface OsmTile {
  id: string
  /** Null: een vak zonder land of meer (open zee); niets te laden, wel Natural Earth wegknippen. */
  url: string | null
  /** Kader in wereldcoördinaten (maal WORLD), om Natural Earth daar weg te knippen. */
  rect: [number, number, number, number]
}

function loadIndex(): Promise<Set<string>> {
  tileIndex ??= fetch(`${import.meta.env.BASE_URL}coast/vakken.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ tiles: string[] }>) : { tiles: [] }))
    .then((d) => new Set(d.tiles))
    .catch(() => new Set<string>())
  return tileIndex
}

export function SeaMap({
  center,
  places,
  selected,
  route,
  onPick,
  onSelectPlace,
}: {
  center: LatLon
  places: readonly MapPlace[]
  selected: LatLon | null
  /** Waterroute om te tekenen (bijvoorbeeld van de vorige plaats naar het gekozen punt). */
  route?: readonly LatLon[] | null
  onPick: (point: LatLon) => void
  onSelectPlace: (place: MapPlace) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 360, h: 420 })
  const [view, setView] = useState(() => ({ x: mercX(center.lon), y: mercY(center.lat), zoom: 9 }))
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [osm, setOsm] = useState<OsmIndex | null>(null)
  const [osmPaths, setOsmPaths] = useState<Record<string, { land: string; lakes: string }>>({})
  const [labels, setLabels] = useState<Record<string, OsmLabel[]>>({})
  const [clipId] = useState(() => `buiten-osm-${++clipCounter}`)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: boolean; startDist: number; startZoom: number; last: { x: number; y: number } | null }>({ moved: false, startDist: 0, startZoom: 9, last: null })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth || 360, h: el.clientHeight || 420 })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])

  // Pixels per wereldeenheid.
  const scale = 256 * 2 ** view.zoom
  const west = lonOf(view.x - size.w / 2 / scale)
  const east = lonOf(view.x + size.w / 2 / scale)
  const north = latOf(view.y - size.h / 2 / scale)
  const south = latOf(view.y + size.h / 2 / scale)
  const fine = east - west <= FINE_SPAN_DEG

  // Welke kaartbestanden nodig zijn voor het zichtbare gebied.
  const wanted = useMemo(() => {
    if (!fine) return ['wereld']
    const names: string[] = []
    for (let lon = Math.floor(west / TILE_DEG) * TILE_DEG; lon <= east; lon += TILE_DEG)
      for (let lat = Math.floor(south / TILE_DEG) * TILE_DEG; lat <= north; lat += TILE_DEG) names.push(`${lon}_${lat}`)
    return names
  }, [fine, west, east, north, south])

  useEffect(() => {
    let active = true
    void loadOsmIndex().then((index) => active && setOsm(index))
    return () => {
      active = false
    }
  }, [])

  // Gedetailleerde vakken in de vaargebieden: het fijnste niveau dat bij de zoom past.
  const osmTiles = useMemo(() => {
    const out: OsmTile[] = []
    for (const area of osm?.areas ?? []) {
      if (!(west <= area.east && area.west <= east && south <= area.north && area.south <= north)) continue
      const level = [...area.levels].sort((a, b) => b.minZoom - a.minZoom).find((l) => view.zoom >= l.minZoom)
      if (!level) continue
      const keys = new Set(level.tiles)
      const x0 = Math.max(area.west, west)
      const y0 = Math.max(area.south, south)
      for (let tx = Math.floor(x0 / level.tile) * level.tile; tx <= Math.min(area.east, east); tx += level.tile) {
        for (let ty = Math.floor(y0 / level.tile) * level.tile; ty <= Math.min(area.north, north); ty += level.tile) {
          const key = tileKey(tx, ty)
          const rect: OsmTile['rect'] = [mercX(tx) * WORLD, mercY(ty + level.tile) * WORLD, mercX(tx + level.tile) * WORLD, mercY(ty) * WORLD]
          out.push({ id: `${area.id}/${level.id}/${key}`, url: keys.has(key) ? tileUrl(area, level, key) : null, rect })
        }
      }
    }
    return out
  }, [osm, view.zoom, west, east, north, south])
  const osmAreas = useMemo(
    () => (osm?.areas ?? []).filter((a) => LABEL_ZOOM.eiland <= view.zoom && west <= a.east && a.west <= east && south <= a.north && a.south <= north),
    [osm, view.zoom, west, east, north, south],
  )

  useEffect(() => {
    let active = true
    for (const tile of osmTiles) {
      if (!tile.url) continue
      void loadOsmTile(tile.url).then((d) => {
        if (active && d) setOsmPaths((current) => (current[tile.id] ? current : { ...current, [tile.id]: d }))
      })
    }
    for (const area of osmAreas) {
      void loadLabels(area).then((list) => {
        if (active) setLabels((current) => (current[area.id] ? current : { ...current, [area.id]: list }))
      })
    }
    return () => {
      active = false
    }
  }, [osmTiles, osmAreas])

  useEffect(() => {
    let active = true
    void (async () => {
      const index = fine ? await loadIndex() : null
      for (const name of wanted) {
        if (index && !index.has(name)) continue
        const d = await load(name)
        if (!active) return
        setPaths((current) => (current[name] === d ? current : { ...current, [name]: d }))
      }
    })()
    return () => {
      active = false
    }
  }, [wanted, fine])

  const toScreen = (p: LatLon) => ({ x: (mercX(p.lon) - view.x) * scale + size.w / 2, y: (mercY(p.lat) - view.y) * scale + size.h / 2 })
  const toLatLon = (sx: number, sy: number): LatLon => ({ lon: lonOf(view.x + (sx - size.w / 2) / scale), lat: latOf(view.y + (sy - size.h / 2) / scale) })

  function zoomBy(delta: number, around?: { x: number; y: number }) {
    setView((v) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + delta))
      if (!around) return { ...v, zoom }
      const s0 = 256 * 2 ** v.zoom
      const s1 = 256 * 2 ** zoom
      const wx = v.x + (around.x - size.w / 2) / s0
      const wy = v.y + (around.y - size.h / 2) / s0
      return { zoom, x: wx - (around.x - size.w / 2) / s1, y: wy - (around.y - size.h / 2) / s1 }
    })
  }

  function local(e: ReactPointerEvent) {
    const rect = box.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    const g = gesture.current
    if (pointers.current.size === 1) {
      g.moved = false
      g.last = local(e)
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      g.startDist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      g.startZoom = view.zoom
      g.moved = true
    }
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (g.startDist > 0) {
        const target = g.startZoom + Math.log2(dist / g.startDist)
        zoomBy(target - view.zoom, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 })
      }
      return
    }
    if (!g.last) return
    const dx = p.x - g.last.x
    const dy = p.y - g.last.y
    if (!g.moved && Math.hypot(dx, dy) < 6) return
    g.moved = true
    g.last = p
    setView((v) => ({ ...v, x: v.x - dx / scale, y: v.y - dy / scale }))
  }

  function up(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current
    const wasTap = pointers.current.size === 1 && !g.moved
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) g.last = null
    if (!wasTap) return
    const p = local(e)
    // Tik dicht bij een bekende plaats: die plaats kiezen; anders een nieuw punt.
    const near = places
      .map((place) => ({ place, d: Math.hypot(toScreen(place).x - p.x, toScreen(place).y - p.y) }))
      .filter((c) => c.d <= 22)
      .sort((a, b) => a.d - b.d)[0]
    if (near) onSelectPlace(near.place)
    else onPick(toLatLon(p.x, p.y))
  }

  const transform = `translate(${size.w / 2 - view.x * scale} ${size.h / 2 - view.y * scale}) scale(${scale / WORLD})`
  const marker = selected ? toScreen(selected) : null
  const shownOsm = osmTiles.filter((tile) => !tile.url || osmPaths[tile.id])
  // Natural Earth wegknippen waar het gedetailleerde vak al getekend is.
  const clip = shownOsm.length > 0 ? `M-1 -1H${WORLD + 1}V${WORLD + 1}H-1Z${shownOsm.map(({ rect: [x0, y0, x1, y1] }) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`).join('')}` : null
  const routeLine = route && route.length > 1 ? route.map((p, i) => `${i === 0 ? 'M' : 'L'}${toScreen(p).x.toFixed(1)} ${toScreen(p).y.toFixed(1)}`).join('') : null
  const shownLabels = placeLabels(osmAreas.flatMap((a) => labels[a.id] ?? []), view.zoom, toScreen, size, places)

  return (
    <div className="sea-map">
      <div
        ref={box}
        className="sea-map-canvas"
        role="application"
        aria-label={t('map.label')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          gesture.current.last = null
        }}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 0.5 : -0.5, local(e as unknown as ReactPointerEvent))}
      >
        <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
          <rect className="map-sea" x={0} y={0} width={size.w} height={size.h} />
          <g transform={transform}>
            {clip && (
              <clipPath id={clipId}>
                <path d={clip} clipRule="evenodd" />
              </clipPath>
            )}
            <g clipPath={clip ? `url(#${clipId})` : undefined}>
              {(fine ? wanted : ['wereld']).map((name) => (paths[name] ? <path key={name} className="map-land" d={paths[name]} vectorEffect="non-scaling-stroke" /> : null))}
            </g>
            {shownOsm.map((tile) =>
              osmPaths[tile.id] ? (
                <g key={tile.id}>
                  <path className="map-land map-osm" d={osmPaths[tile.id]!.land} vectorEffect="non-scaling-stroke" />
                  {osmPaths[tile.id]!.lakes && <path className="map-lake" d={osmPaths[tile.id]!.lakes} />}
                </g>
              ) : null,
            )}
          </g>
          {routeLine && <path className="map-route" d={routeLine} />}
          {shownLabels.map((l) => (
            <text key={`${l.k}|${l.n}|${l.x}|${l.y}`} className={`map-label map-label-${l.k}`} x={l.x} y={l.y}>
              {l.n}
            </text>
          ))}
          {places.map((place) => {
            const s = toScreen(place)
            if (s.x < -40 || s.y < -20 || s.x > size.w + 40 || s.y > size.h + 20) return null
            return (
              <g key={place.id} className="map-place">
                <circle cx={s.x} cy={s.y} r={5} />
                {view.zoom >= 8 && (
                  <text x={s.x + 8} y={s.y + 4}>
                    {place.name}
                  </text>
                )}
              </g>
            )
          })}
          {marker && (
            <g className="map-marker">
              <circle cx={marker.x} cy={marker.y} r={9} />
              <circle cx={marker.x} cy={marker.y} r={3} />
            </g>
          )}
        </svg>
      </div>
      {shownOsm.length > 0 && <p className="map-attribution">{t('map.osmAttribution')}</p>}
      <div className="sea-map-controls">
        <button type="button" className="btn icon" aria-label={t('map.zoomIn')} onClick={() => zoomBy(1)}>
          <Icon icon={Plus} />
        </button>
        <button type="button" className="btn icon" aria-label={t('map.zoomOut')} onClick={() => zoomBy(-1)}>
          <Icon icon={Minus} />
        </button>
        {selected && (
          <button type="button" className="btn icon" aria-label={t('map.center')} onClick={() => setView((v) => ({ ...v, x: mercX(selected.lon), y: mercY(selected.lat) }))}>
            <Icon icon={Crosshair} />
          </button>
        )}
      </div>
    </div>
  )
}

interface ShownLabel extends OsmLabel {
  x: number
  y: number
}

/** Namen die bij deze zoom horen, zonder elkaar of de eigen plaatsen te overlappen; eilanden eerst. */
function placeLabels(all: readonly OsmLabel[], zoom: number, toScreen: (p: LatLon) => { x: number; y: number }, size: { w: number; h: number }, places: readonly MapPlace[]): ShownLabel[] {
  const order: LabelKind[] = ['eiland', 'plaats', 'haven', 'dorp', 'eilandje']
  const boxes: [number, number, number, number][] = places.map((p) => {
    const s = toScreen(p)
    return [s.x - 6, s.y - 10, s.x + 8 + p.name.length * 7, s.y + 8]
  })
  const out: ShownLabel[] = []
  for (const kind of order) {
    if (zoom < LABEL_ZOOM[kind]) continue
    for (const label of all) {
      if (label.k !== kind) continue
      const s = toScreen(label)
      if (s.x < 0 || s.y < 12 || s.x > size.w || s.y > size.h - 4) continue
      const width = label.n.length * 6.5
      const box: [number, number, number, number] = [s.x - width / 2 - 2, s.y - 11, s.x + width / 2 + 2, s.y + 3]
      if (boxes.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue
      boxes.push(box)
      out.push({ ...label, x: s.x, y: s.y })
      if (out.length >= 60) return out
    }
  }
  return out
}
