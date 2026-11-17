import { BookOpen, CalendarCheck, CalendarClock, Briefcase, Circle, Coins, FileText, Flag, KeyRound, LifeBuoy, NotebookPen, Plus, Receipt, Send, ShoppingBasket, ChevronRight, type LucideIcon } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { addDays, todayIso } from '../basis/datum'
import { taakMarkeren } from '../domain/berichten'
import { termijnAfronden } from '../domain/termijnen'
import { formatDate } from '../format'
import { t } from '../i18n'
import { lazyComponent } from '../lazy'
import { nameWithCounter } from '../model/counters'
import type { DueItem } from '../model/reminders'
import { currentSettings } from '../model/settings'
import { isLate, isMessageTask, openTasksBetween, todayTasks, type TaskData, type WeekTask, type WeekTaskKind } from '../model/tasks'
import type { Reminder, Trip } from '../model/types'
import { isoWeek } from '../model/weeks'
import { weekToClose } from '../model/week-close'
import { openAdd } from '../navigation'
import { daysUntil } from '../session'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Vandaag doen (src/model/tasks.ts): bovenaan Vandaag alleen wat vandaag moet gebeuren of te laat is, met een rondje om
// af te vinken en een tik op de regel voor de actie zelf (een bericht maken, de trip openen, de fooi invoeren). Daaronder
// één regel "Morgen: …". Weektaken, eigen termijnen, vergeten dagen, de weekafsluiting en de token staan hier samen.
// Discreet: studenten kijken mee, dus geen bedragen en geen titels van documenten of sollicitaties.

const MessageSheet = lazyComponent(() => import('./MessageSheets').then((m) => m.MessageSheet))
const ReminderView = lazyComponent(() => import('./Views').then((m) => m.ReminderView))
const ReminderSheet = lazyComponent(() => import('./ReminderSheet').then((m) => m.ReminderSheet))

export const TASK_ICONS: Record<WeekTaskKind, LucideIcon> = {
  introductie: Send,
  boodschappen: ShoppingBasket,
  lesplanning: BookOpen,
  safety: LifeBuoy,
  afsluiting: Send,
  fooi: Coins,
  afronden: Flag,
  declaraties: Receipt,
}

/** Termijnen die vandaag op de lijst horen: eigen termijnen op of na hun dag, de token een week vooraf. */
export function dueToday(items: readonly DueItem[], today: string): DueItem[] {
  return items.filter((item) => {
    if (item.source === 'trip') return false
    if (item.source === 'token') return item.date <= addDays(today, 7)
    return item.date <= today
  })
}

export function useTaskData(store: Store): TaskData {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const plans = useCollection(store, 'plans.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const claims = useCollection(store, 'claims.json.enc')
  const settingsRecords = useCollection(store, 'settings.json.enc')
  return useMemo(() => ({ trips, legs, plans, transactions, claims, settings: currentSettings(settingsRecords) }), [trips, legs, plans, transactions, claims, settingsRecords])
}

function whenLabel(date: string, today: string): string {
  const late = -(daysUntil(date, today) ?? 0)
  return late > 0 ? t('todo.late', { n: late }) : t('expiry.today')
}

export interface Forgotten {
  trip: Trip
  dates: string[]
}

export function TodoToday({
  store,
  notify,
  due,
  forgotten,
  onOpenTrip,
  onToken,
  onReminders,
}: {
  store: Store
  notify: Notify
  /** Alle open termijnen (useDueItems); hier alleen die van vandaag of eerder. */
  due: readonly DueItem[]
  forgotten: Forgotten | null
  onOpenTrip: (trip: Trip) => void
  onToken: () => void
  onReminders: () => void
}) {
  const today = todayIso()
  const data = useTaskData(store)
  const counters = useCounters(store)
  const reminders = useCollection(store, 'reminders.json.enc')
  const closings = useCollection(store, 'weekreviews.json.enc')
  const [message, setMessage] = useState<WeekTask | null>(null)
  const [task, setTask] = useState<WeekTask | null>(null)
  const [reminder, setReminder] = useState<Reminder | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const tasks = todayTasks(data, today)
  const own = dueToday(due, today)
  const closeWeek = weekToClose(today, closings)
  const tomorrow = addDays(today, 1)
  const tomorrowItems = [
    ...openTasksBetween(data, tomorrow, tomorrow).map((x) => `${t(`task.${x.kind}`)} · ${nameWithCounter(x.trip, counters.get(x.trip.id))}`),
    ...due.filter((d) => d.source === 'eigen' && d.date === tomorrow).map((d) => d.title),
  ]
  const count = tasks.length + own.length + (forgotten ? 1 : 0) + (closeWeek ? 1 : 0)
  const tripName = (trip: Trip) => nameWithCounter(trip, counters.get(trip.id))

  async function tick(x: WeekTask) {
    if (busy) return
    setBusy(true)
    try {
      const undo = await taakMarkeren(store, x.trip.id, x.kind, 'gedaan', today)
      notify(t('todo.markedDone'), undo)
    } finally {
      setBusy(false)
    }
  }

  async function tickReminder(r: Reminder) {
    if (busy) return
    setBusy(true)
    try {
      const undo = await termijnAfronden(store, r, true, today)
      notify(t('todo.markedDone'), undo)
    } finally {
      setBusy(false)
    }
  }

  function openTask(x: WeekTask) {
    if (isMessageTask(x.kind)) setMessage(x)
    else setTask(x)
  }

  return (
    <div className="card card-body stack-sm todo-today">
      <div className="section-head">
        <h2>{t('todo.title')}</h2>
        <button type="button" className="btn link small" onClick={onReminders}>
          {t('reminder.all')}
          <Icon icon={ChevronRight} />
        </button>
      </div>
      {count === 0 && <p className="muted todo-none">{t('todo.none')}</p>}
      {count > 0 && (
        <ul className="plain-list todo-list">
          {tasks.map((x) => {
            const title = t(`task.${x.kind}`)
            return (
              <li key={`${x.trip.id}-${x.kind}`} className="todo-row">
                <button type="button" className="todo-check" aria-label={t('todo.markAria', { task: title })} disabled={busy} onClick={() => void tick(x)}>
                  <Icon icon={Circle} />
                </button>
                <button type="button" className="todo-main" onClick={() => openTask(x)}>
                  <Icon icon={TASK_ICONS[x.kind]} />
                  <span className="row-main">
                    <span>{title}</span>
                    <span className="muted small">{tripName(x.trip)}</span>
                  </span>
                  <span className={`small todo-when${isLate(x, today) ? ' negative' : ''}`}>{whenLabel(x.date, today)}</span>
                </button>
              </li>
            )
          })}
          {forgotten && (
            <li className="todo-row">
              <span className="todo-check" />
              <button type="button" className="todo-main" onClick={() => openAdd({ date: forgotten.dates[0]!, tripId: forgotten.trip.id })}>
                <Icon icon={NotebookPen} />
                <span className="row-main">
                  <span>{t('todo.logDay', { date: formatDate(forgotten.dates[0]!) })}</span>
                  <span className="muted small">
                    {[tripName(forgotten.trip), forgotten.dates.length > 1 ? t('todo.moreDays', { n: forgotten.dates.length - 1 }) : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          )}
          {closeWeek && (
            <li className="todo-row">
              <span className="todo-check" />
              <button type="button" className="todo-main" onClick={() => document.getElementById('week-close')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <Icon icon={CalendarCheck} />
                <span className="row-main">
                  <span>{t('weekClose.title', { week: isoWeek(closeWeek) })}</span>
                </span>
              </button>
            </li>
          )}
          {own.map((item) => {
            const record = item.id ? reminders.find((r) => r.id === item.id) : undefined
            const title = item.source === 'document' ? t('vault.dueTitle') : item.source === 'career' ? t('career.dueTitle') : item.title
            const icon = item.source === 'token' ? KeyRound : item.source === 'document' ? FileText : item.source === 'career' ? Briefcase : CalendarClock
            const open = record ? () => setReminder(record) : item.source === 'token' ? onToken : onReminders
            const late = item.date < today
            return (
              <li key={item.id ?? `${item.source}-${item.date}`} className="todo-row">
                {record ? (
                  <button type="button" className="todo-check" aria-label={t('todo.markAria', { task: title })} disabled={busy} onClick={() => void tickReminder(record)}>
                    <Icon icon={Circle} />
                  </button>
                ) : (
                  <span className="todo-check" />
                )}
                <button type="button" className="todo-main" onClick={open}>
                  <Icon icon={icon} />
                  <span className="row-main">
                    <span>{title}</span>
                    {item.source === 'token' && <span className="muted small">{formatDate(item.date)}</span>}
                  </span>
                  <span className={`small todo-when${late && item.kind === 'deadline' ? ' negative' : ''}`}>
                    {item.date > today ? t('expiry.inDays', { n: daysUntil(item.date, today) ?? 0 }) : late && item.kind !== 'deadline' ? t('expiry.expired') : whenLabel(item.date, today)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {tomorrowItems.length > 0 && (
        <p className="muted small todo-tomorrow">
          {t('todo.tomorrow', { items: tomorrowItems.slice(0, 2).join(', ') + (tomorrowItems.length > 2 ? ` +${tomorrowItems.length - 2}` : '') })}
        </p>
      )}
      <button type="button" className="btn link small todo-add" onClick={() => setAdding(true)}>
        <Icon icon={Plus} />
        {t('todo.add')}
      </button>
      <Suspense fallback={null}>
        {message && (
          <MessageSheet store={store} notify={notify} trip={message.trip} kind={{ kind: message.kind }} onClose={() => setMessage(null)} />
        )}
        {reminder && <ReminderView store={store} reminder={reminder} notify={notify} onClose={() => setReminder(null)} />}
        {adding && <ReminderSheet store={store} reminder={null} initialDate={today} notify={notify} onClose={() => setAdding(false)} />}
      </Suspense>
      {task && (
        <TaskSheet
          store={store}
          notify={notify}
          task={task}
          tripName={tripName(task.trip)}
          onOpenTrip={() => {
            setTask(null)
            onOpenTrip(task.trip)
          }}
          onClose={() => setTask(null)}
        />
      )}
    </div>
  )
}

/** Een weektaak die geen bericht is: wat en wanneer, de actie, Gedaan en Niet nodig. */
export function TaskSheet({
  store,
  notify,
  task,
  tripName,
  onOpenTrip,
  onClose,
}: {
  store: Store
  notify: Notify
  task: WeekTask
  tripName: string
  onOpenTrip?: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const today = todayIso()
  async function mark(status: 'gedaan' | 'niet-nodig' | null) {
    if (busy) return
    setBusy(true)
    try {
      const undo = await taakMarkeren(store, task.trip.id, task.kind, status, today)
      onClose()
      notify(status === 'niet-nodig' ? t('msg.markedNotNeeded') : t('todo.markedDone'), undo)
    } finally {
      setBusy(false)
    }
  }
  const open = task.done === null
  return (
    <Sheet title={t(`task.${task.kind}`)} kicker={tripName} onClose={onClose}>
      <div className="stack">
        <p className="muted">{formatDate(task.date)}</p>
        {task.kind === 'fooi' && (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onClose()
              openAdd({ date: today, tripId: task.trip.id, incomeKind: 'fooi' }, 'inkomsten')
            }}
          >
            <Icon icon={Coins} />
            {t('task.fooi')}
          </button>
        )}
        {onOpenTrip && task.kind !== 'fooi' && task.kind !== 'safety' && (
          <button type="button" className="btn primary" onClick={onOpenTrip}>
            <Icon icon={ChevronRight} />
            {t('todo.openTrip')}
          </button>
        )}
        {open ? (
          <div className="two">
            <button type="button" className={`btn${task.kind === 'safety' ? ' primary' : ''}`} disabled={busy} onClick={() => void mark('gedaan')}>
              {t('todo.done')}
            </button>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => void mark('niet-nodig')}>
              {t('msg.notNeeded')}
            </button>
          </div>
        ) : (
          task.done !== 'vanzelf' && (
            <button type="button" className="btn quiet" disabled={busy} onClick={() => void mark(null)}>
              {t('tasks.reopen')}
            </button>
          )
        )}
      </div>
    </Sheet>
  )
}
