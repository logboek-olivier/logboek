import { Coins, Receipt, Sailboat } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { defaultTripName } from '../import/mileage-csv'
import { active, compareLegs, tripForDate } from '../model/derive'
import { addDays, parseAmount } from '../model/money'
import { currentSettings, saveSettings } from '../model/settings'
import {
  CURRENCIES,
  KIND_LABELS,
  newId,
  nowIso,
  ROLE_LABELS,
  ROLES,
  SOURCE_LABELS,
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

// Snel toevoegen: Fooi · Kosten · Dag. Maximaal drie velden, de rest laatst gebruikt. Opslaan = één tik.

/** Korte trilling als bevestiging van opslaan; stil als het apparaat het niet kan. */
function confirmVibration() {
  try {
    navigator.vibrate?.(30)
  } catch {
    // Niet beschikbaar.
  }
}

export function QuickAdd({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const [tab, setTab] = useState<AddTab>('fooi')
  const choose = (t: AddTab) => setTab(t)
  return (
    <section className="stack">
      <header className="page-header">
        <h1>Toevoegen</h1>
      </header>
      <div className="segments" role="tablist">
        {(['fooi', 'kosten', 'dag'] as AddTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`segment${tab === t ? ' active' : ''}`}
            onClick={() => choose(t)}
          >
            <Icon icon={t === 'fooi' ? Coins : t === 'kosten' ? Receipt : Sailboat} />
            {t === 'fooi' ? 'Fooi' : t === 'kosten' ? 'Kosten' : 'Dag'}
          </button>
        ))}
      </div>
      {tab === 'fooi' && <IncomeForm store={store} onDone={onDone} />}
      {tab === 'kosten' && <CostForm store={store} onDone={onDone} />}
      {tab === 'dag' && <DayForm store={store} onDone={onDone} />}
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
      onDone(`${KIND_LABELS[kind]} opgeslagen`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Bedrag
        <input
          className="amount"
          inputMode="decimal"
          autoFocus
          enterKeyHint="done"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <div className="segments small" role="radiogroup" aria-label="Soort">
        {(['fooi', 'loon'] as TransactionKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`segment${kind === k ? ' active' : ''}`}
            onClick={() => setKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="two">
        <label>
          Bron
          <select value={source} onChange={(e) => setSource(e.target.value as TransactionSource)}>
            {TRANSACTION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Valuta
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
        Datum
        <input type="date" value={date} max={addDays(todayIso(), 1)} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
        Opslaan
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
      onDone(`${KIND_LABELS[kind]} opgeslagen`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Bedrag
        <input
          className="amount"
          inputMode="decimal"
          autoFocus
          enterKeyHint="done"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Omschrijving
        <input type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="segments small" role="radiogroup" aria-label="Soort">
        {(['kosten', 'investering'] as TransactionKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`segment${kind === k ? ' active' : ''}`}
            onClick={() => setKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {!more && (
        <p className="muted">
          {SOURCE_LABELS[source]} · {currency} · vandaag{' '}
          <button type="button" className="btn link inline" onClick={() => setMore(true)}>
            Meer
          </button>
        </p>
      )}
      {more && (
        <>
          <div className="two">
            <label>
              Bron
              <select value={source} onChange={(e) => setSource(e.target.value as TransactionSource)}>
                {TRANSACTION_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Valuta
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
            Datum
            <input type="date" value={date} max={addDays(todayIso(), 1)} onChange={(e) => setDate(e.target.value)} />
          </label>
        </>
      )}
      <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
        Opslaan
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
  const lastTrip = useMemo(() => {
    const id = lastLeg?.tripId ?? settings.lastTripId
    return active(trips).find((t) => t.id === id)
  }, [trips, lastLeg, settings.lastTripId])
  // Dezelfde tocht als de vorige dag kort geleden was; anders begint een nieuwe tocht.
  const sameTripDefault = !!lastTrip && !!lastLeg && lastLeg.date >= addDays(today, -3)

  const [toPlace, setToPlace] = useState('')
  const [nm, setNm] = useState('')
  const [water, setWater] = useState<Water>(settings.lastWater ?? waterOf(lastLeg))
  const [more, setMore] = useState(false)
  const [date, setDate] = useState(today)
  const [fromPlace, setFromPlace] = useState(lastLeg?.toPlace ?? '')
  const [fromCountry, setFromCountry] = useState(lastLeg?.toCountry ?? '')
  const [toCountry, setToCountry] = useState(lastLeg?.toCountry ?? '')
  const [boat, setBoat] = useState(settings.lastBoat || lastLeg?.boat || '')
  const [role, setRole] = useState<Role>(settings.lastRole)
  const [nightHours, setNightHours] = useState('')
  const [wind, setWind] = useState('')
  const [newTrip, setNewTrip] = useState(!sameTripDefault)
  const [tripName, setTripName] = useState('')
  const [busy, setBusy] = useState(false)

  const nmValue = parseAmount(nm)
  const night = nightHours.trim() === '' ? 0 : parseAmount(nightHours)
  const ok = toPlace.trim() !== '' && nmValue !== null && boat.trim() !== '' && night !== null && !!date

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      const now = nowIso()
      let tripId = lastTrip?.id
      if (newTrip || !tripId) {
        const trip: Trip = {
          id: newId(),
          name: tripName.trim() || defaultTripName(boat.trim(), date),
          updatedAt: now,
          deletedAt: null,
        }
        await store.put('trips.json.enc', trip)
        tripId = trip.id
      }
      const leg: Leg = {
        id: newId(),
        tripId,
        date,
        fromPlace: fromPlace.trim(),
        fromCountry: fromCountry.trim(),
        toPlace: toPlace.trim(),
        toCountry: toCountry.trim(),
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
      await store.put('legs.json.enc', leg)
      await saveSettings(store, { lastBoat: boat.trim(), lastRole: role, lastTripId: tripId, lastWater: water })
      confirmVibration()
      void store.sync()
      onDone('Dag opgeslagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Naar (plaats)
        <input type="text" autoFocus autoComplete="off" value={toPlace} onChange={(e) => setToPlace(e.target.value)} />
      </label>
      <label>
        Zeemijlen
        <input className="amount" inputMode="decimal" autoComplete="off" placeholder="0" value={nm} onChange={(e) => setNm(e.target.value)} />
      </label>
      <div className="segments small" role="radiogroup" aria-label="Watertype">
        {(['zee', 'getij', 'binnen'] as Water[]).map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={water === w}
            className={`segment${water === w ? ' active' : ''}`}
            onClick={() => setWater(w)}
          >
            {w === 'zee' ? 'Zee' : w === 'getij' ? 'Getij' : 'Binnen'}
          </button>
        ))}
      </div>
      {!more && (
        <p className="muted">
          {fromPlace ? `Van ${fromPlace} · ` : ''}
          {boat || 'geen boot'} · {ROLE_LABELS[role]} ·{' '}
          {newTrip ? 'nieuwe tocht' : `tocht ${lastTrip?.name ?? ''}`}{' '}
          <button type="button" className="btn link inline" onClick={() => setMore(true)}>
            Meer
          </button>
        </p>
      )}
      {more && (
        <>
          <label>
            Datum
            <input type="date" value={date} max={addDays(today, 1)} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="two">
            <label>
              Van (plaats)
              <input type="text" autoComplete="off" value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} />
            </label>
            <label>
              Van (land)
              <input type="text" autoComplete="off" value={fromCountry} onChange={(e) => setFromCountry(e.target.value)} />
            </label>
          </div>
          <label>
            Naar (land)
            <input type="text" autoComplete="off" value={toCountry} onChange={(e) => setToCountry(e.target.value)} />
          </label>
          <div className="two">
            <label>
              Boot
              <input type="text" autoComplete="off" value={boat} onChange={(e) => setBoat(e.target.value)} />
            </label>
            <label>
              Rol
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two">
            <label>
              Nachturen
              <input inputMode="decimal" autoComplete="off" value={nightHours} onChange={(e) => setNightHours(e.target.value)} />
            </label>
            <label>
              Wind (bft)
              <input type="text" autoComplete="off" placeholder="3-4" value={wind} onChange={(e) => setWind(e.target.value)} />
            </label>
          </div>
          {lastTrip && (
            <label className="check">
              <input type="checkbox" checked={newTrip} onChange={(e) => setNewTrip(e.target.checked)} />
              Nieuwe tocht (anders bij "{lastTrip.name}")
            </label>
          )}
          {(newTrip || !lastTrip) && (
            <label>
              Naam tocht
              <input
                type="text"
                autoComplete="off"
                placeholder={defaultTripName(boat.trim() || 'Boot', date)}
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
              />
            </label>
          )}
        </>
      )}
      {!boat && !more && <p className="error">Boot ontbreekt: open "Meer" en vul de boot in.</p>}
      <button className="btn primary" type="submit" disabled={!ok || busy}>
        Opslaan
      </button>
    </form>
  )
}
