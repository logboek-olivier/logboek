import { routeBetween } from './estimate'
import { greatCircleNm } from './places'
import type { LatLon } from './waterroute'

// Afstand meten op de kaart (knop Meten): twee of meer punten, de afstand over water (dezelfde waterroute als het
// mijlenvoorstel: om land heen, met een kleine veiligheidsmarge, op de kaartdata van de eigen site) en hemelsbreed.
// Over water kan alleen binnen één vaargebied; daarbuiten alleen hemelsbreed. Alles op het apparaat.

export interface Measurement {
  /** Hemelsbreed, opgeteld over de stukken. */
  straight: number
  /** Over water, opgeteld; null als een stuk buiten de vaargebieden valt of geen route over water heeft. */
  water: number | null
  /** De route over water, aan elkaar (leeg zonder waterroute). */
  path: LatLon[]
}

export function straightNm(points: readonly LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += greatCircleNm(points[i - 1]!, points[i]!)
  return total
}

export async function measure(points: readonly LatLon[]): Promise<Measurement> {
  const straight = straightNm(points)
  if (points.length < 2) return { straight, water: null, path: [] }
  const routes = await Promise.all(points.slice(1).map((p, i) => routeBetween(points[i]!, p)))
  if (routes.some((r) => r === null)) return { straight, water: null, path: [] }
  const path: LatLon[] = []
  let water = 0
  for (const route of routes) {
    water += route!.nm
    path.push(...(path.length > 0 ? route!.path.slice(1) : route!.path))
  }
  return { straight, water, path }
}
