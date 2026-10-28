import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react'
import { useMemo, useRef, useState, type TouchEvent } from 'react'
import { DaySheet } from '../components/DaySheet'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate, formatMonth, formatNm, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import { buildIndex, dayInfo, monthOf, monthSummary, monthWeeks, shiftMonth, tripBars, type CalendarIndex } from '../model/calendar'
import { todayIso } from '../model/types'
import type { Store } from '../storage/store'
import type { AddInit } from './QuickAdd'

// Agenda: het overzicht van het seizoen. Maandraster met een kleur per dagsoort (optie gestreept), een balk met de
// tripnaam over de dagen van elke trip, nm klein in het vakje en een stip voor termijnen. Vegen of de pijlen voor de
// vorige en volgende maand, "Naar vandaag", en onderaan de werk-, rust-, reis- en thuisdagen en nm van de maand.
// Tik op een dag: het dagblad. Het Logboek (archief) is hier ook te openen.

export function Agenda({ store, notify, onAdd, onLogbook }: { store: Store; notify: Notify; onAdd: (init: AddInit) => void; onLogbook: () => void }) {
  const lang = useLang()
  const today = todayIso()
  const calendar = useCollection(store, 'calendar.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const reminders = useCollection(store, 'reminders.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs, reminders), [calendar, trips, legs, reminders])
  const [month, setMonth] = useState(monthOf(today))
  const [open, setOpen] = useState<string | null>(null)
  const weeks = monthWeeks(month)
  const summary = monthSummary(index, month, today)
  const touch = useRef<{ x: number; y: number } | null>(null)

  function onTouchStart(e: TouchEvent) {
    const p = e.touches[0]
    touch.current = p ? { x: p.clientX, y: p.clientY } : null
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touch.current
    const p = e.changedTouches[0]
    touch.current = null
    if (!start || !p) return
    const dx = p.clientX - start.x
    const dy = p.clientY - start.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) setMonth(shiftMonth(month, dx < 0 ? 1 : -1))
  }

  const weekdays = useMemo(() => {
    const names = new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'narrow' })
    // 5 januari 2026 is een maandag.
    return Array.from({ length: 7 }, (_, i) => names.format(new Date(2026, 0, 5 + i)))
  }, [lang])

  return (
    <section className="stack agenda">
      <header className="page-header agenda-header">
        <h1>{t('nav.calendar')}</h1>
        <button className="btn link small" onClick={onLogbook}>
          <Icon icon={NotebookPen} />
          {t('nav.logbook')}
        </button>
      </header>
      <div className="agenda-month">
        <button className="btn icon" aria-label={t('calendar.prev')} onClick={() => setMonth(shiftMonth(month, -1))}>
          <Icon icon={ChevronLeft} />
        </button>
        {/* Tik op de maand: de maandkiezer van de telefoon, om snel naar een ander seizoen te gaan. */}
        <label className="agenda-title">
          <h2 aria-live="polite">{formatMonth(month)}</h2>
          <input type="month" aria-label={t('calendar.chooseMonth')} value={month} onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && setMonth(e.target.value)} />
        </label>
        <button className="btn icon" aria-label={t('calendar.next')} onClick={() => setMonth(shiftMonth(month, 1))}>
          <Icon icon={ChevronRight} />
        </button>
        {month !== monthOf(today) && (
          <button className="btn small to-today" onClick={() => setMonth(monthOf(today))}>
            {t('calendar.toToday')}
          </button>
        )}
      </div>
      <div className="cal" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="cal-weekdays" aria-hidden="true">
          {weekdays.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <Week key={week[0]} index={index} week={week} month={month} today={today} onOpen={setOpen} />
        ))}
      </div>
      <dl className="agenda-summary" aria-label={t('calendar.summaryTitle')}>
        {(
          [
            ['dayType.werk', 'werk', formatNumber(summary.werk)],
            ['dayType.rust', 'rust', formatNumber(summary.rust)],
            ['dayType.reis', 'reis', formatNumber(summary.reis)],
            ['dayType.thuis', 'thuis', formatNumber(summary.thuis)],
          ] as const
        ).map(([label, type, value]) => (
          <div key={type} className={`agenda-stat day-${type}`}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="agenda-stat">
          <dt>nm</dt>
          <dd>{formatNumber(summary.nm)}</dd>
        </div>
      </dl>
      {open && (
        <DaySheet
          store={store}
          index={index}
          date={open}
          notify={notify}
          onClose={() => setOpen(null)}
          onAdd={(init) => {
            setOpen(null)
            onAdd(init)
          }}
        />
      )}
    </section>
  )
}

function Week({ index, week, month, today, onOpen }: { index: CalendarIndex; week: string[]; month: string; today: string; onOpen: (date: string) => void }) {
  const bars = tripBars(index, week)
  return (
    <div className="cal-week">
      {week.map((date, column) => {
        const info = dayInfo(index, date, today)
        const label = [formatDate(date), t(`dayType.${info.type ?? 'leeg'}`), ...info.trips.map((v) => v.trip.name), info.nm > 0 ? formatNm(info.nm) : '', info.reminders.length > 0 ? t('calendar.reminder') : ''].filter(Boolean).join(', ')
        const classes = ['cal-day', `col-${column + 1}`, `day-${info.type ?? 'leeg'}`, monthOf(date) !== month ? 'other-month' : '', date === today ? 'today' : '', info.source === 'eigen' ? 'own' : ''].filter(Boolean).join(' ')
        return (
          <button key={date} type="button" className={classes} aria-label={label} aria-current={date === today ? 'date' : undefined} onClick={() => onOpen(date)}>
            <span className="cal-num" aria-hidden="true">
              {Number(date.slice(8))}
            </span>
            {info.reminders.length > 0 && <span className="cal-dot" aria-hidden="true" />}
            {info.nm > 0 && (
              <span className="cal-nm" aria-hidden="true">
                {formatNumber(info.nm)}
              </span>
            )}
          </button>
        )
      })}
      {bars.map((bar) => (
        <span key={bar.view.trip.id} className={`cal-bar col-${bar.from + 1} span-${bar.to - bar.from + 1} lane-${Math.min(bar.lane, 2)}`} aria-hidden="true">
          {bar.starts || bar.from === 0 ? bar.view.trip.name : ''}
        </span>
      ))}
    </div>
  )
}
