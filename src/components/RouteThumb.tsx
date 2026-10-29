import type { RouteStop, TripRoute } from '../model/trip-route'
import type { MapStop } from './SeaMap'

// Klein routeplaatje (Logboek-kaartjes) en de stops op de kaart; los van de kaart zelf, die pas laadt als hij in
// beeld komt (src/components/LazyMap.tsx).

export function stopsOf(stops: readonly RouteStop[]): MapStop[] {
  return stops.filter((s) => s.place).map((s) => ({ lat: s.place!.lat, lon: s.place!.lon, n: s.n, kind: s.kind }))
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
