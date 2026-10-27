import { CalendarDays, Check, ChevronRight, LoaderCircle, NotebookPen, Pencil, Plus } from 'lucide-react'
import { logPlanned, plannedFor, plannedNm } from '../model/routes'
import { activeWeek } from '../model/weeks'
import type { AddInit } from './QuickAdd'
import { useMemo, useRef, useState, type TouchEvent } from 'react'
import { FillSheet } from '../components/FillSheet'
import { collectGaps, isSunday } from '../model/gaps'
import { GoalSheet, type Notify } from '../components/EditSheets'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { Icon } from '../components/Icon'
import { useSyncStatus } from '../components/SyncStatusLine'
import { useCollection } from '../components/useCollection'
import { formatDate, formatNm, formatNumber } from '../format'
import { nmInYear } from '../model/derive'
import { ReminderSheet } from '../components/ReminderSheet'
import { DueList, useDueItems } from './Deadlines'
import { currentSettings, yearGoal } from '../model/settings'
import { todayIso } from '../model/types'
import { daysUntil, useSession } from '../session'
import { describeStatus, type Store } from '../storage/store'
import { TodayPlan } from './Planning'
import { t } from '../i18n'

// Vandaag: planning van vandaag (als er een lopende planning is), "Dag van vandaag loggen", nm dit jaar met
// voortgang naar het jaardoel, op zondag "N dingen aanvullen", en de eerstvolgende termijnen (deadlines, vervaldatums, token, volgende trip).
// Geen bedragen en geen geldkaarten: Vandaag staat ook open als studenten meekijken. Omlaag trekken synchroniseert.

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
  const tokenDays = daysUntil(session.tokenExpiresAt, today)
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
  const planned = plannedFor(running, legs, today)
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
      <TodayPlan store={store} notify={notify} />
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
      <button className={`btn${planned ? '' : ' primary'} log-day`} onClick={() => onAdd()}>
        <Icon icon={NotebookPen} />
        {t('today.logDay')}
      </button>
      {gaps.length > 0 && (
        <div className="notice">
          <span>{t('gaps.card', { n: gaps.length })}</span>
          <button className="btn small primary" onClick={() => setFilling(true)}>
            {t('gaps.start')}
          </button>
        </div>
      )}
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
        {due.length > 0 && <DueList store={store} items={due.slice(0, 3)} notify={notify} onToken={onSettings} />}
        <button className="btn" onClick={() => setAddingReminder(true)}>
          <Icon icon={Plus} />
          {t('reminder.new')}
        </button>
      </div>
      {addingReminder && <ReminderSheet store={store} reminder={null} notify={notify} onClose={() => setAddingReminder(false)} />}
      {filling && <FillSheet store={store} gaps={gaps} notify={notify} onClose={() => setFilling(false)} />}
      {goalOpen && <GoalSheet store={store} current={goal} onClose={() => setGoalOpen(false)} notify={notify} />}
    </section>
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
