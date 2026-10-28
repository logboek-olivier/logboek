import { ChevronLeft, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { weekTypeLabel } from '../components/WeekSheet'
import { formatDateRange } from '../format'
import { t } from '../i18n'
import { buildIndex, planningEnd, seasonWeeks, weekStart, type SeasonItem } from '../model/calendar'
import { addDays } from '../model/money'
import { todayIso } from '../model/types'
import { isoWeek } from '../model/weeks'
import type { Store } from '../storage/store'

// Seizoensoverzicht: één regel per week van vandaag tot het einde van de planning (naam, datums, type, boot, gebied),
// met gaten als "Beschikbaar: …". "Eerdere weken tonen" gaat een half jaar per tik terug.

const EARLIER_WEEKS = 26

export function itemLabel(item: SeasonItem): string {
  if (item.kind === 'trip') {
    const v = item.view
    return [v.trip.name, weekTypeLabel(v.type), v.boat, v.trip.area ?? ''].filter(Boolean).join(' · ')
  }
  const travel = item.travel && (item.travel.from || item.travel.to) ? ` ${[item.travel.from, item.travel.to].filter(Boolean).join(' → ')}` : ''
  return `${t(`dayType.${item.type}`)}:${travel} ${formatDateRange(item.from, item.to)}`
}

export function Season({ store, onBack }: { store: Store; onBack: () => void }) {
  const today = todayIso()
  const calendar = useCollection(store, 'calendar.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs), [calendar, trips, legs])
  const [start, setStart] = useState(weekStart(today))
  const lastPlanned = planningEnd(index)
  const end = lastPlanned && lastPlanned > addDays(weekStart(today), 6) ? lastPlanned : addDays(weekStart(today), 6)
  const weeks = seasonWeeks(index, start, end, today)
  const current = weekStart(today)

  return (
    <section className="stack">
      <button className="btn link back-link" onClick={onBack}>
        <Icon icon={ChevronLeft} />
        {t('nav.calendar')}
      </button>
      <header className="page-header">
        <h1>{t('season.title')}</h1>
      </header>
      <button className="btn small" onClick={() => setStart(addDays(start, -7 * EARLIER_WEEKS))}>
        <Icon icon={ChevronUp} />
        {t('season.earlier')}
      </button>
      <ol className="season">
        {weeks.map((w) => (
          <li key={w.start} className={`season-week${w.start === current ? ' current' : ''}${w.end < today ? ' past' : ''}`}>
            <div className="season-head">
              <strong>{t('season.week', { n: isoWeek(w.start) })}</strong>
              <span className="muted small">{formatDateRange(w.start, w.end)}</span>
            </div>
            {w.items.length === 0 ? (
              <p className="muted small">{t('season.nothing')}</p>
            ) : (
              <ul className="season-items">
                {w.items.map((item, i) => (
                  <li key={i} className={`season-item day-${item.kind === 'trip' ? 'werk' : item.type}`}>
                    {item.kind === 'trip' ? (
                      <>
                        <span>{itemLabel(item)}</span>
                        <span className="muted small"> · {formatDateRange(item.view.startDate, item.view.endDate)}</span>
                      </>
                    ) : (
                      <span>{itemLabel(item)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
