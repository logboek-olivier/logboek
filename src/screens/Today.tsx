import { CalendarDays, Check, ChevronRight, LoaderCircle, NotebookPen, Pencil, Plane, Plus } from 'lucide-react'
import { logPlanned, plannedFor, plannedNm } from '../model/routes'
import { activeWeek, dayCountOf, missingDays, weekView } from '../model/weeks'
import { addDays } from '../model/money'
import { daysBetween } from '../model/calendar'
import { routeOf } from '../model/trip-route'
import { totalNm } from '../model/derive'
import { nameWithCounter } from '../model/counters'
import { useCounters } from '../components/useCounters'
import { RouteMap } from '../components/LazyMap'
import { boatLine } from '../components/boat-line'
import type { AddInit } from './QuickAdd'
import { Suspense, useMemo, useRef, useState, type TouchEvent } from 'react'
import { collectGaps, isSunday } from '../model/gaps'
import { WeekClose } from '../components/WeekClose'
import { WeatherCard } from '../components/WeatherCard'
import type { Notify } from '../components/EditSheets'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { Icon } from '../components/Icon'
import { useIsDemo } from '../components/DemoBar'
import { useSyncStatus } from '../components/SyncStatusLine'
import { useCollection } from '../components/useCollection'
import { formatDate, formatNm, formatNumber } from '../format'
import { buildIndex, dayInfo } from '../model/calendar'
import { nmInYear } from '../model/derive'
import { DueList, useDueItems } from './Deadlines'
import { SalaryQuestions } from '../components/SalarySheets'
import { PayoutQuestions } from '../components/MoneyPath'
import { currentSettings, yearGoal } from '../model/settings'
import { todayIso, type Reminder, type Trip } from '../model/types'
import { daysUntil, useSession } from '../session'
import { describeStatus, type Store } from '../storage/store'
import { t } from '../i18n'
import { lazyComponent } from '../lazy'

// Vandaag volgt de dagsoort uit de agenda (tik = dagblad): bij werk de planning van vandaag, "Zoals gepland" en "Dag van
// vandaag loggen"; bij reis de reisgegevens; bij rust en thuis niets om te loggen. Verder nm dit jaar met voortgang
// naar het jaardoel, op zondag "N dingen aanvullen", en de eerstvolgende termijnen (deadlines, vervaldatums, token, volgende trip).
// Geen bedragen en geen geldkaarten: Vandaag staat ook open als studenten meekijken. Omlaag trekken synchroniseert.

// De bladen die Vandaag opent, laden pas bij de tik (src/lazy.ts): Vandaag zelf opent zo snel mogelijk.
const DayView = lazyComponent(() => import('../components/DaySheet').then((m) => m.DayView))
const ReminderView = lazyComponent(() => import('../components/Views').then((m) => m.ReminderView))
const TripOverviewSheet = lazyComponent(() => import('../components/TripOverview').then((m) => m.TripOverviewSheet))
const FillSheet = lazyComponent(() => import('../components/FillSheet').then((m) => m.FillSheet))
const GoalSheet = lazyComponent(() => import('../components/EditSheets').then((m) => m.GoalSheet))
const ReminderSheet = lazyComponent(() => import('../components/ReminderSheet').then((m) => m.ReminderSheet))
const WeekSheet = lazyComponent(() => import('../components/WeekSheet').then((m) => m.WeekSheet))
const TodayPlan = lazyComponent(() => import('./Planning').then((m) => m.TodayPlan))

const TOKEN_WARNING_DAYS = 30
/** Zo ver omlaag trekken (px) start een sync. */
const PULL_THRESHOLD = 72

export function Today({
  store,
  notify,
  onSettings,
  onAdd,
  onReminders,
}: {
  store: Store
  notify: Notify
  onSettings: () => void
  onAdd: (init?: AddInit) => void
  onReminders: () => void
}) {
  const session = useSession()
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const status = useSyncStatus(store)
  const [goalOpen, setGoalOpen] = useState(false)
  const pull = usePullToSync(() => void store.sync())
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const nmYear = nmInYear(legs, year)
  const goal = yearGoal(settings)
  const share = Math.min(1, nmYear / goal)
  // In de demo niets over de eigen token.
  const demo = useIsDemo()
  const tokenDays = demo ? null : daysUntil(session.tokenExpiresAt, today)
  const tokenInvalid = status.kind === 'error' && status.code === 'token'
  // Termijnen: eigen deadlines en vervaldatums, de token en de volgende trip. De kluis voegt later documenten toe.
  const due = useDueItems(store)
  const [addingReminder, setAddingReminder] = useState(false)
  // Zondag: de lege velden van de week op een rij (niets is verplicht, dit is de wekelijkse inhaalronde).
  const trips = useCollection(store, 'trips.json.enc')
  const gaps = useMemo(() => (isSunday(today) ? collectGaps(trips, legs) : []), [trips, legs, today])
  const [filling, setFilling] = useState(false)
  // Geplande etappe van vandaag in de lopende trip (sjabloon of vorige trip): "Zoals gepland" logt hem met één tik.
  const running = activeWeek(trips, settings, today)
  // Dagsoort van vandaag: eigen instelling, anders uit trips en dagen.
  const calendar = useCollection(store, 'calendar.json.enc')
  const reminders = useCollection(store, 'reminders.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs, reminders), [calendar, trips, legs, reminders])
  const day = dayInfo(index, today, today)
  const nothingToLog = day.type === 'reis' || day.type === 'rust' || day.type === 'thuis' || day.type === 'onbeschikbaar'
  const [dayOpen, setDayOpen] = useState(false)
  const [reminderFromDay, setReminderFromDay] = useState<{ reminder: Reminder | null } | null>(null)
  const [editTrip, setEditTrip] = useState<Trip | null>(null)
  const [viewTrip, setViewTrip] = useState<Trip | null>(null)
  const planned = nothingToLog ? null : plannedFor(running, legs, today)
  // Open vragen: vergeten dagen van de lopende trip tot en met gisteren (vandaag heeft zijn eigen knop).
  const forgotten = running ? missingDays(weekView(running, legs), addDays(today, -1)) : []
  const plannedDistance = planned ? plannedNm(legs, planned) : null
  async function logAsPlanned() {
    if (!running || !planned) return
    await logPlanned(store, running, planned, today, settings)
    try {
      navigator.vibrate?.(30)
    } catch {
      // Niet beschikbaar.
    }
    notify(t('toast.daySaved'))
  }

  return (
    <section className="stack" onTouchStart={pull.onTouchStart} onTouchMove={pull.onTouchMove} onTouchEnd={pull.onTouchEnd}>
      <div className="pull-indicator" ref={pull.indicator} aria-hidden="true">
        <Icon icon={LoaderCircle} className={status.kind === 'syncing' ? 'spin' : ''} />
        <span>{pull.ready ? t('today.pullRelease') : t('today.pullHint')}</span>
      </div>
      <header className="page-header">
        <h1>{t('nav.today')}</h1>
      </header>
      {tokenInvalid && (
        <Notice
          text={t('today.tokenInvalid')}
          onSettings={onSettings}
        />
      )}
      {status.kind === 'error' && !tokenInvalid && status.code !== 'unreadable' && status.code !== 'otherKey' && status.code !== 'noMeta' && (
        <div className="notice error-block" role="alert">
          <span>
            {t('today.syncFailed', { message: describeStatus(status) })}
          </span>
          {status.code !== 'update' && <CopyErrorDetails />}
        </div>
      )}
      {!tokenInvalid && tokenDays !== null && tokenDays <= TOKEN_WARNING_DAYS && session.tokenExpiresAt && (
        <Notice
          text={
            tokenDays < 0
              ? t('today.tokenExpired', { date: formatDate(session.tokenExpiresAt) })
              : tokenDays === 0
                ? t('today.tokenExpiresToday')
                : t('today.tokenExpires', { date: formatDate(session.tokenExpiresAt), n: tokenDays })
          }
          onSettings={onSettings}
        />
      )}
      {running ? (
        <TodayTrip store={store} trip={running} day={day} onOpen={() => setViewTrip(running)} onDay={() => setDayOpen(true)} />
      ) : (
        <DayKind day={day} onOpen={() => setDayOpen(true)} />
      )}
      {planned && running && (
        <div className="card card-body planned-today">
          <span className="label">{t('route.today')}</span>
          <strong>
            {[planned.from, planned.to].filter(Boolean).join(' → ')}
            {plannedDistance !== null ? ` · ${formatNm(plannedDistance)}` : ''}
          </strong>
          <div className="two">
            <button className="btn primary" onClick={() => void logAsPlanned()}>
              <Icon icon={Check} />
              {t('route.asPlanned')}
            </button>
            <button className="btn" onClick={() => onAdd({ date: today, tripId: running.id, from: planned.from, to: planned.to })}>
              <Icon icon={Pencil} />
              {t('route.adjust')}
            </button>
          </div>
        </div>
      )}
      {!nothingToLog && (
        <Suspense fallback={null}>
          <TodayPlan store={store} notify={notify} />
        </Suspense>
      )}
      {!nothingToLog && (
        <button className={`btn${planned ? '' : ' primary'} log-day`} onClick={() => onAdd()}>
          <Icon icon={NotebookPen} />
          {t('today.logDay')}
        </button>
      )}
      {running && <WeatherCard store={store} trip={running} />}
      {forgotten.length > 0 && running && (
        <div className="notice">
          <p className="small">{t('trip.missingDays', { n: forgotten.length })}</p>
          <button className="btn small primary" onClick={() => onAdd({ date: forgotten[0]!, tripId: running.id })}>
            {t('trip.logMissing', { date: formatDate(forgotten[0]!) })}
          </button>
        </div>
      )}
      <SalaryQuestions store={store} notify={notify} />
      <PayoutQuestions store={store} notify={notify} />
      {gaps.length > 0 && (
        <div className="notice">
          <span>{t('gaps.card', { n: gaps.length })}</span>
          <button className="btn small primary" onClick={() => setFilling(true)}>
            {t('gaps.start')}
          </button>
        </div>
      )}
      <WeekClose store={store} index={index} today={today} notify={notify} />
      <button
        className="stat hero goal"
        onClick={() => setGoalOpen(true)}
        aria-label={t('today.goalAria', { year, nm: formatNm(nmYear), pct: formatNumber(Math.round(share * 100)), goal: formatNm(goal) })}
      >
        <span className="stat-label">
          <Icon icon={CalendarDays} />
          {t('today.nmYear', { year })}
        </span>
        <span className="stat-value">{formatNm(nmYear)}</span>
        <span className="small muted">
          {t('today.goalShare', { pct: formatNumber(Math.round(share * 100)), goal: formatNm(goal) })}
          {' · '}
          {nmYear < goal ? t('today.goalLeft', { nm: formatNm(Math.round((goal - nmYear) * 10) / 10) }) : t('today.goalReached')}
        </span>
        <span
          className="progress"
          role="progressbar"
          aria-label={t('today.goalProgress')}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={nmYear}
        >
          <span className="progress-fill" ref={(el) => setWidth(el, share)} />
        </span>
      </button>
      <div className="section">
        <div className="section-head">
          <h2>{t('reminder.screen')}</h2>
          <button className="btn link small" onClick={onReminders}>
            {t('reminder.all')}
            <Icon icon={ChevronRight} />
          </button>
        </div>
        {due.length > 0 && <DueList store={store} items={due.slice(0, 3)} notify={notify} onToken={onSettings} discreet />}
        <button className="btn" onClick={() => setAddingReminder(true)}>
          <Icon icon={Plus} />
          {t('reminder.new')}
        </button>
      </div>
      <Suspense fallback={null}>
      {addingReminder && <ReminderSheet store={store} reminder={null} notify={notify} onClose={() => setAddingReminder(false)} />}
      {dayOpen && (
        <DayView
          store={store}
          index={index}
          date={today}
          notify={notify}
          onClose={() => setDayOpen(false)}
          onAdd={(init) => {
            setDayOpen(false)
            onAdd(init)
          }}
          onReminder={(reminder) => {
            setDayOpen(false)
            setReminderFromDay({ reminder })
          }}
          onEditTrip={(trip) => {
            setDayOpen(false)
            setEditTrip(trip)
          }}
          onOpenTrip={(trip) => {
            setDayOpen(false)
            setViewTrip(trip)
          }}
        />
      )}
      {viewTrip && <TripOverviewSheet key={viewTrip.id} store={store} trip={viewTrip} notify={notify} onClose={() => setViewTrip(null)} />}
      {editTrip && <WeekSheet key={editTrip.id} store={store} trip={editTrip} notify={notify} onClose={() => setEditTrip(null)} />}
      {reminderFromDay &&
        (reminderFromDay.reminder ? (
          <ReminderView store={store} reminder={reminderFromDay.reminder} notify={notify} onClose={() => setReminderFromDay(null)} />
        ) : (
          <ReminderSheet store={store} reminder={null} initialDate={today} notify={notify} onClose={() => setReminderFromDay(null)} />
        ))}
      {filling && <FillSheet store={store} gaps={gaps} notify={notify} onClose={() => setFilling(false)} />}
      {goalOpen && <GoalSheet store={store} current={goal} onClose={() => setGoalOpen(false)} notify={notify} />}
      </Suspense>
    </section>
  )
}

/**
 * De lopende trip groot bovenaan: teller en naam, dag x van y, boot, nm en dagen tot nu toe en de route op de kaart.
 * Tik = tripoverzicht; de dagsoort bovenin opent de dagkaart. Geen bedragen.
 */
function TodayTrip({ store, trip, day, onOpen, onDay }: { store: Store; trip: Trip; day: ReturnType<typeof dayInfo>; onOpen: () => void; onDay: () => void }) {
  const dayType = day.type ?? 'leeg'
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const counters = useCounters(store)
  const today = todayIso()
  const view = weekView(trip, legs)
  const total = dayCountOf(view)
  const dayNumber = view.startDate ? daysBetween(view.startDate, today) + 1 : null
  const soFar = view.legs.filter((l) => l.date <= today)
  const nm = Math.round(soFar.reduce((n, l) => n + totalNm(l), 0) * 10) / 10
  const name = nameWithCounter(trip, counters.get(trip.id))
  const when =
    dayNumber === null ? '' : dayNumber > total ? t('today.tripEnded') : dayNumber < 1 ? t('today.tripStarts', { n: 1 - dayNumber }) : t('today.dayOf', { n: dayNumber, total })
  return (
    <div className="card today-trip">
      <div className="today-trip-top">
        <button type="button" className={`today-trip-day day-${dayType}`} onClick={onDay} aria-label={`${t('today.kind')}: ${t(`dayType.${dayType}`)}. ${t('today.change')}`}>
          {t(`dayType.${dayType}`)}
          <Icon icon={ChevronRight} />
        </button>
        {when && <span className="today-trip-when">{when}</span>}
      </div>
      {dayType !== 'werk' && <DayDetails day={day} />}
      <button type="button" className="today-trip-main" onClick={onOpen} aria-label={t('trip.open', { name })}>
        <span className="today-trip-name">{name}</span>
        {boatLine(trip, view.boat) && <span className="muted">{boatLine(trip, view.boat)}</span>}
        <span className="today-trip-totals">
          <span>
            <strong>{formatNm(nm)}</strong> {t('today.soFar')}
          </span>
          <span>{t('unit.days', { n: soFar.length })}</span>
        </span>
      </button>
      <RouteMap route={routeOf(soFar, places)} small />
    </div>
  )
}

/** Dagsoort van vandaag in één regel (tik = dagblad); bij reis de reisgegevens, bij rust en thuis "niets te loggen". */
function DayKind({ day, onOpen }: { day: ReturnType<typeof dayInfo>; onOpen: () => void }) {
  const type = day.type ?? 'leeg'
  const trip = day.type === 'werk' ? day.trips.at(-1)?.trip.name : undefined
  const place = day.type !== 'werk' && day.type !== 'reis' ? day.own?.location : undefined
  return (
    <button type="button" className={`today-kind day-${type}`} onClick={onOpen} aria-label={`${t('today.kind')}: ${t(`dayType.${type}`)}${trip ? `, ${trip}` : ''}. ${t('today.change')}`}>
      <span className="today-kind-head">
        <strong>
          {t(`dayType.${type}`)}
          {trip ? ` · ${trip}` : ''}
          {place ? ` · ${place}` : ''}
        </strong>
      </span>
      <DayDetails day={day} />
      <Icon icon={ChevronRight} className="today-kind-chevron" />
    </button>
  )
}

/** Reisgegevens, notitie en "niets te loggen" bij de dagsoort van vandaag. */
function DayDetails({ day }: { day: ReturnType<typeof dayInfo> }) {
  const travel = day.type === 'reis' ? day.own?.travel : undefined
  return (
    <>
      {travel && (travel.from || travel.to || travel.flight) && (
        <span className="today-travel">
          <Icon icon={Plane} />
          {[travel.from, travel.to].filter(Boolean).join(' → ')}
          {travel.flight ? ` · ${travel.flight}` : ''}
        </span>
      )}
      {day.own?.note && <span className="muted small">{day.own.note}</span>}
      {(day.type === 'rust' || day.type === 'thuis' || day.type === 'onbeschikbaar') && <span className="muted small">{t('today.nothingToLog')}</span>}
    </>
  )
}

/** Breedte via CSSOM (de CSP staat geen inline style-attributen toe, wel element.style). */
function setWidth(el: HTMLElement | null, share: number) {
  if (el) el.style.width = `${Math.round(share * 1000) / 10}%`
}

/** Omlaag trekken bovenaan de pagina; ver genoeg en loslaten = synchroniseren. */
function usePullToSync(onSync: () => void) {
  const start = useRef<number | null>(null)
  const distance = useRef(0)
  const indicator = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  const setHeight = (px: number) => {
    if (indicator.current) indicator.current.style.height = `${px}px`
  }

  return {
    indicator,
    ready,
    onTouchStart(e: TouchEvent) {
      start.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null
      distance.current = 0
    },
    onTouchMove(e: TouchEvent) {
      if (start.current === null) return
      distance.current = Math.max(0, e.touches[0]!.clientY - start.current)
      // Weerstand: de indicator groeit langzamer dan de vinger.
      setHeight(Math.min(56, distance.current / 2))
      setReady(distance.current >= PULL_THRESHOLD)
    },
    onTouchEnd() {
      if (start.current !== null && distance.current >= PULL_THRESHOLD) onSync()
      start.current = null
      distance.current = 0
      setHeight(0)
      setReady(false)
    },
  }
}

function Notice({ text, onSettings }: { text: string; onSettings: () => void }) {
  return (
    <div className="notice" role="alert">
      <span>{text}</span>
      <button className="btn link" onClick={onSettings}>
        {t('settings.replaceToken')}
      </button>
    </div>
  )
}
