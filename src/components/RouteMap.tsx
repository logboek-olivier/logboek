import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { routeBetween } from '../model/estimate'
import type { TripRoute } from '../model/trip-route'
import { stopsOf } from './RouteThumb'
import { SeaMap, type LatLon } from './SeaMap'

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

/** Kaart met de route van een trip of een dag; niets als geen enkele stop een pin heeft. */
export function RouteMap({ route, small = false }: { route: TripRoute; small?: boolean }) {
  const stops = useMemo(() => stopsOf(route.stops), [route])
  const points = useMemo(() => stops.map((s) => ({ lat: s.lat, lon: s.lon })), [stops])
  const path = useRoutePath(points)
  if (stops.length === 0) return null
  const label = t('route.mapLabel', { route: route.stops.map((s) => `${s.n} ${s.name}`).join(', ') })
  return <SeaMap center={points[0]!} places={[]} selected={null} route={path.length > 1 ? path : null} fit={points} stops={stops} small={small} label={label} />
}
