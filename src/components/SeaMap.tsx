import { Crosshair, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { t } from '../i18n'
import { loadLabels, loadOsmIndex, tileKey, tileUrl, type OsmIndex, type OsmLabel } from '../model/osm'
import { Icon } from './Icon'
import { placeLabels, POINT_KINDS, rankLabels, type ShownLabel } from './map-labels'
import {
  anchorOf,
  clampView,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  FLING_MIN,
  FLING_TAU,
  flingOffset,
  gestureView,
  MAX_ZOOM,
  MIN_ZOOM,
  scaleOf,
  tapSlop,
  velocity,
  viewWith,
  worldAt,
  zoomAround,
  type Anchor,
  type MapView,
  type Point,
  type Sample,
} from './map-view'

// Offline zeekaart in eigen SVG: alleen land. Overal Natural Earth uit public/coast/ (publiek domein, in de precache;
// zie scripts/build-coast.mjs). In vier vaargebieden vanaf zoom 9 gedetailleerde OpenStreetMap-kustlijnen met meren en
// namen van eilanden, havens en plaatsen (public/osm/, scripts/build-osm.mjs), pas geladen als het gebied in beeld
// komt en daarna offline bewaard; daar wordt Natural Earth weggeknipt. Geen kaartdienst, geen netwerk buiten de eigen
// site. Eén vinger schuift (met lichte uitloop), twee vingers zoomen rond het midden tussen de vingers en schuiven
// tegelijk, dubbeltik zoomt in rond het tikpunt, de knoppen en het muiswiel zoomen ook; één tik zet een punt. De
// gebaren zelf staan als pure functies in map-view.ts. Zolang een vinger op de kaart staat, scrolt de pagina niet.

export interface LatLon {
  lat: number
  lon: number
}

export interface MapPlace extends LatLon {
  id: string
  name: string
}

/** Een genummerde stop van een route; start en eind zijn duidelijk anders getekend. */
export interface MapHotspot extends LatLon {
  name: string
  count: number
}

export interface MapStop extends LatLon {
  n: number
  kind: 'start' | 'stop' | 'end'
}

/** Middelpunt en zoom waarbij alle punten in beeld zijn, met wat ruimte langs de rand. */
export function fitView(points: readonly LatLon[], w: number, h: number): { x: number; y: number; zoom: number } {
  const xs = points.map((p) => mercX(p.lon))
  const ys = points.map((p) => mercY(p.lat))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pad = 44
  const fitX = x1 > x0 ? (w - 2 * pad) / ((x1 - x0) * 256) : Infinity
  const fitY = y1 > y0 ? (h - 2 * pad) / ((y1 - y0) * 256) : Infinity
  const fit = Math.min(fitX, fitY)
  const zoom = Number.isFinite(fit) && fit > 0 ? Math.log2(fit) : FIT_MAX_ZOOM
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.max(MIN_ZOOM, Math.min(FIT_MAX_ZOOM, zoom)) }
}

const TILE_DEG = 10
const FINE_SPAN_DEG = 40
/** Wereldcoördinaten (Mercator, 0..1) maal deze factor in de SVG-paden, zodat afronding geen rol speelt. */
const WORLD = 1_000_000
/** Niet verder inzoomen dan dit om een route of één plaats in beeld te brengen. */
const FIT_MAX_ZOOM = 12

type Rings = number[][]
const cache = new Map<string, Promise<string>>()
let tileIndex: Promise<Set<string>> | null = null
const osmCache = new Map<string, Promise<{ land: string; lakes: string } | null>>()
let clipCounter = 0

/** Vanaf deze zoom laden we de namen van een vaargebied (de grootste steden verschijnen het eerst). */
const LABELS_FROM_ZOOM = 7

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
  fit,
  stops,
  routes,
  hotspots,
  small = false,
  label,
}: {
  center: LatLon
  places: readonly MapPlace[]
  selected: LatLon | null
  /** Waterroute om te tekenen (bijvoorbeeld van de vorige plaats naar het gekozen punt). */
  route?: readonly LatLon[] | null
  /** Zonder: alleen kijken (verschuiven en zoomen), geen punt zetten. */
  onPick?: (point: LatLon) => void
  onSelectPlace?: (place: MapPlace) => void
  /** Zoom en middelpunt zo dat al deze punten in beeld zijn (route van een trip of dag). */
  fit?: readonly LatLon[]
  /** Genummerde stops van een route. */
  stops?: readonly MapStop[]
  /** Meerdere routes tegelijk (Statistieken → Waar ik gevaren heb). */
  routes?: readonly (readonly LatLon[])[]
  /** Meest bezochte plaatsen: een stip die groter is naarmate de plaats vaker voorkomt, met de naam. */
  hotspots?: readonly MapHotspot[]
  /** Kleiner kaartje (dagkaart, plaats). */
  small?: boolean
  /** Beschrijving voor schermlezers (bijvoorbeeld de route in woorden). */
  label?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 360, h: small ? 200 : 420 })
  const [view, setView] = useState<MapView>(() => clampView(fit && fit.length > 0 ? fitView(fit, 360, small ? 200 : 420) : { x: mercX(center.lon), y: mercY(center.lat), zoom: 9 }, { w: 360, h: small ? 200 : 420 }))
  // Het actuele beeld en de maat ook buiten React om (gebaren, uitloop en het muiswiel rekenen ermee tussen renders).
  const viewRef = useRef(view)
  const sizeRef = useRef(size)
  const show = (next: MapView) => {
    viewRef.current = next
    setView(next)
  }
  // Zodra de echte maat bekend is, de route nog één keer in beeld brengen (tenzij Olivier al verschoof of zoomde).
  const touched = useRef(false)
  const fitKey = fit?.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|') ?? ''
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [osm, setOsm] = useState<OsmIndex | null>(null)
  const [osmPaths, setOsmPaths] = useState<Record<string, { land: string; lakes: string }>>({})
  const [labels, setLabels] = useState<Record<string, OsmLabel[]>>({})
  const [clipId] = useState(() => `buiten-osm-${++clipCounter}`)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ anchor: Anchor | null; start: Point | null; moved: boolean; multi: boolean; stopped: boolean; type: string; samples: Sample[] }>({
    anchor: null,
    start: null,
    moved: false,
    multi: false,
    stopped: false,
    type: 'touch',
    samples: [],
  })
  const animation = useRef<number | null>(null)
  /** Doelzoom van een lopende zoomanimatie: twee keer snel op + is twee stappen. */
  const zoomTarget = useRef<number | null>(null)
  const lastTap = useRef<{ t: number; p: Point } | null>(null)
  const pendingTap = useRef<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const next = { w: el.clientWidth || 360, h: el.clientHeight || 420 }
      sizeRef.current = next
      setSize(next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])

  useEffect(() => {
    if (!fit || fit.length === 0 || touched.current) return
    show(clampView(fitView(fit, size.w, size.h), size))
    // fitKey staat voor de punten zelf; een nieuwe array met dezelfde punten verandert niets.
  }, [fitKey, size.w, size.h])

  // Muiswiel en touchpad (desktop): zoomen rond de muis, zonder dat de pagina scrolt (daarom geen passieve listener).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1
      const delta = Math.max(-0.5, Math.min(0.5, (-e.deltaY * unit) / 200))
      touched.current = true
      stopAnimation()
      show(zoomAround(viewRef.current, sizeRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }, viewRef.current.zoom + delta))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      stopAnimation()
      cancelPendingTap()
    }
    // show, stopAnimation en cancelPendingTap werken alleen met refs en de vaste setView.
  }, [])

  // Pixels per wereldeenheid.
  const scale = scaleOf(view.zoom)
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
    () => (osm?.areas ?? []).filter((a) => LABELS_FROM_ZOOM <= view.zoom && west <= a.east && a.west <= east && south <= a.north && a.south <= north),
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

  // Alle namen van de vaargebieden in beeld, belangrijkste eerst (één keer per geladen bestand).
  const rankedLabels = useMemo(() => rankLabels(osmAreas.flatMap((a) => labels[a.id] ?? [])), [osmAreas, labels])

  const toScreen = (p: LatLon) => ({ x: (mercX(p.lon) - view.x) * scale + size.w / 2, y: (mercY(p.lat) - view.y) * scale + size.h / 2 })
  const toLatLon = (sx: number, sy: number): LatLon => ({ lon: lonOf(view.x + (sx - size.w / 2) / scale), lat: latOf(view.y + (sy - size.h / 2) / scale) })

  function stopAnimation(): boolean {
    if (animation.current === null) return false
    cancelAnimationFrame(animation.current)
    animation.current = null
    zoomTarget.current = null
    return true
  }

  function cancelPendingTap() {
    if (pendingTap.current !== null) window.clearTimeout(pendingTap.current)
    pendingTap.current = null
  }

  /** Vloeiend naar een andere zoom rond punt p (knoppen, dubbeltik): het wereldpunt onder p blijft staan. */
  function zoomTo(delta: number, around?: Point) {
    touched.current = true
    const base = zoomTarget.current ?? viewRef.current.zoom
    stopAnimation()
    const from = viewRef.current
    const dims = sizeRef.current
    const p = around ?? { x: dims.w / 2, y: dims.h / 2 }
    const world = worldAt(from, dims, p)
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base + delta))
    zoomTarget.current = target
    const t0 = performance.now()
    const step = (now: number) => {
      // De tijd van het eerste beeld kan net vóór t0 liggen.
      const k = Math.max(0, Math.min(1, (now - t0) / 220))
      const eased = 1 - (1 - k) ** 3
      show(clampView(viewWith(world, p, from.zoom + (target - from.zoom) * eased, dims), dims))
      animation.current = k < 1 ? requestAnimationFrame(step) : null
      if (k >= 1) zoomTarget.current = null
    }
    animation.current = requestAnimationFrame(step)
  }

  /** Uitloop na snel schuiven: de snelheid neemt exponentieel af (licht, binnen een halve seconde vrijwel stil). */
  function fling(v: Point) {
    const from = viewRef.current
    const dims = sizeRef.current
    const s = scaleOf(from.zoom)
    const t0 = performance.now()
    const step = (now: number) => {
      const dt = Math.max(0, now - t0)
      const off = flingOffset(v, dt)
      show(clampView({ ...from, x: from.x - off.x / s, y: from.y - off.y / s }, dims))
      animation.current = Math.hypot(v.x, v.y) * Math.exp(-dt / FLING_TAU) > 0.02 ? requestAnimationFrame(step) : null
    }
    animation.current = requestAnimationFrame(step)
  }

  function local(e: ReactPointerEvent): Point {
    const rect = box.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** De vingers die meetellen: de eerste twee. */
  const fingers = () => [...pointers.current.values()].slice(0, 2)

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const g = gesture.current
    const p = local(e)
    if (pointers.current.size === 0) {
      // Een vinger die de uitloop stopt, is geen tik (dan zou stoppen meteen een punt zetten).
      g.stopped = stopAnimation()
      g.moved = false
      g.multi = false
      g.start = p
      g.type = e.pointerType
      g.samples = [{ ...p, t: e.timeStamp }]
    }
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size >= 2) {
      g.multi = true
      stopAnimation()
      cancelPendingTap()
      lastTap.current = null
    }
    g.anchor = anchorOf(viewRef.current, sizeRef.current, fingers())
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g.anchor) return
    // Binnen de tikdrempel is het nog een tik; daarna ligt de kaart weer precies onder de vinger (het anker is de plek
    // waar de vinger neerkwam).
    if (pointers.current.size === 1 && !g.moved && (!g.start || Math.hypot(p.x - g.start.x, p.y - g.start.y) < tapSlop(g.type))) return
    g.moved = true
    touched.current = true
    if (pointers.current.size === 1) {
      g.samples.push({ ...p, t: e.timeStamp })
      if (g.samples.length > 20) g.samples.shift()
    }
    show(gestureView(g.anchor, sizeRef.current, fingers()))
  }

  function release(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (!pointers.current.has(e.pointerId)) return
    const g = gesture.current
    const p = local(e)
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) {
      // Eén vinger los na knijpen: verder met de andere vinger vanaf waar die nu is (geen sprong, geen uitloop).
      g.anchor = anchorOf(viewRef.current, sizeRef.current, fingers())
      g.samples = []
      return
    }
    g.anchor = null
    if (cancelled || g.multi) return
    if (g.moved) {
      const v = velocity(g.samples, e.timeStamp)
      if (Math.hypot(v.x, v.y) >= FLING_MIN) fling(v)
      return
    }
    if (!g.stopped) tap(p, e.timeStamp)
  }

  /** Een tik: bij een tweede tik vlak erna en dichtbij inzoomen; anders (na de dubbeltiktijd) een punt kiezen. */
  function tap(p: Point, at: number) {
    const last = lastTap.current
    if (last && at - last.t <= DOUBLE_TAP_MS && Math.hypot(p.x - last.p.x, p.y - last.p.y) <= DOUBLE_TAP_PX) {
      lastTap.current = null
      cancelPendingTap()
      zoomTo(1, p)
      return
    }
    lastTap.current = { t: at, p }
    if (!onPick && !onSelectPlace) return
    // Tik dicht bij een bekende plaats: die plaats kiezen; anders een nieuw punt. Bepaald bij de tik zelf.
    const near = places
      .map((place) => ({ place, d: Math.hypot(toScreen(place).x - p.x, toScreen(place).y - p.y) }))
      .filter((c) => c.d <= 22)
      .sort((a, b) => a.d - b.d)[0]
    const point = toLatLon(p.x, p.y)
    cancelPendingTap()
    pendingTap.current = window.setTimeout(() => {
      pendingTap.current = null
      if (near) onSelectPlace?.(near.place)
      else onPick?.(point)
    }, DOUBLE_TAP_MS)
  }

  // Touchgebeurtenissen niet doorgeven: zolang een vinger op de kaart staat, geen omlaag-trekken-om-te-synchroniseren
  // (Vandaag) en geen vegen naar een andere maand (agenda). Scrollen houdt touch-action: none al tegen.
  const keepTouch = (e: ReactTouchEvent) => e.stopPropagation()

  const placeBox = (p: MapPlace): [number, number, number, number] => {
    const s = toScreen(p)
    return [s.x - 6, s.y - 10, s.x + 8 + p.name.length * 7, s.y + 8]
  }

  const transform = `translate(${size.w / 2 - view.x * scale} ${size.h / 2 - view.y * scale}) scale(${scale / WORLD})`
  const marker = selected ? toScreen(selected) : null
  const shownOsm = osmTiles.filter((tile) => !tile.url || osmPaths[tile.id])
  // Natural Earth wegknippen waar het gedetailleerde vak al getekend is.
  const clip = shownOsm.length > 0 ? `M-1 -1H${WORLD + 1}V${WORLD + 1}H-1Z${shownOsm.map(({ rect: [x0, y0, x1, y1] }) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`).join('')}` : null
  const routeLine = route && route.length > 1 ? route.map((p, i) => `${i === 0 ? 'M' : 'L'}${toScreen(p).x.toFixed(1)} ${toScreen(p).y.toFixed(1)}`).join('') : null
  // Niet over de eigen plaatsen en de genummerde stops van een route heen.
  const pointBox = (point: LatLon): [number, number, number, number] => {
    const p = toScreen(point)
    return [p.x - 12, p.y - 12, p.x + 12, p.y + 12]
  }
  // Ook niet onder de knoppen rechtsboven (48 px met 4 px ertussen, 8 px van de rand) en de naamsvermelding linksonder.
  const controls = 2 + (selected ? 1 : 0)
  const reserved: [number, number, number, number][] = [
    [size.w - 64, 0, size.w, 8 + controls * 52 + 4],
    [0, size.h - 28, 220, size.h],
  ]
  // Het gekozen punt is een cirkel van 9 px.
  const markerBox = (point: LatLon): [number, number, number, number] => {
    const p = toScreen(point)
    return [p.x - 10, p.y - 10, p.x + 10, p.y + 10]
  }
  const taken = [...places.map(placeBox), ...(stops ?? []).map(pointBox), ...(selected ? [markerBox(selected)] : []), ...reserved]
  const shownLabels = placeLabels(rankedLabels, view.zoom, toScreen, size, taken)
  const stopGroups = groupStops(stops ?? [])
  const line = (path: readonly LatLon[]) => path.map((p, i) => `${i === 0 ? 'M' : 'L'}${toScreen(p).x.toFixed(1)} ${toScreen(p).y.toFixed(1)}`).join('')
  const maxCount = Math.max(1, ...(hotspots ?? []).map((h) => h.count))

  return (
    <div className={`sea-map${small ? ' small' : ''}`}>
      <div
        ref={box}
        className="sea-map-canvas"
        role="application"
        aria-label={label ?? t('map.label')}
        data-zoom={view.zoom.toFixed(2)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onTouchStart={keepTouch}
        onTouchMove={keepTouch}
        onTouchEnd={keepTouch}
        onContextMenu={(e) => e.preventDefault()}
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
          {routes?.map((path, i) => (path.length > 1 ? <path key={i} className="map-route solid all" d={line(path)} /> : null))}
          {routeLine && <path className={`map-route${stops?.length ? ' solid' : ''}`} d={routeLine} />}
          {hotspots?.map((h) => {
            const s = toScreen(h)
            if (s.x < -40 || s.y < -20 || s.x > size.w + 40 || s.y > size.h + 20) return null
            const r = 4 + 6 * Math.sqrt(h.count / maxCount)
            return (
              <g key={`${h.lat}|${h.lon}`} className="map-hotspot">
                <circle cx={s.x} cy={s.y} r={r} />
                <text x={s.x + r + 4} y={s.y + 4}>
                  {h.name}
                </text>
              </g>
            )
          })}
          {shownLabels.map((l) => (
            <MapLabel key={`${l.k}|${l.n}|${l.lat}|${l.lon}`} label={l} />
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
          {stopGroups.map((g) => {
            const s = toScreen(g)
            if (s.x < -40 || s.y < -20 || s.x > size.w + 40 || s.y > size.h + 20) return null
            const text = g.numbers.length > 2 ? `${g.numbers[0]}…${g.numbers.at(-1)}` : g.numbers.join('·')
            const r = text.length > 2 ? 12 : 10
            return (
              <g key={`${g.lat}|${g.lon}`} className={`map-stop${g.kinds.has('start') ? ' start' : ''}${g.kinds.has('end') ? ' end' : ''}`}>
                <circle cx={s.x} cy={s.y} r={r} />
                <text x={s.x} y={s.y + 4}>
                  {text}
                </text>
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
        <button type="button" className="btn icon" aria-label={t('map.zoomIn')} disabled={(zoomTarget.current ?? view.zoom) >= MAX_ZOOM} onClick={() => zoomTo(1)}>
          <Icon icon={Plus} />
        </button>
        <button type="button" className="btn icon" aria-label={t('map.zoomOut')} disabled={(zoomTarget.current ?? view.zoom) <= MIN_ZOOM} onClick={() => zoomTo(-1)}>
          <Icon icon={Minus} />
        </button>
        {selected && (
          <button
            type="button"
            className="btn icon"
            aria-label={t('map.center')}
            onClick={() => {
              stopAnimation()
              show(clampView({ ...viewRef.current, x: mercX(selected.lon), y: mercY(selected.lat) }, sizeRef.current))
            }}
          >
            <Icon icon={Crosshair} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Stops op dezelfde plek samen (heen en terug, of start en eind in dezelfde haven). */
function groupStops(stops: readonly MapStop[]): { lat: number; lon: number; numbers: number[]; kinds: Set<MapStop['kind']> }[] {
  const groups = new Map<string, { lat: number; lon: number; numbers: number[]; kinds: Set<MapStop['kind']> }>()
  for (const s of stops) {
    const key = `${s.lat.toFixed(3)}|${s.lon.toFixed(3)}`
    const g = groups.get(key) ?? { lat: s.lat, lon: s.lon, numbers: [], kinds: new Set<MapStop['kind']>() }
    g.numbers.push(s.n)
    g.kinds.add(s.kind)
    groups.set(key, g)
  }
  return [...groups.values()]
}

/**
 * Eén naam op de kaart. Steden, dorpen, eilanden en baaien staan gecentreerd op hun punt (baaien cursief in zeeblauw);
 * marina's, havens en ankerplekken krijgen een teken op het punt met de naam ernaast.
 */
function MapLabel({ label }: { label: ShownLabel }) {
  const kind = label.k === 'plaats' ? 'stad' : label.k
  const { x, y, tx, ty, anchor } = label
  if (!POINT_KINDS.has(kind)) {
    return (
      <text className={`map-label map-label-${kind}`} x={tx} y={ty}>
        {label.text}
      </text>
    )
  }
  return (
    <g className={`map-poi map-poi-${kind}`}>
      {kind === 'ankerplek' ? (
        <g className="map-anchor">
          <circle cx={x} cy={y - 3.6} r={1.3} />
          <path d={`M${x} ${y - 2.3}V${y + 4.2}M${x - 2.2} ${y - 0.6}H${x + 2.2}M${x - 3.6} ${y + 1.3}Q${x - 3} ${y + 4.6} ${x} ${y + 4.4}Q${x + 3} ${y + 4.6} ${x + 3.6} ${y + 1.3}`} />
        </g>
      ) : (
        <circle cx={x} cy={y} r={kind === 'marina' ? 3.6 : 3} />
      )}
      <text className={`map-label map-label-${kind}${anchor === 'end' ? ' end' : ''}`} x={tx} y={ty}>
        {label.text}
      </text>
    </g>
  )
}
