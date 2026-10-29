import { Suspense, type ComponentProps } from 'react'
import { lazyComponent } from '../lazy'
import type { RouteMap as RouteMapComponent } from './RouteMap'
import type { SeaMap as SeaMapComponent } from './SeaMap'

// De kaart (SVG, kustlijnen, waterroute) laadt pas als hij in beeld komt; tot dan een rustig vlak van dezelfde maat.

const LoadedRouteMap = lazyComponent(() => import('./RouteMap').then((m) => m.RouteMap))
const LoadedSeaMap = lazyComponent(() => import('./SeaMap').then((m) => m.SeaMap))

function Placeholder({ small }: { small?: boolean }) {
  return (
    <div className={`sea-map${small ? ' small' : ''}`} aria-hidden="true">
      <div className="sea-map-canvas map-placeholder" />
    </div>
  )
}

export function RouteMap(props: ComponentProps<typeof RouteMapComponent>) {
  // Zonder stop met een pin tekent RouteMap niets: dan ook geen vlak tijdens het laden.
  if (!props.route.stops.some((s) => s.place)) return null
  return (
    <Suspense fallback={<Placeholder small={props.small} />}>
      <LoadedRouteMap {...props} />
    </Suspense>
  )
}

export function SeaMap(props: ComponentProps<typeof SeaMapComponent>) {
  return (
    <Suspense fallback={<Placeholder small={props.small} />}>
      <LoadedSeaMap {...props} />
    </Suspense>
  )
}
