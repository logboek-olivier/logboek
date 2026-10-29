import { useMemo } from 'react'
import { t } from '../i18n'
import { active, compareLegs } from '../model/derive'
import { findPlace, placeKey } from '../model/places'
import type { Leg, Place } from '../model/types'
import { SeaMap } from './LazyMap'
import type { LatLon } from './SeaMap'

// Statistieken → "Waar ik gevaren heb": één kaart met alle routes in de gekozen periode (lijnen tussen de plaatsen met
// een pin) en de meest bezochte plaatsen, groter naarmate ze vaker voorkomen.

const TOP = 8

export function sailedRoutes(legs: readonly Leg[], places: readonly Place[], from: string, to: string): { routes: LatLon[][]; hotspots: { lat: number; lon: number; name: string; count: number }[] } {
  const own = active(legs).filter((l) => l.date >= from && l.date <= to)
  const byTrip = new Map<string, Leg[]>()
  for (const l of own) byTrip.set(l.tripId, [...(byTrip.get(l.tripId) ?? []), l])
  const routes: LatLon[][] = []
  for (const list of byTrip.values()) {
    const line: LatLon[] = []
    for (const leg of [...list].sort(compareLegs)) {
      for (const name of [leg.fromPlace, leg.toPlace]) {
        const p = name ? findPlace(places, name) : null
        if (!p) continue
        const last = line.at(-1)
        if (!last || last.lat !== p.lat || last.lon !== p.lon) line.push({ lat: p.lat, lon: p.lon })
      }
    }
    if (line.length > 1) routes.push(line)
  }
  const counts = new Map<string, { name: string; count: number; place: Place }>()
  for (const leg of own) {
    const name = leg.toPlace
    const p = name ? findPlace(places, name) : null
    if (!p) continue
    const key = placeKey(p.name)
    const c = counts.get(key) ?? { name: p.name, count: 0, place: p }
    c.count++
    counts.set(key, c)
  }
  const hotspots = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP)
    .map((c) => ({ lat: c.place.lat, lon: c.place.lon, name: c.name, count: c.count }))
  return { routes, hotspots }
}

export function SailedMap({ legs, places, from, to }: { legs: readonly Leg[]; places: readonly Place[]; from: string; to: string }) {
  const { routes, hotspots } = useMemo(() => sailedRoutes(legs, places, from, to), [legs, places, from, to])
  if (routes.length === 0 && hotspots.length === 0) return null
  const fit = [...routes.flat(), ...hotspots]
  return (
    <div className="section card card-body sailed-map">
      <div className="section-head">
        <h2>{t('stats.sailedMap')}</h2>
        <span className="muted">{t('stats.sailedMapRoutes', { n: routes.length })}</span>
      </div>
      <SeaMap center={fit[0]!} places={[]} selected={null} fit={fit} routes={routes} hotspots={hotspots} label={t('stats.sailedMapLabel', { places: hotspots.map((h) => h.name).join(', ') })} />
      {hotspots.length > 0 && <p className="muted small">{t('stats.sailedMapTop', { places: hotspots.slice(0, 5).map((h) => `${h.name} (${h.count}×)`).join(', ') })}</p>}
    </div>
  )
}
