import { CalendarPlus, FileText, FileSpreadsheet, LoaderCircle, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { formatDateRangeShort, formatHours, formatMonth, formatMonthShort, formatNm, formatNumber } from '../format'
import { recordError } from '../errors'
import { applyImport } from '../import/apply'
import { ImportError, parseMileageFile, type ImportResult } from '../import/mileage-csv'
import { nmPerMonth, summarize, summarizeTrips, type SailingSummary, type TripSummary } from '../model/derive'
import { roleLabel } from '../i18n/labels'
import { ROLES, todayIso, type Place, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import { nameWithCounter, type TripCounter } from '../model/counters'
import { useCounters } from '../components/useCounters'
import { CounterDoubtNotice } from '../components/CounterSheets'
import { ErrorLine } from './Setup'
import { BoatCheck } from './Boats'
import { SailingExport } from './SailingExport'
import { boatList, uncheckedBoats } from '../model/boats'
import { currentSettings } from '../model/settings'
import { t } from '../i18n'
import { useBack } from '../back'

// Zeilen: totalen bovenaan, nm per maand, tochten per maand (nieuwste eerst, uitklapbaar naar dagen), Importeren.

type Editing = { kind: 'trip'; trip: Trip } | { kind: 'new-week' } | null

export function Sailing({ store, notify }: { store: Store; notify: Notify }) {
  const counters = useCounters(store)
  const [editing, setEditing] = useState<Editing>(null)
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  // Boten uit de import (ook eerder geïmporteerde data) die Olivier nog niet bevestigd of overgeslagen heeft.
  const unchecked = uncheckedBoats(boatList(trips, legs), settings)

  const summary = summarize(legs)
  const tripSummaries = summarizeTrips(trips, legs)
  const months = nmPerMonth(legs, todayIso())

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setReading(true)
    try {
      // Inhoud bepaalt het formaat (CSV of .xlsx), niet de naam of het MIME-type van de bestandskiezer.
      setPending(parseMileageFile(new Uint8Array(await file.arrayBuffer())))
    } catch (e) {
      recordError(e)
      setError(
        e instanceof ImportError
          ? e.message
          : t('import.unreadable'),
      )
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function confirmImport() {
    if (!pending) return
    setBusy(true)
    try {
      await applyImport(store, pending)
      setPending(null)
      setChecking(true)
      void store.sync()
    } finally {
      setBusy(false)
    }
  }

  useBack(exporting, () => setExporting(false))
  if (exporting) return <SailingExport store={store} onBack={() => setExporting(false)} />

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

  if (pending) {
    const previous = legs.filter((l) => l.deletedAt === null && l.source === 'import').length
    const manual = legs.filter((l) => l.deletedAt === null && l.source === 'manual').length
    return (
      <section className="stack">
        <header className="page-header">
          <h1>{t('import.check')}</h1>
        </header>
        <p className="muted">
          {t('import.compare')}
          {previous > 0 ? ` ${t('import.replaces', { n: formatNumber(previous) })}` : ''}
          {manual > 0 ? ` ${t('import.manualKept', { n: formatNumber(manual) })}` : ''}
        </p>
        <SummaryGrid summary={pending.summary} />
        {pending.warnings.length > 0 && (
          <>
            <h2>{t('import.warnings', { n: pending.warnings.length })}</h2>
            <ul className="warnings">
              {pending.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
        <div className="stack">
          <button className="btn primary" onClick={() => void confirmImport()} disabled={busy}>
            {busy ? t('import.importing') : t('import.import')}
          </button>
          <button className="btn" onClick={() => setPending(null)} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      </section>
    )
  }

  const importButton = (primary: boolean) => (
    <button
      className={`btn${primary ? ' primary' : ' small quiet'}`}
      onClick={() => fileInput.current?.click()}
      disabled={reading}
    >
      <Icon icon={reading ? LoaderCircle : Upload} className={reading ? 'spin' : ''} />
      {reading ? t('import.reading') : t('import.import')}
    </button>
  )

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
        {summary.days > 0 && importButton(false)}
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
      {/* Geen accept-filter: Android en Google Drive geven CSV en Excel wisselende MIME-types en grijzen ze dan uit. */}
      <input ref={fileInput} type="file" hidden aria-label={t('import.file')} onChange={(e) => void onFile(e.target.files?.[0])} />
      <ErrorLine error={error} />
      <CounterDoubtNotice store={store} notify={notify} />
      {summary.days === 0 && (
        <Empty icon={FileSpreadsheet} action={importButton(true)}>
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
      {editing?.kind === 'trip' && <TripOverviewSheet store={store} trip={editing.trip} notify={notify} onClose={() => setEditing(null)} />}
      {editing?.kind === 'new-week' && <WeekSheet store={store} trip={null} onClose={() => setEditing(null)} notify={notify} />}
    </section>
  )
}

export function SummaryGrid({ summary }: { summary: SailingSummary }) {
  const water = summary.nmByWater
  return (
    <dl className="grid grid-3">
      <Stat label={t('stat.total')} value={formatNm(summary.nm)} />
      <Stat label={t('stat.days')} value={formatNumber(summary.days)} />
      <Stat label={t('stat.trips')} value={formatNumber(summary.trips)} />
      <Stat label={t('stat.nightHours')} value={formatHours(summary.nightHours)} />
      {ROLES.filter((r) => summary.nmByRole[r] > 0).map((r) => (
        <Stat key={r} label={roleLabel(r)} value={formatNm(summary.nmByRole[r])} />
      ))}
      <Stat label={t('water.inland')} value={formatNm(water.inland)} />
      <Stat label={t('water.sea')} value={formatNm(water.sea)} />
      <Stat label={t('water.tidal')} value={formatNm(water.tidal)} />
    </dl>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
