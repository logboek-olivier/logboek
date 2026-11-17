import { Circle, CircleCheck } from 'lucide-react'
import { Suspense, useState } from 'react'
import { todayIso } from '../basis/datum'
import { taakMarkeren } from '../domain/berichten'
import { formatDateShort as formatDate } from '../format'
import { t } from '../i18n'
import { lazyComponent } from '../lazy'
import { isLate, isMessageTask, weekTasksOf, type WeekTask } from '../model/tasks'
import type { Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { useCounters } from './useCounters'
import { nameWithCounter } from '../model/counters'
import { TASK_ICONS, TaskSheet, useTaskData } from './TodoToday'

// Het blok Taken op de periodepagina van een werktrip: de weektaken (src/model/tasks.ts) met hun dag en of ze gedaan zijn.
// Het rondje vinkt af (of zet weer open); de regel opent het bericht of de taak.

const MessageSheet = lazyComponent(() => import('./MessageSheets').then((m) => m.MessageSheet))

export function TripTasks({ store, notify, trip, heading: Heading }: { store: Store; notify: Notify; trip: Trip; heading: 'h2' | 'h3' }) {
  const data = useTaskData(store)
  const live = data.trips.find((x) => x.id === trip.id) ?? trip
  const tasks = weekTasksOf(live, data)
  if (tasks.length === 0) return null
  const doneCount = tasks.filter((x) => x.done !== null).length
  return (
    <div className="section stack-sm trip-tasks">
      <Heading>
        {t('tasks.section')} <span className="muted small">{`${doneCount}/${tasks.length}`}</span>
      </Heading>
      <TaskRows store={store} notify={notify} tasks={tasks} />
    </div>
  )
}

/** De dagkaart in de agenda: de weektaken van die dag (van elke trip), met afvinken. */
export function DayTasks({ store, notify, date }: { store: Store; notify: Notify; date: string }) {
  const data = useTaskData(store)
  const counters = useCounters(store)
  const tasks = data.trips.flatMap((trip) => weekTasksOf(trip, data)).filter((x) => x.date === date)
  if (tasks.length === 0) return null
  return (
    <div className="section stack-sm trip-tasks">
      <h3>{t('tasks.section')}</h3>
      <TaskRows store={store} notify={notify} tasks={tasks} withTrip={(trip) => nameWithCounter(trip, counters.get(trip.id))} />
    </div>
  )
}

function TaskRows({ store, notify, tasks, withTrip }: { store: Store; notify: Notify; tasks: readonly WeekTask[]; withTrip?: (trip: Trip) => string }) {
  const [message, setMessage] = useState<WeekTask | null>(null)
  const [task, setTask] = useState<WeekTask | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  async function toggle(x: WeekTask) {
    if (busy || x.done === 'vanzelf') return
    setBusy(true)
    try {
      const undo = await taakMarkeren(store, x.trip.id, x.kind, x.done === null ? 'gedaan' : null, today)
      notify(x.done === null ? t('todo.markedDone') : t('tasks.reopen'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ul className="plain-list todo-list">
        {tasks.map((x) => {
          const title = t(`task.${x.kind}`)
          const status =
            x.done === null
              ? formatDate(x.date)
              : x.done === 'niet-nodig'
                ? t('tasks.notNeededOn', { date: formatDate(x.doneDate!) })
                : x.doneDate
                  ? t('tasks.doneOn', { date: formatDate(x.doneDate) })
                  : t('tasks.doneAuto')
          return (
            <li key={`${x.trip.id}-${x.kind}`} className="todo-row">
              <button
                type="button"
                className="todo-check"
                role="checkbox"
                aria-checked={x.done !== null}
                aria-label={title}
                disabled={busy || x.done === 'vanzelf'}
                onClick={() => void toggle(x)}
              >
                <Icon icon={x.done === null ? Circle : CircleCheck} />
              </button>
              <button type="button" className="todo-main" onClick={() => (isMessageTask(x.kind) ? setMessage(x) : setTask(x))}>
                <Icon icon={TASK_ICONS[x.kind]} />
                <span className={`row-main${x.done !== null ? ' muted' : ''}`}>
                  <span>{title}</span>
                  {withTrip && <span className="muted small">{withTrip(x.trip)}</span>}
                </span>
                <span className={`small todo-when${x.done !== null ? ' done' : isLate(x, today) ? ' negative' : ''}`}>{status}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <Suspense fallback={null}>
        {message && <MessageSheet store={store} notify={notify} trip={message.trip} kind={{ kind: message.kind }} onClose={() => setMessage(null)} />}
      </Suspense>
      {task && <TaskSheet store={store} notify={notify} task={task} tripName={task.trip.name} onClose={() => setTask(null)} />}
    </>
  )
}
