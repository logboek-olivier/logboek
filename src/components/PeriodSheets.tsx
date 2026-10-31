import { MoveHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { formatDateRange, formatDateShort } from '../format'
import { t, useLang } from '../i18n'
import { applyPlan, hasOverlap, type PlanItem } from '../import/planning'
import { datesBetween, extendOptions, resizeTrip, setDays, type CalendarIndex } from '../model/calendar'
import { setStayDays } from '../model/periods'
import { bothUndo } from '../model/changes'
import { STAY_FROM_DAY } from '../model/migrate-periods'
import { DAY_TYPES, type DayType } from '../model/types'
import { weekTypeLabel } from './WeekSheet'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Periode markeren: één dagsoort voor alle dagen van de periode; werk opent "Nieuwe trip" met die datums (met
// "Herhaal vorige trip" en de route-sjablonen), of verlengt een trip die vlak ervoor eindigt of vlak erna begint.
// Planning importeren: eerst tonen wat er gemaakt wordt en wat overlapt.

export function PeriodSheet({
  store,
  index,
  from,
  to,
  notify,
  onClose,
  onWork,
}: {
  store: Store
  index: CalendarIndex
  from: string
  to: string
  notify: Notify
  onClose: () => void
  onWork: (startDate: string, dayCount: number) => void
}) {
  const dates = datesBetween(from, to)
  const [work, setWork] = useState(false)
  const extend = extendOptions(index, dates[0]!, dates.at(-1)!)

  async function choose(type: DayType) {
    if (type === 'werk') {
      if (extend.length === 0) onWork(dates[0]!, dates.length)
      else setWork(true)
      return
    }
    // Reis, thuis of vrij: een periode over die dagen (dagen in een trip blijven bij de trip). Een dagtoestand
    // (beschikbaar, optie, onbeschikbaar) hoort bij dagen zonder periode: eerst uit een periode aan land, en niet in een trip.
    const land = STAY_FROM_DAY[type]
    if (land) {
      const undo = await setStayDays(store, dates, land)
      notify(t('calendar.periodSaved', { n: dates.length }), undo)
    } else {
      const free = dates.filter((d) => !index.views.some((v) => v.startDate <= d && d <= v.endDate))
      const undoStay = await setStayDays(store, free, null)
      const before = new Map(store.list('calendar.json.enc').map((d) => [d.date, d]))
      await setDays(store, free, type)
      const undoDays = async () => {
        const now = new Date().toISOString()
        const back = free.map((d) => before.get(d) ?? store.list('calendar.json.enc').find((x) => x.date === d)).filter((d) => !!d)
        await store.putMany('calendar.json.enc', back.map((d) => (before.get(d.date) ? { ...d, updatedAt: now } : { ...d, updatedAt: now, deletedAt: now })))
      }
      notify(t('calendar.periodSaved', { n: free.length }), bothUndo(undoStay, undoDays))
    }
    onClose()
  }

  return (
    <Sheet title={t('calendar.periodTitle', { range: formatDateRange(dates[0]!, dates.at(-1)!), n: dates.length })} onClose={onClose}>
      {work ? (
        <div className="stack-sm">
          {extend.map((option) => (
            <button
              key={option.view.trip.id}
              type="button"
              className="btn"
              onClick={async () => {
                const undo = await resizeTrip(store, option)
                notify(t('day.tripResized', { name: option.view.trip.name, range: formatDateRange(option.start, option.end) }), undo)
                onClose()
              }}
            >
              <Icon icon={MoveHorizontal} />
              {option.end === dates.at(-1) ? t('day.extend', { name: option.view.trip.name, date: formatDateShort(option.end) }) : t('day.extendEarlier', { name: option.view.trip.name, date: formatDateShort(option.start) })}
            </button>
          ))}
          <button type="button" className="btn primary" onClick={() => onWork(dates[0]!, dates.length)}>
            <Icon icon={Plus} />
            {t('week.new')}
          </button>
        </div>
      ) : (
        <div className="type-buttons day-types" role="group" aria-label={t('day.kind')}>
          {DAY_TYPES.map((d) => (
            <button key={d} type="button" className={`chip day-chip day-${d}`} onClick={() => void choose(d)}>
              {t(`dayType.${d}`)}
            </button>
          ))}
        </div>
      )}
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
