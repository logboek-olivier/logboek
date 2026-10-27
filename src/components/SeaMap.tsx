import { Crosshair, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../i18n'
import { Icon } from './Icon'

// Offline zeekaart in eigen SVG: alleen land, uit public/coast/ (Natural Earth, publiek domein, meegebundeld; zie
// scripts/build-coast.mjs). Geen kaartdienst, geen netwerk buiten de eigen site; werkt op zee via de precache.
// Verschuiven met één vinger, zoomen met twee vingers of de knoppen; tikken zet een punt.

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
  onPick,
  onSelectPlace,
}: {
  center: LatLon
  places: readonly MapPlace[]
  selected: LatLon | null
  onPick: (point: LatLon) => void
  onSelectPlace: (place: MapPlace) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 360, h: 420 })
  const [view, setView] = useState(() => ({ x: mercX(center.lon), y: mercY(center.lat), zoom: 9 }))
  const [paths, setPaths] = useState<Record<string, string>>({})
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
            {(fine ? wanted : ['wereld']).map((name) => (paths[name] ? <path key={name} className="map-land" d={paths[name]} vectorEffect="non-scaling-stroke" /> : null))}
          </g>
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
