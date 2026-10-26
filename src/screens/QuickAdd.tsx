import { Coins, Receipt, Sailboat } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { kindLabel, roleLabel, sourceLabel } from '../i18n/labels'
import { useCollection } from '../components/useCollection'
import { defaultTripName } from '../import/mileage-csv'
import { active, compareLegs, summarizeTrips, tripForDate } from '../model/derive'
import { addDays, parseAmount } from '../model/money'
import { currentSettings, saveSettings } from '../model/settings'
import {
  CURRENCIES,
  newId,
  nowIso,
  ROLES,
  todayIso,
  TRANSACTION_SOURCES,
  type AddTab,
  type Currency,
  type Settings,
  type Water,
  type Leg,
  type Role,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
  type Trip,
} from '../model/types'
import type { Store } from '../storage/store'
import { t } from '../i18n'

// Snel toevoegen: Dag · Fooi · Kosten, opent op Dag. Bij Dag staan alle velden in beeld, voorgevuld met de vorige
// bestemming en de laatst gebruikte boot, rol en week; alleen naar en nm zijn nodig. Opslaan = één tik.

/** Korte trilling als bevestiging van opslaan; stil als het apparaat het niet kan. */
function confirmVibration() {
  try {
    navigator.vibrate?.(30)
  } catch {
    // Niet beschikbaar.
  }
}

export function QuickAdd({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const [tab, setTab] = useState<AddTab>('dag')
  const choose = (next: AddTab) => setTab(next)
  return (
    <section className="stack">
      <header className="page-header">
        <h1>{t('nav.add')}</h1>
      </header>
      <div className="segments" role="tablist">
        {(['dag', 'fooi', 'kosten'] as AddTab[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`segment${tab === id ? ' active' : ''}`}
            onClick={() => choose(id)}
          >
            <Icon icon={id === 'fooi' ? Coins : id === 'kosten' ? Receipt : Sailboat} />
            {t(id === 'fooi' ? 'quick.tabTip' : id === 'kosten' ? 'quick.tabCost' : 'quick.tabDay')}
          </button>
        ))}
      </div>
      {tab === 'dag' && <DayForm store={store} onDone={onDone} />}
      {tab === 'fooi' && <IncomeForm store={store} onDone={onDone} />}
      {tab === 'kosten' && <CostForm store={store} onDone={onDone} />}
    </section>
  )
}

function useDefaults(store: Store) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  return { settings, trips, legs }
}

async function saveTransaction(
  store: Store,
  tx: Omit<Transaction, 'id' | 'updatedAt' | 'deletedAt' | 'tripId' | 'amountEur'>,
  remember: Partial<Pick<Settings, 'lastIncomeKind' | 'lastCostKind'>>,
) {
  const trip = tripForDate(store.get('trips.json.enc'), store.get('legs.json.enc'), tx.date)
  const record: Transaction = { ...tx, id: newId(), updatedAt: nowIso(), deletedAt: null }
  if (trip) record.tripId = trip.id
  if (tx.currency === 'EUR') record.amountEur = tx.amount
  await store.put('transactions.json.enc', record)
  await saveSettings(store, { lastCurrency: tx.currency, lastSource: tx.source, ...remember })
  confirmVibration()
  void store.sync()
}

function IncomeForm({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const { settings } = useDefaults(store)
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<TransactionKind>(settings.lastIncomeKind ?? 'fooi')
  const [source, setSource] = useState<TransactionSource>(settings.lastSource)
  const [currency, setCurrency] = useState<Currency>(settings.lastCurrency)
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || busy) return
    setBusy(true)
    try {
      await saveTransaction(store, { date, kind, amount: parsed, currency, source }, { lastIncomeKind: kind === 'loon' ? 'loon' : 'fooi' })
      onDone(t('toast.kindSaved', { kind: kindLabel(kind) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        {t('field.amount')}
        <input
          className="amount"
          inputMode="decimal"
          autoFocus
          enterKeyHint="done"
          autoComplete="off"
          placeholder={t('quick.amountPlaceholder')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <div className="segments small" role="radiogroup" aria-label={t('field.kind')}>
        {(['fooi', 'loon'] as TransactionKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`segment${kind === k ? ' active' : ''}`}
            onClick={() => setKind(k)}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <div className="two">
        <label>
          {t('field.source')}
          <select value={source} onChange={(e) => setSource(e.target.value as TransactionSource)}>
            {TRANSACTION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('field.currency')}
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t('field.date')}
        <input type="date" value={date} max={addDays(todayIso(), 1)} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
        {t('common.save')}
      </button>
    </form>
  )
}

function CostForm({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const { settings } = useDefaults(store)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState<TransactionKind>(settings.lastCostKind ?? 'kosten')
  const [more, setMore] = useState(false)
  const [source, setSource] = useState<TransactionSource>(settings.lastSource)
  const [currency, setCurrency] = useState<Currency>(settings.lastCurrency)
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || busy) return
    setBusy(true)
    try {
      await saveTransaction(
        store,
        { date, kind, amount: parsed, currency, source, ...(note.trim() ? { note: note.trim() } : {}) },
        { lastCostKind: kind === 'investering' ? 'investering' : 'kosten' },
      )
      onDone(t('toast.kindSaved', { kind: kindLabel(kind) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        {t('field.amount')}
        <input
          className="amount"
          inputMode="decimal"
          autoFocus
          enterKeyHint="done"
          autoComplete="off"
          placeholder={t('quick.amountPlaceholder')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        {t('field.description')}
        <input type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="segments small" role="radiogroup" aria-label={t('field.kind')}>
        {(['kosten', 'investering'] as TransactionKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`segment${kind === k ? ' active' : ''}`}
            onClick={() => setKind(k)}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>
      {!more && (
        <p className="muted">
          {sourceLabel(source)} · {currency} · {t('quick.today')}{' '}
          <button type="button" className="btn link inline" onClick={() => setMore(true)}>
            {t('common.more')}
          </button>
        </p>
      )}
      {more && (
        <>
          <div className="two">
            <label>
              {t('field.source')}
              <select value={source} onChange={(e) => setSource(e.target.value as TransactionSource)}>
                {TRANSACTION_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('field.currency')}
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t('field.date')}
            <input type="date" value={date} max={addDays(todayIso(), 1)} onChange={(e) => setDate(e.target.value)} />
          </label>
        </>
      )}
      <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
        {t('common.save')}
      </button>
    </form>
  )
}

function waterOf(leg: Leg | undefined): Water {
  if (!leg) return 'zee'
  if (leg.nmTidal > 0) return 'getij'
  if (leg.nmInland > 0 && leg.nmSea === 0) return 'binnen'
  return 'zee'
}

function DayForm({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const { settings, trips, legs } = useDefaults(store)
  const today = todayIso()
  const lastLeg = useMemo(() => [...active(legs)].sort(compareLegs).at(-1), [legs])
  // Weken om uit te kiezen: nieuwste eerst (op laatste dag), daarna weken zonder dagen.
  const weeks = useMemo(() => {
    const withDays = summarizeTrips(trips, legs).map((s) => s.trip)
    const empty = active(trips).filter((trip) => !withDays.some((w) => w.id === trip.id))
    return [...empty, ...withDays].slice(0, 12)
  }, [trips, legs])
  const lastTrip = useMemo(() => {
    const id = lastLeg?.tripId ?? settings.lastTripId
    return active(trips).find((trip) => trip.id === id)
  }, [trips, lastLeg, settings.lastTripId])
  // Dezelfde week als de vorige dag kort geleden was; anders begint een nieuwe week.
  const sameTripDefault = !!lastTrip && !!lastLeg && lastLeg.date >= addDays(today, -3)

  const [date, setDate] = useState(today)
  const [fromPlace, setFromPlace] = useState(lastLeg?.toPlace ?? '')
  const [toPlace, setToPlace] = useState('')
  const [nm, setNm] = useState('')
  const [water, setWater] = useState<Water>(settings.lastWater ?? waterOf(lastLeg))
  const [nightHours, setNightHours] = useState('')
  const [wind, setWind] = useState('')
  const [boat, setBoat] = useState(settings.lastBoat || lastLeg?.boat || '')
  const [role, setRole] = useState<Role>(settings.lastRole)
  const [tripId, setTripId] = useState<string>(sameTripDefault && lastTrip ? lastTrip.id : NEW_WEEK)
  const [tripName, setTripName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const nmValue = parseAmount(nm)
  const night = nightHours.trim() === '' ? 0 : parseAmount(nightHours)
  // Alleen "naar" en nm zijn nodig; boot, rol en week zijn altijd voorgevuld en blokkeren nooit.
  const ok = toPlace.trim() !== '' && nmValue !== null && night !== null && !!date

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      const now = nowIso()
      let id = tripId === NEW_WEEK ? undefined : tripId
      if (!id) {
        const trip: Trip = {
          id: newId(),
          name: tripName.trim() || defaultTripName(boat.trim(), date),
          updatedAt: now,
          deletedAt: null,
        }
        await store.put('trips.json.enc', trip)
        id = trip.id
      }
      // Landen: niet in beeld; van = land van de vorige bestemming, naar = hetzelfde land.
      const country = lastLeg?.toCountry ?? ''
      const leg: Leg = {
        id: newId(),
        tripId: id,
        date,
        fromPlace: fromPlace.trim(),
        fromCountry: country,
        toPlace: toPlace.trim(),
        toCountry: country,
        role,
        boat: boat.trim(),
        nmInland: water === 'binnen' ? nmValue : 0,
        nmSea: water === 'zee' ? nmValue : 0,
        nmTidal: water === 'getij' ? nmValue : 0,
        nightHours: night,
        dateEstimated: false,
        source: 'manual',
        updatedAt: now,
        deletedAt: null,
      }
      if (wind.trim()) leg.windBft = wind.trim()
      if (notes.trim()) leg.notes = notes.trim()
      await store.put('legs.json.enc', leg)
      await saveSettings(store, { ...(boat.trim() ? { lastBoat: boat.trim() } : {}), lastRole: role, lastTripId: id, lastWater: water })
      confirmVibration()
      void store.sync()
      onDone(t('toast.daySaved'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack day-form" onSubmit={(e) => void submit(e)}>
      <div className="two">
        <label>
          {t('field.date')}
          <input type="date" value={date} max={addDays(today, 1)} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          {t('field.from')}
          <input type="text" autoComplete="off" value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} />
        </label>
      </div>
      <div className="two">
        <label>
          {t('field.to')}
          <input type="text" autoFocus autoComplete="off" value={toPlace} onChange={(e) => setToPlace(e.target.value)} />
        </label>
        <label>
          {t('field.nm')}
          <input inputMode="decimal" autoComplete="off" placeholder="0" value={nm} onChange={(e) => setNm(e.target.value)} />
        </label>
      </div>
      <div className="segments small" role="radiogroup" aria-label={t('field.water')}>
        {(['zee', 'getij', 'binnen'] as Water[]).map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={water === w}
            className={`segment${water === w ? ' active' : ''}`}
            onClick={() => setWater(w)}
          >
            {t(w === 'zee' ? 'water.seaTab' : w === 'getij' ? 'water.tidalTab' : 'water.inlandTab')}
          </button>
        ))}
      </div>
      <div className="two">
        <label>
          {t('field.nightHours')}
          <input inputMode="decimal" autoComplete="off" placeholder="0" value={nightHours} onChange={(e) => setNightHours(e.target.value)} />
        </label>
        <label>
          {t('field.wind')}
          <input type="text" autoComplete="off" placeholder="3-4" value={wind} onChange={(e) => setWind(e.target.value)} />
        </label>
      </div>
      <div className="two">
        <label>
          {t('field.boat')}
          <input type="text" autoComplete="off" value={boat} onChange={(e) => setBoat(e.target.value)} />
        </label>
        <label>
          {t('field.role')}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t('field.week')}
        <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
          <option value={NEW_WEEK}>{t('quick.newWeek')}</option>
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      {tripId === NEW_WEEK && (
        <label>
          {t('field.weekName')}
          <input
            type="text"
            autoComplete="off"
            placeholder={defaultTripName(boat.trim() || t('field.boat'), date)}
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
          />
        </label>
      )}
      <label>
        {t('field.note')}
        <input type="text" autoComplete="off" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="btn primary" type="submit" disabled={!ok || busy}>
        {t('common.save')}
      </button>
    </form>
  )
}

const NEW_WEEK = '__nieuw__'
