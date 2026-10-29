import { CalendarClock, FileText, Plane, Plus, KeyRound } from 'lucide-react'
import { Suspense, useState } from 'react'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { useIsDemo } from '../components/DemoBar'
import { lazyComponent } from '../lazy'
import { documentDueItems } from '../model/documents'
import { useCollection } from '../components/useCollection'
import { formatDate } from '../format'
import { t } from '../i18n'
import { doneReminders, dueItems, type DueItem } from '../model/reminders'
import { currentSettings } from '../model/settings'
import { todayIso, type Reminder } from '../model/types'
import { activeWeek, upcomingTrips } from '../model/weeks'
import { daysUntil, useSession } from '../session'
import type { Store } from '../storage/store'

// De bladen laden pas bij een tik (src/lazy.ts): de lijst staat ook op Vandaag.
const ReminderSheet = lazyComponent(() => import('../components/ReminderSheet').then((m) => m.ReminderSheet))
const ReminderView = lazyComponent(() => import('../components/Views').then((m) => m.ReminderView))

// Termijnen: deadlines en vervaldatums samen, met de token en de volgende trip erbij. Vandaag toont de eerstvolgende
// drie; onder Meer staan ze allemaal, ook de afgeronde.

/** Token en volgende trip als termijn, naast Oliviers eigen termijnen. */
export function useDueItems(store: Store): DueItem[] {
  const session = useSession()
  const reminders = useCollection(store, 'reminders.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const demo = useIsDemo()
  const extra: DueItem[] = []
  // De token hoort bij de eigen gegevens: in de demo niet tonen.
  if (session.tokenExpiresAt && !demo) extra.push({ title: t('expiry.token'), date: session.tokenExpiresAt, kind: 'vervalt', source: 'token' })
  const running = activeWeek(trips, settings)
  const next = upcomingTrips(trips).find((trip) => trip.id !== running?.id)
  if (next?.startDate) extra.push({ title: t('reminder.tripStart', { name: next.name }), date: next.startDate, kind: 'trip', source: 'trip' })
  // Kluis: documenten met een vervaldatum (niet in de demo, die heeft geen kluis).
  const documents = useCollection(store, 'documents/index.json.enc')
  if (!demo) extra.push(...documentDueItems(documents))
  return dueItems(reminders, extra)
}

/** "over 21 dagen", "vandaag", "3 dagen te laat" / "verlopen". */
export function dueLabel(item: Pick<DueItem, 'date' | 'kind'>, today = todayIso()): string {
  const days = daysUntil(item.date, today) ?? 0
  if (days === 0) return t('expiry.today')
  if (days > 0) return t('expiry.inDays', { n: days })
  return item.kind === 'deadline' ? t('reminder.late', { n: -days }) : t('expiry.expired')
}

export function DueList({ store, items, notify, onToken }: { store: Store; items: DueItem[]; notify: Notify; onToken?: () => void }) {
  const reminders = useCollection(store, 'reminders.json.enc')
  const [editing, setEditing] = useState<Reminder | null>(null)
  const today = todayIso()
  return (
    <>
      <ul className="rows due-list">
        {items.map((item) => {
          const days = daysUntil(item.date, today) ?? 0
          const icon = item.source === 'token' ? KeyRound : item.source === 'trip' ? Plane : item.source === 'document' ? FileText : CalendarClock
          const content = (
            <>
              <Icon icon={icon} />
              <span className="row-main">
                <span>{item.title}</span>
                <span className="muted small">
                  {[item.kind === 'trip' ? '' : t(`reminderKind.${item.kind}`), formatDate(item.date), item.repeat ? t(`reminderRepeat.${item.repeat}`) : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className={`row-value small${days < 0 ? ' negative' : days <= 7 ? ' warning' : ''}`}>{dueLabel(item, today)}</span>
            </>
          )
          const own = item.id ? reminders.find((r) => r.id === item.id) : undefined
          const onClick = own ? () => setEditing(own) : item.source === 'token' ? onToken : undefined
          return (
            <li key={item.id ?? `${item.source}-${item.date}`}>
              {onClick ? (
                <button className="row-button" onClick={onClick}>
                  {content}
                </button>
              ) : (
                <div className="row-item">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
      <Suspense fallback={null}>{editing && <ReminderView store={store} reminder={editing} notify={notify} onClose={() => setEditing(null)} />}</Suspense>
    </>
  )
}

/** Meer → Termijnen: alles open, eerstvolgende eerst, en de afgeronde. */
export function Deadlines({ store, notify, onToken }: { store: Store; notify: Notify; onToken: () => void }) {
  const items = useDueItems(store)
  const done = doneReminders(useCollection(store, 'reminders.json.enc'))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Reminder | null>(null)
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('reminder.screen')}</h1>
      </header>
      <button className="btn primary" onClick={() => setAdding(true)}>
        <Icon icon={Plus} />
        {t('reminder.new')}
      </button>
      {items.length === 0 ? <p className="muted">{t('reminder.empty')}</p> : <DueList store={store} items={items} notify={notify} onToken={onToken} />}
      {done.length > 0 && (
        <div className="section">
          <h2>{t('reminder.doneList')}</h2>
          <ul className="rows">
            {done.map((r) => (
              <li key={r.id}>
                <button className="row-button" onClick={() => setEditing(r)}>
                  <span className="row-main">
                    <span className="muted">{r.title}</span>
                    <span className="muted small">{t('reminder.doneOn', { date: formatDate(r.doneAt!) })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Suspense fallback={null}>{adding && <ReminderSheet store={store} reminder={null} notify={notify} onClose={() => setAdding(false)} />}</Suspense>
      <Suspense fallback={null}>{editing && <ReminderView store={store} reminder={editing} notify={notify} onClose={() => setEditing(null)} />}</Suspense>
    </section>
  )
}
