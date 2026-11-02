import { CalendarRange, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import type { MoneyLink } from '../domain/geldmodel'
import { formatDateRange } from '../format'
import { t } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { nameWithCounter } from '../model/counters'
import { active, tripForDate } from '../model/derive'
import type { Season, StayPeriod, Trip } from '../model/types'
import { stayName } from '../model/periods'
import { weekView } from '../model/weeks'
import type { Store } from '../storage/store'
import { organisationChoices, tripOrganisation } from '../basis/organisatie'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// De tochtkiezer voor geld (CLAUDE.md, Zeilgeld): alle tochten, ook die uit de Excel-import, nieuwste eerst en per jaar,
// met datums en organisatie en een zoekveld. Bovenaan de tocht waarin de datum van de transactie valt; onderaan
// "Seizoen…" (organisatie en jaar) en "Geen tocht". Eén kiezer voor inkomsten, het bewerkblad en declaraties.

export type { MoneyLink }

/** De kiezer staat vaak in een formulier (Toevoegen, het bewerkblad): Enter in het zoekveld verstuurt dat niet. */
const noSubmit = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.preventDefault()
}

interface Row {
  trip: Trip
  name: string
  start: string
  end: string
  org: string | null
  text: string
}

function rowsOf(trips: readonly Trip[], legs: Parameters<typeof weekView>[1], counters: ReturnType<typeof useCounters>): Row[] {
  return active(trips)
    .map((trip) => {
      const view = weekView(trip, legs)
      const org = tripOrganisation(trip) ?? (trip.organisation && trip.organisation !== 'overig' && trip.organisation !== 'eigen' ? trip.organisation : null)
      const name = nameWithCounter(trip, counters.get(trip.id))
      const dates = view.startDate && view.endDate ? formatDateRange(view.startDate, view.endDate) : ''
      return { trip, name, start: view.startDate, end: view.endDate, org, text: `${name} ${dates} ${org ? organisationLabel(org) : ''} ${view.startDate.slice(0, 4)}`.toLowerCase() }
    })
    .sort((a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name))
}

/** Korte tekst van een keuze: de tocht met datums, het seizoen, of "Geen tocht". */
export function linkLabel(link: MoneyLink, trips: readonly Trip[], legs: Parameters<typeof weekView>[1], counters: ReturnType<typeof useCounters>, stays: readonly StayPeriod[] = []): string {
  if (link.kind === 'seizoen') return t('tripPicker.seasonLabel', { org: organisationLabel(link.season.org), year: link.season.year })
  if (link.kind === 'geen') return t('tripPicker.none')
  const row = rowsOf(trips.filter((x) => x.id === link.tripId), legs, counters)[0]
  // Een periode aan land (geld van vóór de tochtkiezer) of een tocht die weg is: zo laten staan, met zijn naam.
  const stay = !row ? stays.find((x) => x.id === link.tripId && x.deletedAt === null) : undefined
  if (stay) return stayName(stay)
  if (!row) return t('belongsTo.none')
  return row.start ? `${row.name} · ${formatDateRange(row.start, row.end)}` : row.name
}

export function TripPickerField({ store, value, onChange, date, label, seasons = true }: { store: Store; value: MoneyLink; onChange: (next: MoneyLink) => void; date: string; label?: string; /** Declaraties horen bij een tocht of bij niets, niet bij een seizoen. */ seasons?: boolean }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const counters = useCounters(store)
  const stays = useCollection(store, 'periods.json.enc')
  const [open, setOpen] = useState(false)
  return (
    <div className="field trip-picker-field">
      <span className="field-label" aria-hidden="true">
        {label ?? t('field.trip')}
      </span>
      <button type="button" className="picker-button" aria-haspopup="dialog" aria-label={`${label ?? t('field.trip')}: ${linkLabel(value, trips, legs, counters, stays)}`} onClick={() => setOpen(true)}>
        <span className="grow">{linkLabel(value, trips, legs, counters, stays)}</span>
        <Icon icon={ChevronRight} />
      </button>
      {open && (
        <TripPickerSheet
          store={store}
          date={date}
          value={value}
          seasons={seasons}
          onPick={(next) => {
            onChange(next)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

export function TripPickerSheet({ store, date, value, onPick, onClose, seasons = true }: { store: Store; date: string; value: MoneyLink; onPick: (next: MoneyLink) => void; onClose: () => void; seasons?: boolean }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const counters = useCounters(store)
  const [query, setQuery] = useState('')
  const [season, setSeason] = useState<Season | null>(null)
  const rows = useMemo(() => rowsOf(trips, legs, counters), [trips, legs, counters])
  const onDate = date ? tripForDate(trips, legs, date) : null
  const q = query.trim().toLowerCase()
  const shown = q ? rows.filter((r) => q.split(/\s+/).every((w) => r.text.includes(w))) : rows
  const years = new Map<string, Row[]>()
  for (const r of shown) {
    const y = r.start.slice(0, 4) || ''
    years.set(y, [...(years.get(y) ?? []), r])
  }
  const chosen = value.kind === 'tocht' ? value.tripId : null
  const item = (r: Row) => (
    <li key={r.trip.id}>
      <button type="button" className={`row-item trip-pick${chosen === r.trip.id ? ' active' : ''}`} aria-pressed={chosen === r.trip.id} onClick={() => onPick({ kind: 'tocht', tripId: r.trip.id })}>
        <span className="row-main">
          <span className="row-title">{r.name}</span>
          <span className="muted small">{[r.start ? formatDateRange(r.start, r.end) : t('tripPicker.noDates'), r.org ? organisationLabel(r.org) : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    </li>
  )
  return (
    <Sheet title={t('tripPicker.title')} onClose={onClose}>
      <div className="stack trip-picker">
        <label className="search-field">
          <Icon icon={Search} />
          <input type="search" aria-label={t('tripPicker.search')} placeholder={t('tripPicker.search')} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={noSubmit} />
        </label>
        {onDate && !q && (
          <div className="stack-sm">
            <h3 className="small-heading">{t('tripPicker.onDate')}</h3>
            <ul className="rows">{item(rows.find((r) => r.trip.id === onDate.id)!)}</ul>
          </div>
        )}
        {[...years.entries()].map(([year, list]) => (
          <div key={year} className="stack-sm">
            <h3 className="small-heading">{year || t('tripPicker.noDates')}</h3>
            <ul className="rows">{list.map(item)}</ul>
          </div>
        ))}
        {shown.length === 0 && <p className="muted small">{t('tripPicker.nothing')}</p>}
        {!seasons ? null : season ? (
          <div className="stack-sm season-pick">
            <div className="two">
              <label>
                {t('week.organisation')}
                <select value={season.org} onChange={(e) => setSeason({ ...season, org: e.target.value })}>
                  {organisationChoices(trips).map((o) => (
                    <option key={o} value={o}>
                      {organisationLabel(o)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('tripPicker.year')}
                <input type="number" inputMode="numeric" min={2000} max={2100} value={season.year} onChange={(e) => setSeason({ ...season, year: Math.round(Number(e.target.value)) })} onKeyDown={noSubmit} />
              </label>
            </div>
            <button type="button" className="btn primary" disabled={!Number.isInteger(season.year) || season.year < 2000 || season.year > 2100} onClick={() => onPick({ kind: 'seizoen', season })}>
              {t('tripPicker.chooseSeason')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setSeason(value.kind === 'seizoen' ? value.season : { org: organisationChoices(trips)[0] ?? 'overig', year: Number((date || new Date().toISOString()).slice(0, 4)) - 1 })}>
            <Icon icon={CalendarRange} />
            {t('tripPicker.season')}
          </button>
        )}
        <button type="button" className={`btn quiet${value.kind === 'geen' ? ' active' : ''}`} onClick={() => onPick({ kind: 'geen' })}>
          {t('tripPicker.none')}
        </button>
      </div>
    </Sheet>
  )
}
