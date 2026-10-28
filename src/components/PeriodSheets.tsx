import { useState } from 'react'
import { formatDateRange } from '../format'
import { t, useLang } from '../i18n'
import { applyPlan, hasOverlap, type PlanItem } from '../import/planning'
import { datesBetween, setDays } from '../model/calendar'
import { DAY_TYPES, type DayType } from '../model/types'
import { weekTypeLabel } from './WeekSheet'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Sheet } from './Sheet'

// Periode markeren: één dagsoort voor alle dagen van de periode; werk opent "Nieuwe trip" met die datums (met
// "Herhaal vorige trip" en de route-sjablonen). Planning importeren: eerst tonen wat er gemaakt wordt en wat overlapt.

export function PeriodSheet({ store, from, to, notify, onClose, onWork }: { store: Store; from: string; to: string; notify: Notify; onClose: () => void; onWork: (startDate: string, dayCount: number) => void }) {
  const dates = datesBetween(from, to)
  async function choose(type: DayType) {
    if (type === 'werk') {
      onWork(dates[0]!, dates.length)
      return
    }
    await setDays(store, dates, type)
    notify(t('calendar.periodSaved', { n: dates.length }))
    onClose()
  }
  return (
    <Sheet title={t('calendar.periodTitle', { range: formatDateRange(dates[0]!, dates.at(-1)!), n: dates.length })} onClose={onClose}>
      <div className="type-buttons day-types" role="group" aria-label={t('day.kind')}>
        {DAY_TYPES.map((d) => (
          <button key={d} type="button" className={`chip day-chip day-${d}`} onClick={() => void choose(d)}>
            {t(`dayType.${d}`)}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function PlanningImportSheet({ store, items, notify, onClose }: { store: Store; items: PlanItem[]; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const [include, setInclude] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const count = items.filter((i) => !hasOverlap(i) || include.has(i.row.row)).length

  function toggle(row: number) {
    const next = new Set(include)
    if (next.has(row)) next.delete(row)
    else next.add(row)
    setInclude(next)
  }

  async function confirm() {
    setBusy(true)
    const result = await applyPlan(store, items, include, lang)
    notify(t('planning.done', result))
    onClose()
  }

  return (
    <Sheet title={t('planning.check')} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('planning.intro')}</p>
        <ul className="rows planning-rows">
          {items.map((item) => {
            const overlap = hasOverlap(item)
            const { row } = item
            return (
              <li key={row.row} className={`row-item${overlap ? ' overlap' : ''}`}>
                <span className="row-main">
                  <span>
                    <strong>{t(`dayType.${row.kind}`)}</strong> · {formatDateRange(row.start, row.end)}
                  </span>
                  <span className="muted small">
                    {item.creates === 'trip'
                      ? [t('planning.createsTrip'), row.name, row.type ? weekTypeLabel(row.type) : '', row.boat, row.area].filter(Boolean).join(' · ')
                      : t('planning.createsDays', { n: item.days })}
                  </span>
                  {item.duplicate && <span className="warning small">{t('planning.duplicate')}</span>}
                  {!item.duplicate && item.overlapTrips.length > 0 && <span className="warning small">{t('planning.overlap', { names: item.overlapTrips.join(', ') })}</span>}
                  {!item.duplicate && item.overlapTrips.length === 0 && item.overlapDays > 0 && <span className="warning small">{t('planning.overlapDays', { n: item.overlapDays })}</span>}
                </span>
                {overlap && (
                  <label className="check-inline">
                    <input type="checkbox" checked={include.has(row.row)} onChange={() => toggle(row.row)} />
                    {t('planning.include')}
                  </label>
                )}
              </li>
            )
          })}
        </ul>
        <button className="btn primary" disabled={busy || count === 0} onClick={() => void confirm()}>
          {t('planning.confirm', { n: count })}
        </button>
      </div>
    </Sheet>
  )
}
