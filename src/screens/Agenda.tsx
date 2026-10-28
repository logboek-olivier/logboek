import { CalendarRange, ChevronLeft, ChevronRight, Eye, EyeOff, FileUp, ListOrdered, NotebookPen, Share2, X } from 'lucide-react'
import { useMemo, useRef, useState, useSyncExternalStore, type TouchEvent } from 'react'
import { DaySheet } from '../components/DaySheet'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { PeriodSheet, PlanningImportSheet } from '../components/PeriodSheets'
import { ReminderSheet } from '../components/ReminderSheet'
import { useCollection } from '../components/useCollection'
import { WeekSheet } from '../components/WeekSheet'
import { recordError } from '../errors'
import { formatDate, formatMoney, formatMonth, formatNm, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import { parsePlanning, planImport, PlanningError, type PlanItem } from '../import/planning'
import { buildIndex, dayInfo, monthIncome, monthOf, monthSummary, monthWeeks, shiftMonth, tripBars, type CalendarIndex } from '../model/calendar'
import { getRates, subscribeRates } from '../model/rates'
import { todayIso, type Reminder } from '../model/types'
import type { Store } from '../storage/store'
import { AgendaShare } from './AgendaShare'
import { useDueItems } from './Deadlines'
import type { AddInit } from './QuickAdd'
import { Season } from './Season'
import { ErrorLine } from './Setup'

// Agenda: het overzicht van het seizoen. Maandraster met een kleur per dagsoort (optie gestreept), een balk met de
// tripnaam over de dagen van elke trip, nm klein in het vakje en een stip voor termijnen. Vegen of de pijlen voor de
// vorige en volgende maand, "Naar vandaag", en onderaan de werk-, rust-, reis- en thuisdagen en nm van de maand.
// Tik op een dag: het dagblad. Periode markeren (begindag, einddag, dagsoort; werk = nieuwe trip met die datums),
// planning importeren, seizoensoverzicht en delen. Het Logboek (archief) is hier ook te openen.

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
  const [view, setView] = useState<'maand' | 'seizoen' | 'delen'>('maand')
  // Periode markeren: eerste tik = begindag, tweede tik = einddag, dan de dagsoort kiezen.
  const [marking, setMarking] = useState<{ start: string | null } | null>(null)
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null)
  const [newTrip, setNewTrip] = useState<{ startDate: string; dayCount: number } | null>(null)
  const [plan, setPlan] = useState<PlanItem[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // Termijn bewerken of toevoegen vanuit het dagblad (reminder null = nieuwe termijn op die dag).
  const [reminder, setReminder] = useState<{ reminder: Reminder | null; date: string } | null>(null)
  const [showAmounts, setShowAmounts] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const transactions = useCollection(store, 'transactions.json.enc')
  useSyncExternalStore(subscribeRates, getRates)
  // Termijnen op hun dag: eigen termijnen (in de index) en de vervaldatum van de token.
  const due = useDueItems(store)
  const dueDates = useMemo(() => new Set(due.filter((i) => i.source !== 'trip').map((i) => i.date.slice(0, 10))), [due])
  const weekdays = useMemo(() => {
    const names = new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'narrow' })
    // 5 januari 2026 is een maandag.
    return Array.from({ length: 7 }, (_, i) => names.format(new Date(2026, 0, 5 + i)))
  }, [lang])

  if (view === 'seizoen') return <Season store={store} onBack={() => setView('maand')} />
  if (view === 'delen') return <AgendaShare store={store} onBack={() => setView('maand')} />

  const weeks = monthWeeks(month)
  const summary = monthSummary(index, month, today)
  const income = showAmounts ? monthIncome(index, transactions, month, today) : null

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

  function onDay(date: string) {
    if (!marking) {
      setOpen(date)
      return
    }
    if (!marking.start) {
      setMarking({ start: date })
      return
    }
    const [from, to] = marking.start <= date ? [marking.start, date] : [date, marking.start]
    setMarking(null)
    setPeriod({ from, to })
  }

  async function onPlanningFile(file: File | undefined) {
    if (!file) return
    setImportError(null)
    try {
      // Inhoud bepaalt het formaat (CSV of .xlsx), niet de naam of het MIME-type van de bestandskiezer.
      setPlan(planImport(parsePlanning(new Uint8Array(await file.arrayBuffer())), index))
    } catch (error) {
      recordError(error)
      setImportError(error instanceof PlanningError ? error.message : t('import.unreadable'))
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

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
      {marking && (
        <div className="notice marking" role="status">
          <span>{t(marking.start ? 'calendar.markEnd' : 'calendar.markStart')}</span>
          <button className="btn link small" onClick={() => setMarking(null)}>
            <Icon icon={X} />
            {t('common.cancel')}
          </button>
        </div>
      )}
      <div className={`cal${marking ? ' marking' : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="cal-weekdays" aria-hidden="true">
          {weekdays.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <Week key={week[0]} index={index} week={week} month={month} today={today} dueDates={dueDates} rangeStart={marking?.start ?? null} onDay={onDay} />
        ))}
      </div>
      <dl className="agenda-summary" aria-label={t('calendar.summaryTitle')}>
        {(
          [
            ['dayType.werk', 'werk', summary.werk],
            ['dayType.rust', 'rust', summary.rust],
            ['dayType.reis', 'reis', summary.reis],
            ['dayType.thuis', 'thuis', summary.thuis],
          ] as const
        ).map(([label, type, value]) => (
          <div key={type} className={`agenda-stat day-${type}`}>
            <dt>{t(label)}</dt>
            <dd>{formatNumber(value)}</dd>
          </div>
        ))}
        <div className="agenda-stat">
          <dt>nm</dt>
          <dd>{formatNumber(summary.nm)}</dd>
        </div>
      </dl>
      {/* Bedragen pas na een tik: de agenda staat soms open als gasten of studenten meekijken. */}
      <div className="agenda-income">
        <button className="btn link small" aria-pressed={showAmounts} onClick={() => setShowAmounts(!showAmounts)}>
          <Icon icon={showAmounts ? EyeOff : Eye} />
          {t(showAmounts ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
        {income && (
          <span>
            {t('calendar.income')}: <strong>{formatMoney(income.eur, 'EUR')}</strong>
            {income.perWorkday !== null && <span className="muted"> · {t('calendar.perWorkday', { amount: formatMoney(income.perWorkday, 'EUR') })}</span>}
          </span>
        )}
      </div>
      <div className="agenda-actions">
        <button className={`btn small${marking ? ' active' : ''}`} aria-pressed={!!marking} onClick={() => setMarking(marking ? null : { start: null })}>
          <Icon icon={CalendarRange} />
          {t('calendar.markPeriod')}
        </button>
        <button className="btn small" onClick={() => setView('seizoen')}>
          <Icon icon={ListOrdered} />
          {t('calendar.season')}
        </button>
        <button className="btn small" onClick={() => setView('delen')}>
          <Icon icon={Share2} />
          {t('calendar.share')}
        </button>
        <button className="btn small" onClick={() => fileInput.current?.click()}>
          <Icon icon={FileUp} />
          {t('planning.import')}
        </button>
        {/* Geen accept-filter: Android en Google Drive grijzen anders bestanden uit. */}
        <input ref={fileInput} type="file" hidden aria-label={t('planning.file')} onChange={(e) => void onPlanningFile(e.target.files?.[0])} />
      </div>
      <ErrorLine error={importError} />
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
          onReminder={(r) => {
            setReminder({ reminder: r, date: open })
            setOpen(null)
          }}
        />
      )}
      {reminder && <ReminderSheet store={store} reminder={reminder.reminder} initialDate={reminder.date} notify={notify} onClose={() => setReminder(null)} />}
      {period && (
        <PeriodSheet
          store={store}
          index={index}
          from={period.from}
          to={period.to}
          notify={notify}
          onClose={() => setPeriod(null)}
          onWork={(startDate, dayCount) => {
            setPeriod(null)
            setNewTrip({ startDate, dayCount })
          }}
        />
      )}
      {newTrip && <WeekSheet store={store} trip={null} initial={newTrip} notify={notify} onClose={() => setNewTrip(null)} />}
      {plan && <PlanningImportSheet store={store} items={plan} notify={notify} onClose={() => setPlan(null)} />}
    </section>
  )
}

function Week({ index, week, month, today, dueDates, rangeStart, onDay }: { index: CalendarIndex; week: string[]; month: string; today: string; dueDates: ReadonlySet<string>; rangeStart: string | null; onDay: (date: string) => void }) {
  const bars = tripBars(index, week)
  return (
    <div className="cal-week">
      {week.map((date, column) => {
        const info = dayInfo(index, date, today)
        const hasDue = dueDates.has(date)
        const label = [formatDate(date), t(`dayType.${info.type ?? 'leeg'}`), ...info.trips.map((v) => v.trip.name), info.nm > 0 ? formatNm(info.nm) : '', hasDue ? t('calendar.reminder') : ''].filter(Boolean).join(', ')
        const classes = ['cal-day', `col-${column + 1}`, `day-${info.type ?? 'leeg'}`, monthOf(date) !== month ? 'other-month' : '', date === today ? 'today' : '', info.source === 'eigen' ? 'own' : '', date === rangeStart ? 'range-start' : ''].filter(Boolean).join(' ')
        return (
          <button key={date} type="button" className={classes} aria-label={label} aria-current={date === today ? 'date' : undefined} aria-pressed={date === rangeStart ? true : undefined} onClick={() => onDay(date)}>
            <span className="cal-num" aria-hidden="true">
              {Number(date.slice(8))}
            </span>
            {hasDue && <span className="cal-dot" aria-hidden="true" />}
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
