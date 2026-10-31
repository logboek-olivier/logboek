import { ChevronLeft, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { weekTypeLabel } from '../components/WeekSheet'
import { formatDateRange } from '../format'
import { t } from '../i18n'
import { availabilityRuns, buildIndex, planningEnd, planningRuns, type Availability, type PlanEntry, type Run } from '../model/calendar'
import { addDays } from '../model/money'
import { todayIso } from '../model/types'
import type { Store } from '../storage/store'

// Planning delen als PDF via de printfunctie (er gaat niets via de app naar buiten). Twee keuzes:
// - alleen beschikbaarheid: beschikbaar, bezet of optie, zonder namen, boten of bedragen;
// - volledige planning: trips (naam, type, gebied) en reisdagen (van–naar), zonder bedragen, gastnamen of notities.

type Mode = 'beschikbaarheid' | 'volledig'

function availabilityLabel(value: Availability): string {
  return value === 'bezet' ? t('share.busy') : t(`dayType.${value}`)
}

function entryLabel(entry: PlanEntry): string {
  if (entry.trip) return [entry.trip.name, weekTypeLabel(entry.trip.tripType), entry.trip.area ?? ''].filter(Boolean).join(' · ')
  if (entry.travel && (entry.travel.from || entry.travel.to)) return [entry.travel.from, entry.travel.to].filter(Boolean).join(' → ')
  return ''
}

function ShareTable({ mode, availability, plan }: { mode: Mode; availability: Run<Availability>[]; plan: Run<PlanEntry>[] }) {
  const empty = mode === 'beschikbaarheid' ? availability.length === 0 : plan.length === 0
  if (empty) return <p className="muted">{t('share.empty')}</p>
  return (
    <div className="table-scroll">
      <table className="share-table">
        <tbody>
          {mode === 'beschikbaarheid'
            ? availability.map((r) => (
                <tr key={r.from} className={`share-${r.value}`}>
                  <td>{formatDateRange(r.from, r.to)}</td>
                  <td>{availabilityLabel(r.value)}</td>
                </tr>
              ))
            : plan.map((r) => (
                <tr key={r.from} className={`share-${r.value.type}`}>
                  <td>{formatDateRange(r.from, r.to)}</td>
                  <td>
                    <span className="share-kind">{t(`dayType.${r.value.type}`)}</span>
                    {entryLabel(r.value) && <span className="share-detail">{entryLabel(r.value)}</span>}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}

export function AgendaShare({ store, onBack }: { store: Store; onBack: () => void }) {
  const today = todayIso()
  const calendar = useCollection(store, 'calendar.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs, [], stays), [calendar, trips, legs, stays])
  const lastPlanned = planningEnd(index)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(lastPlanned && lastPlanned > today ? lastPlanned : addDays(today, 90))
  const [mode, setMode] = useState<Mode>('beschikbaarheid')
  const [printRequest, setPrintRequest] = useState(0)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  const availability = valid ? availabilityRuns(index, from, to, today) : []
  const plan = valid ? planningRuns(index, from, to, today) : []

  useEffect(() => {
    if (printRequest > 0) window.print()
  }, [printRequest])

  return (
    <section className="stack">
      <button className="btn link back-link" onClick={onBack}>
        <Icon icon={ChevronLeft} />
        {t('nav.calendar')}
      </button>
      <header className="page-header">
        <h1>{t('share.title')}</h1>
      </header>
      <div className="segments small" role="radiogroup" aria-label={t('share.title')}>
        {(['beschikbaarheid', 'volledig'] as Mode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`segment${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
            {t(m === 'beschikbaarheid' ? 'share.availability' : 'share.full')}
          </button>
        ))}
      </div>
      <p className="muted small">{t(mode === 'beschikbaarheid' ? 'share.availabilityHint' : 'share.fullHint')}</p>
      <div className="two">
        <label>
          {t('export.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('export.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <button className="btn primary" disabled={!valid} onClick={() => setPrintRequest((n) => n + 1)}>
        <Icon icon={Printer} />
        {t('share.print')}
      </button>
      <p className="muted small">{t('share.printHint')}</p>
      {valid && <ShareTable mode={mode} availability={availability} plan={plan} />}
      {printRequest > 0 &&
        valid &&
        createPortal(
          <div className="print-root share-print">
            <h1>{t(mode === 'beschikbaarheid' ? 'share.titleAvailability' : 'share.titleFull')}</h1>
            <p>{formatDateRange(from, to)}</p>
            <ShareTable mode={mode} availability={availability} plan={plan} />
          </div>,
          document.body,
        )}
    </section>
  )
}
