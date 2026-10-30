import { MapPin, Pencil, Share2 } from 'lucide-react'
import { Suspense, useState } from 'react'
import { formatDateRangeShort, formatHours, formatNm, formatNumber } from '../format'
import { t } from '../i18n'
import { nameWithCounter, type TripCounter } from '../model/counters'
import { placeUses } from '../model/places'
import { routeOf } from '../model/trip-route'
import type { Leg, StayPeriod, Trip } from '../model/types'
import { tripDayCounts, weekView, type WeekView } from '../model/weeks'
import { stayPeriod, waterPeriod } from '../model/periods'
import { PeriodPage } from './PeriodPage'
import { StaySheet } from './StaySheet'
import type { AddInit } from '../screens/QuickAdd'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { boatLine, tripDaysText } from './boat-line'
import { Icon } from './Icon'
import { lazyComponent } from '../lazy'
import { IncompleteBadge } from './Incomplete'
import { tripIncomplete } from '../model/gaps'
import { PinSheet } from './PinSheet'
import { RouteMap } from './LazyMap'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { organisationLabel, WeekSheet, weekTypeLabel } from './WeekSheet'

// Tripoverzicht (lopende trip in Deze trip, en elke eerdere trip uit het Logboek): kop "SV #3 · BVI · 8–21 nov ·
// Lagoon 42", een kaart met de hele route (lijnen tussen de stops, genummerde stops, start en eind duidelijk), plaatsen
// zonder pin met "Pin zetten", totalen, de dagen, deelnemers en planning. Alles eerst bekijken; bewerken via het potlood.

// Trip delen (afbeelding of PDF) laadt pas bij de tik.
const TripShareSheet = lazyComponent(() => import('./TripShare').then((m) => m.TripShareSheet))

/** De kop: "SV #3 · BVI · 8–21 nov · Lagoon 42". */
export function tripTitle(view: WeekView, counter: TripCounter | undefined): string {
  const range = view.startDate && view.endDate ? formatDateRangeShort(view.startDate, view.endDate) : ''
  return [nameWithCounter(view.trip, counter), range, view.trip.boatModel || view.trip.boat || view.boat].filter(Boolean).join(' · ')
}

/** Soort periode, bij werk met het subtype: "Werk · Les geven", "Training", "Plezier". */
export function kindLine(view: Pick<WeekView, 'kind' | 'type'>): string {
  if (view.kind !== 'werk') return t(`periodKind.${view.kind}`)
  return view.type === 'overig' ? t('periodKind.werk') : `${t('periodKind.werk')} · ${weekTypeLabel(view.type)}`
}

/** `compact`: zonder de titel (in het tripoverzicht staat die al bovenaan het blad). */
export function TripHead({ view, counter, onEdit, legs, compact = false }: { view: WeekView; counter: TripCounter | undefined; onEdit?: () => void; legs: readonly Leg[]; compact?: boolean }) {
  const trip = view.trip
  return (
    <div className="card trip-head">
      <div className="trip-head-title">
        {compact ? (
          tripIncomplete(trip, legs) && <IncompleteBadge />
        ) : (
          <h2>
            {tripTitle(view, counter)} {tripIncomplete(trip, legs) && <IncompleteBadge />}
          </h2>
        )}
        {onEdit && (
          <button type="button" className="btn icon" aria-label={`${t('week.edit')}: ${trip.name}`} onClick={onEdit}>
            <Icon icon={Pencil} />
          </button>
        )}
      </div>
      <p className="muted small">{[kindLine(view), trip.organisation ? organisationLabel(trip.organisation) : '', trip.area].filter(Boolean).join(' · ')}</p>
      <p className="muted small trip-day-count">{tripDaysText(view)}</p>
      <p className="muted small">{boatLine(trip, legs.find((l) => l.tripId === trip.id)?.boat)}</p>
      {(trip.base || trip.charter) && <p className="muted small">{[trip.base, trip.charter].filter(Boolean).join(' · ')}</p>}
    </div>
  )
}

/** Kaart met de route, plaatsen zonder pin, en de totalen. */
export function TripRouteSection({ store, view, notify }: { store: Store; view: WeekView; notify: Notify }) {
  const places = useCollection(store, 'places.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const [pinning, setPinning] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const route = routeOf(view.legs, places)
  const use = pinning ? placeUses(legs, places).find((u) => u.name.toLowerCase() === pinning.toLowerCase()) ?? null : null
  return (
    <div className="section stack trip-route">
      <RouteMap route={route} />
      {route.unpinned.length > 0 && (
        <div className="stack-sm">
          <h3>{t('trip.unpinned')}</h3>
          <ul className="rows">
            {route.unpinned.map((name) => (
              <li key={name} className="row-item">
                <span className="row-main">{name}</span>
                <button type="button" className="btn small" onClick={() => setPinning(name)}>
                  <Icon icon={MapPin} />
                  {t('place.setPin')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="grid grid-3 trip-totals">
        <div className="stat">
          <dt>{t('stat.total')}</dt>
          <dd>{formatNm(route.nm)}</dd>
        </div>
        <div className="stat">
          <dt>{t('stat.days')}</dt>
          <dd>{formatNumber(tripDayCounts(view).days ?? route.days)}</dd>
        </div>
        <div className="stat">
          <dt>{t('trip.logged')}</dt>
          <dd>{formatNumber(tripDayCounts(view).logged)}</dd>
        </div>
        {route.nightHours > 0 && (
          <div className="stat">
            <dt>{t('stat.nightHours')}</dt>
            <dd>{formatHours(route.nightHours)}</dd>
          </div>
        )}
      </dl>
      {view.legs.length > 0 && (
        <button type="button" className="btn" onClick={() => setSharing(true)}>
          <Icon icon={Share2} />
          {t('tripShare.open')}
        </button>
      )}
      {use && <PinSheet store={store} use={use} notify={notify} onClose={() => setPinning(null)} />}
      {sharing && (
        <Suspense fallback={null}>
          <TripShareSheet store={store} trip={view.trip} onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </div>
  )
}

/**
 * Een trip in een onderblad (uit het Logboek, de agenda, Vandaag, de komende trips en de lijst met periodes): de
 * periodepagina, bewerken via het potlood.
 */
export function TripOverviewSheet({ store, trip, notify, onClose, onAddDay }: { store: Store; trip: Trip; notify: Notify; onClose: () => void; onAddDay?: (init: AddInit) => void }) {
  const [editing, setEditing] = useState(false)
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const counters = useCounters(store)
  const current = trips.find((x) => x.id === trip.id)
  if (!current || current.deletedAt !== null) return null
  if (editing) return <WeekSheet store={store} trip={current} notify={notify} onClose={onClose} />
  const view = weekView(current, legs)
  return (
    <Sheet title={tripTitle(view, counters.get(current.id))} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="view trip-overview">
        <PeriodPage store={store} period={waterPeriod(view)} notify={notify} mode="sheet" onAddDay={onAddDay} />
      </div>
    </Sheet>
  )
}

/** Een periode aan land (reis, thuis, vrij) in een onderblad; bewerken via het potlood. */
export function StayOverviewSheet({ store, stay, notify, onClose }: { store: Store; stay: StayPeriod; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const current = useCollection(store, 'periods.json.enc').find((x) => x.id === stay.id)
  if (!current || current.deletedAt !== null) return null
  if (editing) return <StaySheet store={store} stay={current} notify={notify} onClose={onClose} />
  const period = stayPeriod(current)
  return (
    <Sheet title={period.name} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="view trip-overview">
        <PeriodPage store={store} period={period} notify={notify} mode="sheet" />
      </div>
    </Sheet>
  )
}

export { boatLine }
