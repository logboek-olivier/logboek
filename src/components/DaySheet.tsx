import { Eye, EyeOff, NotebookPen, Route } from 'lucide-react'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDateRange, formatMoney, formatNm, formatWeekday } from '../format'
import { t } from '../i18n'
import { clearDay, dayInfo, setDay, type CalendarIndex } from '../model/calendar'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { logPlanned, plannedFor, plannedNm } from '../model/routes'
import { currentSettings } from '../model/settings'
import { DAY_TYPES, todayIso, type DayType } from '../model/types'
import type { AddInit } from '../screens/QuickAdd'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Dagblad: dagsoort als knoppen (één tik slaat op; "Automatisch" volgt weer de trips en dagen). Bij werk de trip, de
// boot (van de trip, per dag te overschrijven), "Zoals gepland" of "Dag loggen", nm en fooien (bedragen pas na
// "Toon bedragen": studenten kunnen meekijken); bij reis van, naar en vlucht; altijd een notitie.

export function DaySheet({ store, index, date, onClose, onAdd, notify }: { store: Store; index: CalendarIndex; date: string; onClose: () => void; onAdd: (init: AddInit) => void; notify: Notify }) {
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

  async function choose(next: DayType) {
    await setDay(store, date, next, details())
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
              </p>
            ))}
            <label>
              {t('day.boat')}
              <input type="text" autoComplete="off" maxLength={80} value={boat} placeholder={trip?.boat || info.legs.at(-1)?.boat || ''} onChange={(e) => setBoat(e.target.value)} />
            </label>
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
            <DayTips store={store} date={date} />
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
    </Sheet>
  )
}

/** Fooien van deze dag; bedragen pas na "Toon bedragen". */
function DayTips({ store, date }: { store: Store; date: string }) {
  const tips = useCollection(store, 'transactions.json.enc').filter((tx) => tx.deletedAt === null && tx.kind === 'fooi' && tx.date === date)
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  if (tips.length === 0) return <p className="muted small">{t('day.noTips')}</p>
  return (
    <div className="day-tips">
      <div className="section-head">
        <h3>{t('day.tips')}</h3>
        <button type="button" className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {shown ? (
        <ul className="day-tip-list">
          {tips.map((tx) => {
            const eur = eurValue(tx)
            return <li key={tx.id}>{eur ? formatMoney(eur.eur, 'EUR') : formatMoney(tx.amount, tx.currency)}</li>
          })}
        </ul>
      ) : (
        <p className="muted small">{t('week.amountsHidden', { n: tips.length })}</p>
      )}
    </div>
  )
}
