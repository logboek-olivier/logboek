import { Briefcase, Eye, EyeOff, GraduationCap, House, Plane, Sailboat, Search, Sun, type LucideIcon } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { usePeriods } from '../components/BelongsTo'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { StayOverviewSheet, TripOverviewSheet } from '../components/TripOverview'
import { sumText } from '../components/TripMoney'
import { useCollection } from '../components/useCollection'
import { useCounters } from '../components/useCounters'
import { boatLine } from '../components/boat-line'
import { formatDateRange, formatMoney, formatMonth, formatNm } from '../format'
import { t } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { totals } from '../model/money'
import { tripResult } from '../model/money-path'
import { PERIOD_FILTERS, periodSections, type MonthGroup, type PeriodFilter, type PeriodRow } from '../model/period-list'
import { getRates, subscribeRates } from '../model/rates'
import { currentSettings } from '../model/settings'
import { todayIso, type PeriodKind, type StayPeriod, type Transaction, type Trip } from '../model/types'
import { activeWeek } from '../model/weeks'
import type { AddInit } from './QuickAdd'
import type { Store } from '../storage/store'

// Meer → Periodes: alle periodes (werk, training, plezier, reis, thuis, vrij) in één lijst, Nu · Komend · Afgelopen,
// komend en afgelopen per maand ingeklapt. Filters en zoeken op naam, boot, plaats of persoon. Per periode één regel:
// soort, teller en naam, datums, boot, nm, en het resultaat pas na "Toon bedragen". Tik = de periodepagina.

const KIND_ICON: Record<PeriodKind, LucideIcon> = { werk: Briefcase, training: GraduationCap, plezier: Sailboat, reis: Plane, thuis: House, vrij: Sun }

export function Periods({ store, notify, onAddDay }: { store: Store; notify: Notify; onAddDay?: (init: AddInit) => void }) {
  const periods = usePeriods(store)
  const legs = useCollection(store, 'legs.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const today = todayIso()
  const running = activeWeek(trips, settings, today)?.id ?? null
  const [filter, setFilter] = useState<PeriodFilter>('alles')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(false)
  const [openTrip, setOpenTrip] = useState<Trip | null>(null)
  const [openStay, setOpenStay] = useState<StayPeriod | null>(null)
  const sections = useMemo(() => periodSections(periods, legs, today, running, filter, query), [periods, legs, today, running, filter, query])
  const empty = sections.now.length + sections.upcoming.length + sections.past.length + sections.undated.length === 0
  const open = (row: PeriodRow) => (row.period.view ? setOpenTrip(row.period.view.trip) : row.period.stay ? setOpenStay(row.period.stay) : undefined)

  return (
    <section className="stack-lg periods">
      <header className="page-header">
        <h1>{t('periods.title')}</h1>
      </header>
      <div className="stack-sm">
        <label className="search-field">
          <Icon icon={Search} />
          <input type="search" autoComplete="off" placeholder={t('periods.search')} aria-label={t('periods.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="type-buttons" role="radiogroup" aria-label={t('periods.filter')}>
          {PERIOD_FILTERS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {t(`periods.filter.${f}`)}
            </button>
          ))}
        </div>
        <button type="button" className="btn link small" aria-pressed={shown} onClick={() => setShown(!shown)}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {empty && <p className="muted">{query ? t('periods.noMatch') : t('periods.empty')}</p>}
      {sections.now.length > 0 && (
        <div className="section">
          <h2>{t('periods.now')}</h2>
          <Rows store={store} rows={sections.now} shown={shown} onOpen={open} />
        </div>
      )}
      {sections.upcoming.length > 0 && (
        <div className="section">
          <h2>{t('periods.upcoming')}</h2>
          <Months store={store} groups={sections.upcoming} shown={shown} onOpen={open} openAll={!!query} />
        </div>
      )}
      {sections.past.length > 0 && (
        <div className="section">
          <h2>{t('periods.past')}</h2>
          <Months store={store} groups={sections.past} shown={shown} onOpen={open} openAll={!!query} />
        </div>
      )}
      {sections.undated.length > 0 && (
        <div className="section">
          <h2>{t('periods.undated')}</h2>
          <Rows store={store} rows={sections.undated} shown={shown} onOpen={open} />
        </div>
      )}
      {openTrip && <TripOverviewSheet key={openTrip.id} store={store} trip={openTrip} notify={notify} onClose={() => setOpenTrip(null)} onAddDay={onAddDay} />}
      {openStay && <StayOverviewSheet key={openStay.id} store={store} stay={openStay} notify={notify} onClose={() => setOpenStay(null)} />}
    </section>
  )
}

/** Per maand ingeklapt; bij zoeken alles open. */
function Months({ store, groups, shown, onOpen, openAll }: { store: Store; groups: MonthGroup[]; shown: boolean; onOpen: (row: PeriodRow) => void; openAll: boolean }) {
  return (
    <div className="stack-sm">
      {groups.map((g) => (
        <details key={g.month} className="period-month" open={openAll || undefined}>
          <summary>
            <span>{formatMonth(g.month)}</span>
            <span className="muted small">{g.rows.length}</span>
          </summary>
          <Rows store={store} rows={g.rows} shown={shown} onOpen={onOpen} />
        </details>
      ))}
    </div>
  )
}

function Rows({ store, rows, shown, onOpen }: { store: Store; rows: PeriodRow[]; shown: boolean; onOpen: (row: PeriodRow) => void }) {
  const counters = useCounters(store)
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const rates = useSyncExternalStore(subscribeRates, getRates)
  return (
    <ul className="rows period-rows">
      {rows.map(({ period, nm }) => {
        const trip = period.view?.trip
        const name = trip ? nameWithCounter(trip, counters.get(trip.id)) : period.name
        const boat = trip ? boatLine(trip, period.view?.boat) : ''
        // Resultaat: bij een trip salaris + fooi + inkomsten − uitgaven; aan land de uitgaven.
        const result = shown
          ? trip
            ? sumText(tripResult(trip, legs, transactions, rates).result, true)
            : landResult(transactions.filter((tx) => tx.deletedAt === null && tx.tripId === period.id))
          : ''
        return (
          <li key={period.id}>
            <button type="button" className="row-button period-row" onClick={() => onOpen({ period, nm })}>
              <Icon icon={KIND_ICON[period.kind]} />
              <span className="row-main">
                <span className="row-title">{name}</span>
                <span className="muted small">{[period.start && period.end ? formatDateRange(period.start, period.end) : t('review.noDates'), boat, nm > 0 ? formatNm(nm) : ''].filter(Boolean).join(' · ')}</span>
              </span>
              {result && <span className="row-value small">{result}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Aan land: inkomsten min uitgaven van de periode (meestal alleen uitgaven, dus negatief). */
function landResult(list: readonly Transaction[]): string {
  if (list.length === 0) return ''
  const sum = totals(list)
  return [formatMoney(sum.balanceEur, 'EUR'), ...Object.entries(sum.other).map(([c, v]) => formatMoney(v.income - v.costs, c))].join(' + ')
}
