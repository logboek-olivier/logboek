import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { routeBetween } from '../model/estimate'
import type { RouteStop, TripRoute } from '../model/trip-route'
import { SeaMap, type LatLon, type MapStop } from './SeaMap'

// Route op de offline kaart: lijnen tussen de stops (over water als de kaartdata dat kan berekenen, anders recht),
// genummerde stops met start en eind duidelijk anders. Alleen kijken; een pin zetten gaat via "Pin zetten".

/** De lijn langs de punten: eerst recht, daarna per etappe de waterroute zodra die berekend is. */
export function useRoutePath(points: readonly LatLon[]): LatLon[] {
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|')
  const [water, setWater] = useState<Record<string, LatLon[]>>({})
  useEffect(() => {
    let active = true
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      const pair = `${a.lat},${a.lon}|${b.lat},${b.lon}`
      void routeBetween(a, b).then((r) => {
        if (active && r && r.path.length > 1) setWater((w) => (w[pair] ? w : { ...w, [pair]: r.path }))
      })
    }
    return () => {
      active = false
    }
    // key staat voor de punten zelf.
  }, [key])
  return useMemo(() => {
    if (points.length < 2) return [...points]
    const out: LatLon[] = [points[0]!]
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      const path = water[`${a.lat},${a.lon}|${b.lat},${b.lon}`]
      out.push(...(path ? path.slice(1) : [b]))
    }
    return out
    // key staat voor de punten zelf.
  }, [key, water])
}

export function stopsOf(stops: readonly RouteStop[]): MapStop[] {
  return stops.filter((s) => s.place).map((s) => ({ lat: s.place!.lat, lon: s.place!.lon, n: s.n, kind: s.kind }))
}

/** Kaart met de route van een trip of een dag; niets als geen enkele stop een pin heeft. */
export function RouteMap({ route, small = false }: { route: TripRoute; small?: boolean }) {
  const stops = useMemo(() => stopsOf(route.stops), [route])
  const points = useMemo(() => stops.map((s) => ({ lat: s.lat, lon: s.lon })), [stops])
  const path = useRoutePath(points)
  if (stops.length === 0) return null
  const label = t('route.mapLabel', { route: route.stops.map((s) => `${s.n} ${s.name}`).join(', ') })
  return <SeaMap center={points[0]!} places={[]} selected={null} route={path.length > 1 ? path : null} fit={points} stops={stops} small={small} label={label} />
}

/** Klein routeplaatje voor een kaartje in het Logboek: de lijn tussen de stops, start en eind als stip. */
export function RouteThumb({ route }: { route: TripRoute }) {
  const points = stopsOf(route.stops)
  if (points.length < 2) return <svg className="route-thumb empty" viewBox="0 0 64 48" aria-hidden="true" />
  const xs = points.map((p) => (p.lon + 180) / 360)
  const ys = points.map((p) => {
    const s = Math.sin((p.lat * Math.PI) / 180)
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
  })
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1e-6)
  const W = 64
  const H = 48
  const pad = 6
  const k = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span)
  const ox = (W - (Math.max(...xs) - x0) * k) / 2
  const oy = (H - (Math.max(...ys) - y0) * k) / 2
  const pts = points.map((_, i) => ({ x: ox + (xs[i]! - x0) * k, y: oy + (ys[i]! - y0) * k }))
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')
  const first = pts[0]!
  const last = pts.at(-1)!
  return (
    <svg className="route-thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect className="route-thumb-sea" x={0} y={0} width={W} height={H} rx={8} />
      <path className="route-thumb-line" d={d} />
      <circle className="route-thumb-start" cx={first.x} cy={first.y} r={3} />
      <circle className="route-thumb-end" cx={last.x} cy={last.y} r={3} />
    </svg>
  )
}
