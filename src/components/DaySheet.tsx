import { CalendarClock, CalendarPlus, Eye, EyeOff, KeyRound, MoveHorizontal, NotebookPen, Plus, Route } from 'lucide-react'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDateRange, formatDateShort, formatHours, formatMoney, formatNm, formatWeekday } from '../format'
import { t, useLang } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { effectiveCurricula } from '../model/curricula'
import { blockItems, blocksOn, livePlans, slotLabel } from '../model/plans'
import { routeOf } from '../model/trip-route'
import { RouteMap } from './LazyMap'
import { boatLine } from './boat-line'
import { useCounters } from './useCounters'
import { ViewRows } from './Views'
import { clearDay, dayInfo, extendOptions, resizeTrip, setDay, shrinkFor, type CalendarIndex, type TripResize } from '../model/calendar'
import { kindLabel } from '../i18n/labels'
import { isEarned } from '../model/money'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { logPlanned, plannedFor, plannedNm } from '../model/routes'
import { currentSettings } from '../model/settings'
import { DAY_TYPES, todayIso, type DayType, type Reminder, type Trip } from '../model/types'
import { useDueItems } from '../screens/Deadlines'
import type { AddInit } from '../screens/QuickAdd'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Dagblad: dagsoort als knoppen (één tik slaat op; "Automatisch" volgt weer de trips en dagen). Bij werk de trip, de
// boot (van de trip, per dag te overschrijven), "Zoals gepland" of "Dag loggen", nm en inkomsten (bedragen pas na
// "Toon bedragen": studenten kunnen meekijken); bij reis van, naar en vlucht; altijd een notitie; de termijnen van de dag.
// Trip en agenda blijven gelijk: werk naast een trip biedt "verlengen", een andere dagsoort op de eerste of laatste dag
// maakt de trip een dag korter (met ongedaan maken).

export function DaySheet({
  store,
  index,
  date,
  onClose,
  onAdd,
  onReminder,
  onEditTrip,
  notify,
}: {
  store: Store
  index: CalendarIndex
  date: string
  onClose: () => void
  onAdd: (init: AddInit) => void
  /** Termijn bewerken (of null = nieuwe termijn op deze dag); het dagblad sluit dan. */
  onReminder: (reminder: Reminder | null) => void
  /** Trip bewerken (alle velden, ook verwijderen); het dagblad sluit dan. */
  onEditTrip?: (trip: Trip) => void
  notify: Notify
}) {
  const today = todayIso()
  const info = dayInfo(index, date, today)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const legs = useCollection(store, 'legs.json.enc')
  const own = info.own
  const [location, setLocation] = useState(own?.location ?? '')
  const [boat, setBoat] = useState(own?.boat ?? '')
  const [from, setFrom] = useState(own?.travel?.from ?? '')
  const [to, setTo] = useState(own?.travel?.to ?? '')
  const [flight, setFlight] = useState(own?.travel?.flight ?? '')
  const [note, setNote] = useState(own?.note ?? '')
  const type = info.type
  const trip = info.trips.at(-1) ?? null
  const planned = trip && !info.legs.length ? plannedFor(trip.trip, legs, date) : null
  const plannedDistance = planned ? plannedNm(legs, planned) : null

  const details = () => ({ location, boat, note, travel: { from, to, flight } })
  const extend = type === 'werk' && info.trips.length === 0 ? extendOptions(index, date, date) : []
  const reminders = store.list('reminders.json.enc')
  const due = useDueItems(store).filter((item) => item.date.slice(0, 10) === date && item.source !== 'trip')

  async function choose(next: DayType) {
    const shrink = shrinkFor(index, date, next)
    if (!shrink) {
      await setDay(store, date, next, details())
      return
    }
    // De eerste of laatste dag van een trip is altijd werk: een andere dagsoort maakt de trip een dag korter.
    const before = own
    const undoResize = await resizeTrip(store, shrink)
    await setDay(store, date, next, details())
    notify(resized(shrink), async () => {
      await undoResize()
      if (before) await store.put('calendar.json.enc', { ...before, updatedAt: new Date().toISOString() })
      else await clearDay(store, date)
    })
  }

  async function extendTrip(option: TripResize) {
    const undo = await resizeTrip(store, option)
    notify(resized(option), undo)
    onClose()
  }

  async function automatic() {
    await clearDay(store, date)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!type) return
    await setDay(store, date, type, details())
    notify(t('toast.daySaved'))
    onClose()
  }

  async function logAsPlanned() {
    if (!trip || !planned) return
    await logPlanned(store, trip.trip, planned, date, settings)
    notify(t('toast.daySaved'))
    onClose()
  }

  return (
    <Sheet title={date.slice(0, 4) === today.slice(0, 4) ? formatWeekday(date) : `${formatWeekday(date)} ${date.slice(0, 4)}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <div>
          <div className="type-buttons day-types" role="radiogroup" aria-label={t('day.kind')}>
            {DAY_TYPES.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={type === d} className={`chip day-chip day-${d}${type === d ? ' active' : ''}`} onClick={() => void choose(d)}>
                {t(`dayType.${d}`)}
              </button>
            ))}
          </div>
          <p className="muted small day-source">
            {t(`day.source.${info.source ?? 'leeg'}`)}
            {own && (
              <>
                {' · '}
                <button type="button" className="btn link small inline" onClick={() => void automatic()}>
                  {t('day.auto')}
                </button>
              </>
            )}
          </p>
        </div>

        {type === 'werk' && (
          <div className="stack-sm">
            {info.trips.map((v) => (
              <p key={v.trip.id} className="day-trip">
                <strong>{v.trip.name}</strong>
                <span className="muted small"> · {formatDateRange(v.startDate, v.endDate)}</span>
                {onEditTrip && (
                  <>
                    {' '}
                    <button type="button" className="btn link small inline" onClick={() => onEditTrip(v.trip)}>
                      {t('day.editTrip', { name: v.trip.name })}
                    </button>
                  </>
                )}
              </p>
            ))}
            <label>
              {t('day.boat')}
              <input type="text" autoComplete="off" maxLength={80} value={boat} placeholder={trip?.boat || info.legs.at(-1)?.boat || ''} onChange={(e) => setBoat(e.target.value)} />
            </label>
            {extend.map((option) => (
              <button key={option.view.trip.id} type="button" className="btn" onClick={() => void extendTrip(option)}>
                <Icon icon={MoveHorizontal} />
                {option.end === date ? t('day.extend', { name: option.view.trip.name, date: formatDateShort(date) }) : t('day.extendEarlier', { name: option.view.trip.name, date: formatDateShort(date) })}
              </button>
            ))}
            {info.nm > 0 && <p className="day-nm">{formatNm(info.nm)}</p>}
            {planned && trip ? (
              <button type="button" className="btn primary" onClick={() => void logAsPlanned()}>
                <Icon icon={Route} />
                {t('route.asPlanned')}
                {plannedDistance !== null ? ` · ${formatNm(plannedDistance)}` : ''}
              </button>
            ) : (
              <button type="button" className={`btn${info.legs.length ? '' : ' primary'}`} onClick={() => onAdd({ date, ...(trip ? { tripId: trip.trip.id } : {}) })}>
                <Icon icon={NotebookPen} />
                {t('day.log')}
              </button>
            )}
            <DayIncome store={store} date={date} />
          </div>
        )}

        {type === 'reis' && (
          <div className="two">
            <label>
              {t('day.from')}
              <input type="text" autoComplete="off" maxLength={80} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              {t('day.to')}
              <input type="text" autoComplete="off" maxLength={80} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label>
              {t('day.flight')}
              <input type="text" autoComplete="off" maxLength={40} value={flight} onChange={(e) => setFlight(e.target.value)} />
            </label>
          </div>
        )}

        {type !== null && type !== 'werk' && type !== 'reis' && (
          <label>
            {t('day.location')}
            <input type="text" autoComplete="off" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        )}

        {type !== null && (
          <>
            <label>
              {t('field.note')}
              <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn primary" type="submit">
              {t('common.save')}
            </button>
          </>
        )}
      </form>
      <div className="day-reminders">
        {due.length > 0 && (
          <>
            <h3>{t('day.reminders')}</h3>
            <ul className="rows">
              {due.map((item) => {
                const reminder = item.id ? reminders.find((r) => r.id === item.id) : undefined
                const content = (
                  <>
                    <Icon icon={item.source === 'token' ? KeyRound : CalendarClock} />
                    <span className="row-main">
                      <span>{item.title}</span>
                      <span className="muted small">{t(item.kind === 'trip' ? 'reminderKind.deadline' : `reminderKind.${item.kind}`)}</span>
                    </span>
                  </>
                )
                return (
                  <li key={item.id ?? item.source}>
                    {reminder ? (
                      <button type="button" className="row-item" onClick={() => onReminder(reminder)}>
                        {content}
                      </button>
                    ) : (
                      <div className="row-item">{content}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <button type="button" className="btn small" onClick={() => onReminder(null)}>
          <Icon icon={due.length > 0 ? Plus : CalendarPlus} />
          {t('reminder.new')}
        </button>
      </div>
    </Sheet>
  )
}

function resized(change: TripResize): string {
  return t('day.tripResized', { name: change.view.trip.name, range: formatDateRange(change.start, change.end) })
}

/** Inkomsten van deze dag (fooi, loon, bonus, overig; geen terugbetalingen); bedragen pas na "Toon bedragen". */
function DayIncome({ store, date }: { store: Store; date: string }) {
  const income = useCollection(store, 'transactions.json.enc').filter((tx) => tx.deletedAt === null && isEarned(tx.kind) && tx.date === date)
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  if (income.length === 0) return <p className="muted small">{t('day.noIncome')}</p>
  return (
    <div className="day-tips">
      <div className="section-head">
        <h3>{t('day.income')}</h3>
        <button type="button" className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {shown ? (
        <ul className="day-tip-list">
          {income.map((tx) => {
            const eur = eurValue(tx)
            return (
              <li key={tx.id}>
                {kindLabel(tx.kind)} · {eur ? formatMoney(eur.eur, 'EUR') : formatMoney(tx.amount, tx.currency)}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="muted small">{t('day.amountsHidden', { n: income.length })}</p>
      )}
    </div>
  )
}

/**
 * Dagkaart (tik op een dag in de agenda): eerst bekijken wat er die dag is. Dagsoort, trip met teller, boot, de route
 * van die dag op een kleine kaart, nm, nachturen, wind, notitie, planningsthema's, termijnen en of er fooi was (bedragen
 * pas na "Toon bedragen"). Bewerken (dagsoort, boot, plaats, notitie, verlengen) via het potlood; loggen en een termijn
 * toevoegen kan direct.
 */
export function DayView({
  store,
  index,
  date,
  onClose,
  onAdd,
  onReminder,
  onEditTrip,
  onOpenTrip,
  notify,
}: {
  store: Store
  index: CalendarIndex
  date: string
  onClose: () => void
  onAdd: (init: AddInit) => void
  onReminder: (reminder: Reminder | null) => void
  onEditTrip?: (trip: Trip) => void
  /** Tripoverzicht openen (de dagkaart sluit dan). */
  onOpenTrip?: (trip: Trip) => void
  notify: Notify
}) {
  const lang = useLang()
  const [editing, setEditing] = useState(false)
  const today = todayIso()
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const plans = useCollection(store, 'plans.json.enc')
  const curricula = effectiveCurricula(useCollection(store, 'curricula.json.enc'))
  const counters = useCounters(store)
  const reminders = store.list('reminders.json.enc')
  const due = useDueItems(store).filter((item) => item.date.slice(0, 10) === date && item.source !== 'trip')
  if (editing) return <DaySheet store={store} index={index} date={date} onClose={onClose} onAdd={onAdd} onReminder={onReminder} onEditTrip={onEditTrip} notify={notify} />
  const info = dayInfo(index, date, today)
  const own = info.own
  const trip = info.trips.at(-1) ?? null
  const dayLegs = info.legs
  const route = routeOf(dayLegs, places)
  const planned = trip && !dayLegs.length ? plannedFor(trip.trip, legs, date) : null
  const plannedDistance = planned ? plannedNm(legs, planned) : null
  const night = dayLegs.reduce((n, l) => n + l.nightHours, 0)
  const wind = [...new Set(dayLegs.map((l) => l.windBft?.trim()).filter((w): w is string => !!w))].join(', ')
  const boat = own?.boat || (trip ? boatLine(trip.trip, dayLegs.at(-1)?.boat) : dayLegs.at(-1)?.boat) || ''
  const themes = livePlans(plans).flatMap((p) => blocksOn(p, date).flatMap((b) => blockItems(b, curricula, lang).map((item) => ({ key: `${p.id}|${b.id}|${item.id}`, slot: b.slot, title: item.title }))))
  const notes = [own?.note, ...dayLegs.map((l) => l.notes)].filter((n): n is string => !!n && !!n.trim())

  async function logAsPlanned() {
    if (!trip || !planned) return
    await logPlanned(store, trip.trip, planned, date, settings)
    notify(t('toast.daySaved'))
    onClose()
  }

  return (
    <Sheet title={date.slice(0, 4) === today.slice(0, 4) ? formatWeekday(date) : `${formatWeekday(date)} ${date.slice(0, 4)}`} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view day-view">
        <p className="day-view-type">
          {info.type ? <span className={`chip-static day-chip day-${info.type}`}>{t(`dayType.${info.type}`)}</span> : <span className="muted">{t('dayType.leeg')}</span>}
          <span className="muted small"> {t(`day.source.${info.source ?? 'leeg'}`)}</span>
        </p>
        {info.trips.map((v) => (
          <button key={v.trip.id} type="button" className="row-button day-view-trip" onClick={() => onOpenTrip?.(v.trip)} disabled={!onOpenTrip}>
            <span className="row-main">
              <span className="row-title">{nameWithCounter(v.trip, counters.get(v.trip.id))}</span>
              <span className="muted small">{formatDateRange(v.startDate, v.endDate)}</span>
            </span>
          </button>
        ))}
        <RouteMap route={route} small />
        {route.unpinned.length > 0 && route.stops.length > 0 && <p className="muted small">{t('day.unpinned', { names: route.unpinned.join(', ') })}</p>}
        <ViewRows
          rows={[
            [t('day.route'), dayLegs.length > 0 && dayLegs.map((l) => [l.fromPlace, l.toPlace].filter(Boolean).join(' → ')).join(' · ')],
            [t('day.boat'), boat],
            [t('week.nm'), info.nm > 0 && formatNm(info.nm)],
            [t('field.nightHours'), night > 0 && formatHours(night)],
            [t('field.wind'), wind],
            [t('day.travel'), info.type === 'reis' && [own?.travel?.from, own?.travel?.to].filter(Boolean).join(' → ') + (own?.travel?.flight ? ` · ${own.travel.flight}` : '')],
            [t('day.location'), own?.location],
            [t('field.note'), notes.join(' · ')],
          ]}
        />
        {themes.length > 0 && (
          <div className="stack-sm">
            <h3>{t('day.planning')}</h3>
            <ul className="rows">
              {themes.map((th) => (
                <li key={th.key} className="row-item">
                  <span className="muted small">{slotLabel(th.slot, lang)}</span>
                  <span className="row-main">{th.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DayTips store={store} date={date} />
        {info.type === 'werk' && (planned && trip ? (
          <button type="button" className="btn primary" onClick={() => void logAsPlanned()}>
            <Icon icon={Route} />
            {t('route.asPlanned')}
            {plannedDistance !== null ? ` · ${formatNm(plannedDistance)}` : ''}
          </button>
        ) : (
          <button type="button" className={`btn${dayLegs.length ? '' : ' primary'}`} onClick={() => onAdd({ date, ...(trip ? { tripId: trip.trip.id } : {}) })}>
            <Icon icon={NotebookPen} />
            {t('day.log')}
          </button>
        ))}
        <div className="day-reminders">
          {due.length > 0 && (
            <>
              <h3>{t('day.reminders')}</h3>
              <ul className="rows">
                {due.map((item) => {
                  const reminder = item.id ? reminders.find((r) => r.id === item.id) : undefined
                  const content = (
                    <>
                      <Icon icon={item.source === 'token' ? KeyRound : CalendarClock} />
                      <span className="row-main">
                        <span>{item.title}</span>
                        <span className="muted small">{t(item.kind === 'trip' ? 'reminderKind.deadline' : `reminderKind.${item.kind}`)}</span>
                      </span>
                    </>
                  )
                  return (
                    <li key={item.id ?? item.source}>
                      {reminder ? (
                        <button type="button" className="row-item" onClick={() => onReminder(reminder)}>
                          {content}
                        </button>
                      ) : (
                        <div className="row-item">{content}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <button type="button" className="btn small" onClick={() => onReminder(null)}>
            <Icon icon={due.length > 0 ? Plus : CalendarPlus} />
            {t('reminder.new')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Was er fooi op deze dag? Ja of nee; de bedragen pas na "Toon bedragen". */
function DayTips({ store, date }: { store: Store; date: string }) {
  const tips = useCollection(store, 'transactions.json.enc').filter((tx) => tx.deletedAt === null && tx.kind === 'fooi' && tx.date === date)
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  return (
    <div className="day-tips">
      <div className="section-head">
        <p className="small">{tips.length > 0 ? t('day.tipYes', { n: tips.length }) : t('day.tipNo')}</p>
        {tips.length > 0 && (
          <button type="button" className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
            <Icon icon={shown ? EyeOff : Eye} />
            {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
          </button>
        )}
      </div>
      {shown && (
        <ul className="day-tip-list">
          {tips.map((tx) => {
            const eur = eurValue(tx)
            return <li key={tx.id}>{eur ? formatMoney(eur.eur, 'EUR') : formatMoney(tx.amount, tx.currency)}</li>
          })}
        </ul>
      )}
    </div>
  )
}
