import { CalendarPlus, FileText, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { BarChart } from '../components/BarChart'
import type { Notify } from '../components/EditSheets'
import { RouteThumb } from '../components/RouteThumb'
import { TripOverviewSheet } from '../components/TripOverview'
import { routeOf } from '../model/trip-route'
import { WeekSheet } from '../components/WeekSheet'
import { IncompleteBadge } from '../components/Incomplete'
import { tripIncomplete } from '../model/gaps'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDateRangeShort, formatHours, formatMonth, formatMonthShort, formatNm } from '../format'
import { SummaryGrid, useMileageImport } from '../components/MileageImport'
import { active, nmPerMonth, summarize, summarizeTrips, type TripSummary } from '../model/derive'
import type { Place, Trip } from '../model/types'
import type { Store } from '../storage/store'
import { nameWithCounter, type TripCounter } from '../model/counters'
import { useCounters } from '../components/useCounters'
import { CounterDoubtNotice } from '../components/CounterSheets'
import { BoatCheck } from './Boats'
import { SailingExport } from './SailingExport'
import { boatList, uncheckedBoats } from '../model/boats'
import { currentSettings } from '../model/settings'
import { t } from '../i18n'
import { useBack } from '../back'
import { todayIso } from '../basis/datum'

// Zeilen: totalen bovenaan, nm per maand, tochten per maand (nieuwste eerst, uitklapbaar naar dagen), Importeren.

type Editing = { kind: 'trip'; trip: Trip } | { kind: 'new-week' } | null

export function Sailing({ store, notify }: { store: Store; notify: Notify }) {
  const counters = useCounters(store)
  const [editing, setEditing] = useState<Editing>(null)
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const [checking, setChecking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  // Boten uit de import (ook eerder geïmporteerde data) die Olivier nog niet bevestigd of overgeslagen heeft.
  const unchecked = uncheckedBoats(boatList(trips, legs), settings)

  const summary = summarize(legs)
  const tripSummaries = summarizeTrips(trips, legs)
  // Trips zonder gelogde dagen (gepland, of nog leeg): niet onvindbaar, maar onder een eigen kop (review D-3).
  const logged = new Set(tripSummaries.map((s) => s.trip.id))
  const withoutDays = active(trips)
    .filter((trip) => !logged.has(trip.id))
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  const months = nmPerMonth(legs, todayIso())

  const mileage = useMileageImport(store, () => setChecking(true))
  useBack(exporting, () => setExporting(false))
  if (exporting) return <SailingExport store={store} onBack={() => setExporting(false)} />
  if (mileage.preview) return mileage.preview

  if (checking && unchecked.length > 0) {
    return (
      <section className="stack">
        <header className="page-header">
          <h1>{t('boats.check')}</h1>
        </header>
        <BoatCheck store={store} boats={unchecked} notify={notify} canSkip onDone={() => setChecking(false)} />
      </section>
    )
  }

  // Tochten per maand van de laatste dag, nieuwste eerst.
  const groups: { month: string; trips: TripSummary[] }[] = []
  for (const s of tripSummaries) {
    const month = s.endDate.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.month === month) last.trips.push(s)
    else groups.push({ month, trips: [s] })
  }

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.logbook')}</h1>
        {summary.days > 0 && mileage.trigger(t('import.import'))}
      </header>
      <div className="row wrap">
        <button className="btn small quiet new-week" onClick={() => setEditing({ kind: 'new-week' })}>
          <Icon icon={CalendarPlus} />
          {t('week.new')}
        </button>
        {summary.days > 0 && (
          <button className="btn small quiet" onClick={() => setExporting(true)}>
            <Icon icon={FileText} />
            {t('export.title')}
          </button>
        )}
      </div>
      <CounterDoubtNotice store={store} notify={notify} />
      {summary.days === 0 && (
        <Empty icon={FileSpreadsheet} action={mileage.trigger(t('import.import'), true)}>
          {t('sailing.empty')}
        </Empty>
      )}
      {summary.days > 0 && (
        <>
          {unchecked.length > 0 && (
            <div className="notice">
              <span>{t('boats.notice', { n: unchecked.length })}</span>
              <button className="btn small primary" onClick={() => setChecking(true)}>
                {t('boats.checkButton')}
              </button>
            </div>
          )}
          <SummaryGrid summary={summary} />
          <div className="section card card-body">
            <div className="section-head">
              <h2>{t('chart.nmPerMonth')}</h2>
              <span className="muted">{t('chart.months12')}</span>
            </div>
            <BarChart
              label={`${t('chart.nmPerMonth')}: ${months.map((m) => `${formatMonth(m.month)} ${formatNm(m.nm)}`).join(', ')}`}
              groups={months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), values: [m.nm] }))}
              format={(n) => formatNm(Math.round(n))}
              labelEvery={2}
            />
          </div>
          <div className="section">
            <h2>{t('sailing.trips')}</h2>
            {groups.map((g) => (
              <div key={g.month} className="group">
                <h3 className="group-head">
                  <span>{formatMonth(g.month)}</span>
                  <span className="num">{formatNm(g.trips.reduce((n, s) => n + s.nm, 0))}</span>
                </h3>
                <ul className="trip-cards">
                  {g.trips.map((s) => (
                    <TripCard key={s.trip.id} summary={s} counter={counters.get(s.trip.id)} places={places} onOpen={() => setEditing({ kind: 'trip', trip: s.trip })} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {withoutDays.length > 0 && (
        <div className="section">
          <h2>{t('sailing.withoutDays')}</h2>
          <p className="muted small">{t('sailing.withoutDaysHint')}</p>
          <ul className="rows">
            {withoutDays.map((trip) => (
              <li key={trip.id} className="row-item">
                <button type="button" className="row-button" onClick={() => setEditing({ kind: 'trip', trip })} aria-label={t('trip.open', { name: nameWithCounter(trip, counters.get(trip.id)) })}>
                  <span className="row-main">
                    <span className="row-title">{nameWithCounter(trip, counters.get(trip.id))}</span>
                    <span className="muted small">{trip.startDate && trip.endDate ? formatDateRangeShort(trip.startDate, trip.endDate) : t('review.noDates')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing?.kind === 'trip' && <TripOverviewSheet store={store} trip={editing.trip} notify={notify} onClose={() => setEditing(null)} />}
      {editing?.kind === 'new-week' && <WeekSheet store={store} trip={null} onClose={() => setEditing(null)} notify={notify} />}
    </section>
  )
}

/** Een trip als kaartje: klein routeplaatje, naam met teller, periode, boot en totalen; tikken opent het overzicht. */
function TripCard({ summary, counter, places, onOpen }: { summary: TripSummary; counter?: TripCounter; places: readonly Place[]; onOpen: () => void }) {
  const route = routeOf(summary.legs, places)
  const name = nameWithCounter(summary.trip, counter)
  return (
    <li className="trip trip-card">
      <button type="button" className="trip-card-button" onClick={onOpen} aria-label={t('trip.open', { name })}>
        <RouteThumb route={route} />
        <span className="row-main">
          <span className="row-title">
            {name} {tripIncomplete(summary.trip, summary.legs) && <IncompleteBadge />}
          </span>
          <span className="muted small">{[formatDateRangeShort(summary.startDate, summary.endDate), summary.trip.boatModel || summary.boat].filter(Boolean).join(' · ')}</span>
          <span className="muted small">
            {[t('unit.days', { n: summary.days }), route.nightHours > 0 ? t('sailing.night', { hours: formatHours(route.nightHours) }) : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="row-value">{formatNm(summary.nm)}</span>
      </button>
    </li>
  )
}
