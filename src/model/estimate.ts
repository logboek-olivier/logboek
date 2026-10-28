import { compareLegs, totalNm } from './derive'
import { areaAt, loadGrid, loadOsmIndex } from './osm'
import { findPlace } from './places'
import type { Leg, Place } from './types'
import { personalFactor, waterRoute, type LatLon, type WaterRoute } from './waterroute'

// Mijlenschatting zonder eerdere keren dezelfde route: de waterroute om land heen, maal Oliviers persoonlijke factor
// (gelogde nm gedeeld door de waterroute, uit zijn dagen waarvan beide plaatsen een punt hebben; zolang er te weinig
// zijn 1,2). Nooit hemelsbreed. Alles op het apparaat, met de kaartdata van de eigen site.

export interface WaterEstimate {
  /** Voorstel in nm (op een halve mijl). */
  nm: number
  /** Waterroute in nm. */
  water: number
  factor: number
  path: LatLon[]
}

/** Zoveel recente dagen gebruiken we hoogstens voor de factor. */
const FACTOR_DAYS = 20
const routes = new Map<string, Promise<WaterRoute | null>>()

const pointKey = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`

/** Waterroute tussen twee punten in hetzelfde vaargebied; null daarbuiten of zonder kaartdata. */
export function routeBetween(a: LatLon, b: LatLon): Promise<WaterRoute | null> {
  const key = `${pointKey(a)}|${pointKey(b)}`
  let p = routes.get(key)
  if (!p) {
    p = (async () => {
      const index = await loadOsmIndex()
      const area = areaAt(index, a)
      if (!area || areaAt(index, b)?.id !== area.id) return null
      const grid = await loadGrid(area)
      if (!grid) return null
      // Eerst de rest van het scherm laten tekenen.
      await new Promise((r) => setTimeout(r, 0))
      return waterRoute(grid, a, b)
    })()
    p.then((r) => {
      if (!r) routes.delete(key)
    })
    routes.set(key, p)
  }
  return p
}

/** Persoonlijke factor uit de recentste dagen waarvan beide plaatsen een punt hebben. */
export async function factorFromLegs(legs: readonly Leg[], places: readonly Place[]): Promise<{ factor: number; days: number }> {
  const samples: { nm: number; water: number }[] = []
  const recent = legs.filter((l) => l.deletedAt === null && totalNm(l) > 0).sort(compareLegs).reverse()
  for (const leg of recent) {
    if (samples.length >= FACTOR_DAYS) break
    const a = findPlace(places, leg.fromPlace)
    const b = findPlace(places, leg.toPlace)
    if (!a || !b || a.id === b.id) continue
    const route = await routeBetween(a, b)
    if (route) samples.push({ nm: totalNm(leg), water: route.nm })
  }
  return personalFactor(samples)
}

export async function estimateWater(from: LatLon, to: LatLon, legs: readonly Leg[], places: readonly Place[]): Promise<WaterEstimate | null> {
  const route = await routeBetween(from, to)
  if (!route || route.nm <= 0) return null
  const { factor } = await factorFromLegs(legs, places)
  return { nm: Math.max(0.5, Math.round(route.nm * factor * 2) / 2), water: route.nm, factor, path: route.path }
}
