import { CalendarPlus, Coins, MapPin, Receipt, Sailboat } from 'lucide-react'
import { TripForm } from '../components/QuickTrip'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { MapSheet } from '../components/MapSheet'
import { TipFromPicker } from '../components/TipFromPicker'
import { draftTotal, EMPTY_TIP, formatAmountInput, tipFromDraft, totalWhenLeavingSplit, type TipDraft } from '../model/tip-draft'
import { formatNm, formatNumber } from '../format'
import { defaultFromPlace, findPlace, knownPlaceNames, mergeCandidates, nearestKnownPlace, placeCountry, placeKey, placeUses, similarKnown, suggestDistance } from '../model/places'
import { MergeProposal } from './Places'
import { plannedFor } from '../model/routes'
import { estimateWater, type WaterEstimate } from '../model/estimate'
import { kindLabel, roleLabel, sourceLabel } from '../i18n/labels'
import { useCollection } from '../components/useCollection'
import { defaultTripName } from '../import/mileage-csv'
import { active, compareLegs, summarizeTrips, tripForDate } from '../model/derive'
import { parseNonNegative } from '../model/edit'
import { addDays, parseAmount } from '../model/money'
import { currentSettings, saveSettings } from '../model/settings'
import { finalRateFields } from '../model/rates'
import { activeWeek, roleForType } from '../model/weeks'
import {
  CURRENCIES,
  INCOME_KIND_LIST,
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
  type IncomeKind,
  type TransactionKind,
  type TransactionSource,
  type Trip,
} from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from '../components/EditSheets'
import { t } from '../i18n'

// Snel toevoegen: Dag · Inkomsten · Uitgave, opent op Dag. Bij Dag staan alle velden in beeld, voorgevuld met de vorige
// bestemming en de laatst gebruikte boot, rol en week; niets is verplicht. Opslaan = één tik.

/** Korte trilling als bevestiging van opslaan; stil als het apparaat het niet kan. */
function confirmVibration() {
  try {
    navigator.vibrate?.(30)
  } catch {
    // Niet beschikbaar.
  }
}

/** Voorinvulling vanuit een ander scherm, bijvoorbeeld "Dag toevoegen" bij een trip. */
export interface AddInit {
  date: string
  tripId?: string
  /** Geplande etappe ("Aanpassen" op Vandaag). */
  from?: string
  to?: string
}

export function QuickAdd({ store, onDone, init, notify, tab: initialTab = 'dag' }: { store: Store; onDone: (message: string) => void; init?: AddInit; notify: Notify; tab?: AddTab }) {
  const [tab, setTab] = useState<AddTab>(initialTab)
  const choose = (next: AddTab) => setTab(next)
  return (
    <section className="stack">
      <header className="page-header">
        <h1>{t('nav.add')}</h1>
      </header>
      <div className="segments add-tabs" role="tablist">
        {(['trip', 'dag', 'inkomsten', 'uitgave'] as AddTab[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`segment${tab === id ? ' active' : ''}`}
            onClick={() => choose(id)}
          >
            <Icon icon={id === 'trip' ? CalendarPlus : id === 'inkomsten' ? Coins : id === 'uitgave' ? Receipt : Sailboat} />
            {t(id === 'trip' ? 'quick.tabTrip' : id === 'inkomsten' ? 'quick.tabIncome' : id === 'uitgave' ? 'quick.tabExpense' : 'quick.tabDay')}
          </button>
        ))}
      </div>
      {tab === 'trip' && <TripForm store={store} onDone={onDone} notify={notify} />}
      {tab === 'dag' && <DayForm store={store} onDone={onDone} init={init} notify={notify} />}
      {tab === 'inkomsten' && <IncomeForm store={store} onDone={onDone} />}
      {tab === 'uitgave' && <CostForm store={store} onDone={onDone} />}
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
  tripId?: string,
) {
  const trip = tripId ? { id: tripId } : tripForDate(store.get('trips.json.enc'), store.get('legs.json.enc'), tx.date)
  const record: Transaction = { ...tx, id: newId(), updatedAt: nowIso(), deletedAt: null }
  if (trip) record.tripId = trip.id
  if (tx.currency === 'EUR') record.amountEur = tx.amount
  else Object.assign(record, finalRateFields(tx) ?? {})
  await store.put('transactions.json.enc', record)
  await saveSettings(store, { lastCurrency: tx.currency, lastSource: tx.source, ...remember })
  confirmVibration()
  void store.sync()
}

/**
 * Trips om uit te kiezen: de lopende trip en de trip van de datum eerst, dan komende en recente trips. Standaard de
 * trip waarin de datum valt (of de lopende trip); verandert de datum en heeft Olivier zelf niets gekozen, dan volgt
 * de trip mee.
 */
function useTripChoice(store: Store, date: string) {
  const { settings, trips, legs } = useDefaults(store)
  const running = activeWeek(trips, settings, date)
  const byDate = tripForDate(trips, legs, date)
  // Geen trip op die datum: de laatste trip die vóór de datum begon, anders de eerstvolgende. Nooit blokkeren.
  const nearest = useMemo(() => {
    const dated = active(trips).filter((trip) => trip.startDate)
    const before = dated.filter((trip) => trip.startDate! <= date).sort((a, b) => (a.startDate! < b.startDate! ? 1 : -1))[0]
    return before ?? dated.sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))[0] ?? active(trips)[0]
  }, [trips, date])
  const fallback = byDate?.id ?? running?.id ?? nearest?.id ?? ''
  const [chosen, setChosen] = useState<string | null>(null)
  const options = useMemo(() => {
    const list = active(trips)
      .filter((trip) => !trip.closedAt || trip.id === byDate?.id)
      .sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))
      .slice(0, 20)
    for (const extra of [nearest, running, byDate]) if (extra && !list.some((x) => x.id === extra.id)) list.unshift(extra)
    return list
  }, [trips, byDate, running, nearest])
  const tripId = chosen ?? fallback
  return { tripId, setTripId: setChosen, options }
}

function TripField({ value, options, onChange, required }: { value: string; options: Trip[]; onChange: (id: string) => void; required: boolean }) {
  return (
    <label>
      {t('field.trip')}
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        {(!required || value === '') && <option value="">{t('quick.noTrip')}</option>}
        {options.map((trip) => (
          <option key={trip.id} value={trip.id}>
            {trip.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function IncomeForm({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const { settings } = useDefaults(store)
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<IncomeKind>(settings.lastIncomeKind ?? 'fooi')
  const [source, setSource] = useState<TransactionSource>(settings.lastSource)
  const [currency, setCurrency] = useState<Currency>(settings.lastCurrency)
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { tripId, setTripId, options } = useTripChoice(store, date)
  // Inkomsten horen bij een trip; alleen zonder enige trip mag het leeg blijven.
  const tripOk = tripId !== '' || options.length === 0
  // Fooi: van wie (deelnemers van de gekozen trip); een andere trip begint weer bij onbekend.
  const people = kind === 'fooi' ? (options.find((x) => x.id === tripId)?.participants ?? []) : []
  const [tip, setTip] = useState<{ tripId: string; draft: TipDraft }>({ tripId, draft: EMPTY_TIP })
  const draft = tip.tripId === tripId ? tip.draft : EMPTY_TIP
  const total = people.length > 0 ? draftTotal(draft) : undefined
  const parsed = total !== undefined ? total : parseAmount(amount)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || !tripOk || busy) return
    setBusy(true)
    try {
      const tipFrom = people.length > 0 ? tipFromDraft(draft, people) : undefined
      await saveTransaction(store, { date, kind, amount: parsed, currency, source, ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}), ...(tipFrom ? { tipFrom } : {}) }, { lastIncomeKind: kind }, tripId || undefined)
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
          value={total !== undefined ? (total === null ? '' : formatAmountInput(total)) : amount}
          readOnly={total !== undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <div className="type-buttons" role="radiogroup" aria-label={t('field.kind')}>
        {INCOME_KIND_LIST.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <TripField value={tripId} options={options} onChange={setTripId} required={options.length > 0} />
      {people.length > 0 && (
        <TipFromPicker
          participants={people}
          value={draft}
          currency={currency}
          onChange={(next) => {
            const kept = totalWhenLeavingSplit(draft, next)
            if (kept !== null) setAmount(formatAmountInput(kept))
            setTip({ tripId, draft: next })
          }}
        />
      )}
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
      <div className="two">
        <label>
          {t('field.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          {t('field.note')}
          <input type="text" autoComplete="off" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="btn primary" type="submit" disabled={parsed === null || !date || !tripOk || busy}>
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
  const { tripId, setTripId, options } = useTripChoice(store, date)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || busy) return
    setBusy(true)
    try {
      await saveTransaction(
        store,
        { date, kind, amount: parsed, currency, source, ...(note.trim() ? { note: note.trim() } : {}) },
        { lastCostKind: kind === 'investering' ? 'investering' : 'kosten' },
        tripId || undefined,
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
          <div className="two">
            <label>
              {t('field.date')}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <TripField value={tripId} options={options} onChange={setTripId} required={false} />
          </div>
        </>
      )}
      <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
        {t('common.save')}
      </button>
    </form>
  )
}

/** Plaatsveld: typen met suggesties uit eerdere plaatsen, of kiezen op de kaart. */
function PlaceField({ label, value, onChange, onMap, autoFocus = false }: { label: string; value: string; onChange: (v: string) => void; onMap: () => void; autoFocus?: boolean }) {
  return (
    <div className="place-field">
      <label>
        {label}
        <input type="text" autoFocus={autoFocus} autoComplete="off" list="plaatsen" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <button type="button" className="btn icon" aria-label={t('map.open', { field: label })} onClick={onMap}>
        <Icon icon={MapPin} />
      </button>
    </div>
  )
}

function waterOf(leg: Leg | undefined): Water {
  if (!leg) return 'zee'
  if (leg.nmTidal > 0) return 'getij'
  if (leg.nmInland > 0 && leg.nmSea === 0) return 'binnen'
  return 'zee'
}

function DayForm({ store, onDone, init, notify }: { store: Store; onDone: (message: string) => void; init?: AddInit; notify: Notify }) {
  const { settings, trips, legs } = useDefaults(store)
  const today = todayIso()
  const lastLeg = useMemo(() => [...active(legs)].sort(compareLegs).at(-1), [legs])
  // Weken om uit te kiezen: nieuwste eerst (op laatste dag), daarna weken zonder dagen.
  const weeks = useMemo(() => {
    const withDays = summarizeTrips(trips, legs).map((s) => s.trip)
    const empty = active(trips).filter((trip) => !withDays.some((w) => w.id === trip.id))
    const list = [...empty, ...withDays].slice(0, 12)
    const running = activeWeek(trips, settings)
    return running && !list.some((w) => w.id === running.id) ? [running, ...list] : list
  }, [trips, legs, settings])
  const lastTrip = useMemo(() => {
    const id = lastLeg?.tripId ?? settings.lastTripId
    return active(trips).find((trip) => trip.id === id)
  }, [trips, lastLeg, settings.lastTripId])
  // De lopende week gaat voor; anders dezelfde week als de vorige dag kort geleden was; anders een nieuwe week.
  const requested = init?.tripId ? active(trips).find((trip) => trip.id === init.tripId) : undefined
  const current = requested ?? activeWeek(trips, settings)
  const sameTripDefault = !!lastTrip && !!lastLeg && lastLeg.date >= addDays(today, -3)
  const defaultTripId = current?.id ?? (sameTripDefault && lastTrip ? lastTrip.id : NEW_WEEK)
  // Van: de vorige bestemming binnen deze trip; de eerste dag van een trip begint op de basis van de boot.
  const startDate = init?.date ?? today
  // Een geplande etappe van die dag (route-sjabloon of vorige trip) vult van en naar voor.
  const planned = plannedFor(current ?? null, legs, startDate)
  // Nooit een plaats uit een andere trip: vorige Naar in deze trip, anders de basis, anders via GPS (hieronder).
  const defaultFrom = init?.from ?? planned?.from ?? defaultFromPlace(legs, active(trips).find((x) => x.id === defaultTripId), startDate)
  const weekRole = (trip: Trip | undefined) => (trip?.type ? roleForType(trip.type) : null)

  const [date, setDate] = useState(startDate)
  const [fromPlace, setFromPlaceState] = useState(defaultFrom)
  // Zelf getypt of gekozen: dan volgt Van niet meer de trip, de datum of de GPS.
  const [fromTouched, setFromTouched] = useState(!!init?.from)
  const setFromPlace = (value: string) => {
    setFromTouched(true)
    setFromPlaceState(value)
  }
  const [toPlace, setToPlace] = useState(init?.to ?? planned?.to ?? '')
  const [nm, setNm] = useState('')
  const [nmTouched, setNmTouched] = useState(false)
  const [mapFor, setMapFor] = useState<'from' | 'to' | null>(null)
  const places = useCollection(store, 'places.json.enc')
  const placeNames = useMemo(() => knownPlaceNames(legs, places), [legs, places])
  // Spelvarianten: "Bedoel je …?" bij een nieuwe naam, en een voorstel om bekende varianten samen te voegen.
  const uses = useMemo(() => placeUses(legs, places), [legs, places])
  const merges = useMemo(() => mergeCandidates(uses), [uses])
  const routeMerge = merges.find((c) => [c.into, ...c.others].some((u) => u.key === placeKey(fromPlace) || u.key === placeKey(toPlace)))
  const fromAlike = similarKnown(uses, fromPlace)
  const toAlike = similarKnown(uses, toPlace)
  // Voorstel uit wat Olivier echt gevaren heeft: gemiddelde van de laatste vijf keer deze route.
  const suggestion = useMemo(() => suggestDistance(legs, fromPlace, toPlace), [legs, fromPlace, toPlace])
  // Geen eerdere keren: de waterroute om land heen maal de persoonlijke factor (nooit hemelsbreed).
  const fromPoint = findPlace(places, fromPlace)
  const toPoint = findPlace(places, toPlace)
  const [estimate, setEstimate] = useState<WaterEstimate | null>(null)
  useEffect(() => {
    setEstimate(null)
    if (suggestion || !fromPoint || !toPoint || fromPoint.id === toPoint.id) return
    let active = true
    void estimateWater(fromPoint, toPoint, legs, places).then((e) => active && setEstimate(e))
    return () => {
      active = false
    }
  }, [suggestion, fromPoint?.id, fromPoint?.lat, fromPoint?.lon, toPoint?.id, toPoint?.lat, toPoint?.lon, legs])
  useEffect(() => {
    if (!nmTouched) setNm(suggestion ? formatNumber(suggestion.nm) : estimate ? formatNumber(estimate.nm) : '')
  }, [suggestion, estimate, nmTouched])
  const [water, setWater] = useState<Water>(settings.lastWater ?? waterOf(lastLeg))
  const [nightHours, setNightHours] = useState('')
  const [wind, setWind] = useState('')
  const [boat, setBoat] = useState(current?.boat || settings.lastBoat || lastLeg?.boat || '')
  const [role, setRole] = useState<Role>(weekRole(current ?? undefined) ?? settings.lastRole)
  const [tripId, setTripId] = useState<string>(defaultTripId)

  /** Andere week gekozen: boot en rol volgen die week als die ze heeft; Van ook, zolang Olivier hem niet zelf koos. */
  function chooseWeek(id: string) {
    setTripId(id)
    const trip = trips.find((w) => w.id === id)
    if (!fromTouched) setFromPlaceState(defaultFromPlace(legs, trip, date))
    if (trip?.boat) setBoat(trip.boat)
    const r = weekRole(trip)
    if (r) setRole(r)
  }
  // Geen vorige dag in deze trip en geen basis: de dichtstbijzijnde bekende plaats via GPS (alleen als die dichtbij is).
  useEffect(() => {
    if (fromTouched || fromPlace.trim() || !('geolocation' in navigator)) return
    let live = true
    const locate = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const near = nearestKnownPlace(store.list('places.json.enc'), { lat: pos.coords.latitude, lon: pos.coords.longitude }, GPS_FROM_NM)
          if (live && near) setFromPlaceState((current) => current || near.name)
        },
        () => undefined,
        { maximumAge: 10 * 60_000, timeout: 10_000 },
      )
    // Niet opnieuw om toestemming vragen als Olivier die weigerde.
    void (navigator.permissions?.query({ name: 'geolocation' as PermissionName }) ?? Promise.resolve(null))
      .then((status) => {
        if (live && status?.state !== 'denied') locate()
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [tripId])
  const [tripName, setTripName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const nmValue = parseNonNegative(nm)
  const night = parseNonNegative(nightHours)
  // Niets is verplicht: leeg = 0 of leeg, een dag zonder plaats krijgt "Onvolledig". Alleen onleesbare getallen wachten.
  const ok = nmValue !== null && night !== null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      const now = nowIso()
      const day = date || today
      let id = tripId === NEW_WEEK ? undefined : tripId
      if (!id) {
        const trip: Trip = {
          id: newId(),
          name: tripName.trim() || defaultTripName(boat.trim() || t('field.trip'), day),
          updatedAt: now,
          deletedAt: null,
        }
        await store.put('trips.json.enc', trip)
        id = trip.id
      }
      // Landen: niet in beeld. Van de plaats zelf (punt of eerdere dagen), anders het land van de vorige dag in deze
      // trip; nooit van een dag uit een andere trip (anders krijgt een dag in de BVI het land van een dag in Engeland).
      const previous = id ? [...active(legs)].filter((l) => l.tripId === id && l.date <= day).sort(compareLegs).at(-1) : undefined
      const fromCountry = placeCountry(legs, places, fromPlace) || previous?.toCountry || ''
      const toCountry = placeCountry(legs, places, toPlace) || (previous ? previous.toCountry : '')
      const leg: Leg = {
        id: newId(),
        tripId: id,
        date: day,
        fromPlace: fromPlace.trim(),
        fromCountry,
        toPlace: toPlace.trim(),
        toCountry,
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
    <>
      <form className="stack day-form" onSubmit={(e) => void submit(e)}>
        <div className="two">
          <label>
            {t('field.date')}
            <input
              type="date"
              value={date}
              max={addDays(today, 1)}
              onChange={(e) => {
                setDate(e.target.value)
                if (!fromTouched) setFromPlaceState(defaultFromPlace(legs, trips.find((w) => w.id === tripId), e.target.value || today))
              }}
            />
          </label>
          <PlaceField label={t('field.from')} value={fromPlace} onChange={setFromPlace} onMap={() => setMapFor('from')} />
        </div>
        <div className="two">
          <PlaceField label={t('field.to')} value={toPlace} onChange={setToPlace} onMap={() => setMapFor('to')} autoFocus />
          <label>
            {t('field.nm')}
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={nm}
              onChange={(e) => {
                setNm(e.target.value)
                setNmTouched(true)
              }}
            />
          </label>
        </div>
        <datalist id="plaatsen">
          {placeNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {suggestion ? (
          <p className="muted small route-hint">{t('route.average', { nm: formatNm(suggestion.nm), n: suggestion.count })}</p>
        ) : estimate ? (
          <p className="muted small route-hint">{t('route.water', { nm: formatNumber(estimate.nm), water: formatNumber(estimate.water), factor: formatNumber(estimate.factor) })}</p>
        ) : null}
        {fromAlike && (
          <p className="muted small">
            {t('places.didYouMean', { name: fromAlike.name })}{' '}
            <button type="button" className="btn link inline" onClick={() => setFromPlace(fromAlike.name)}>
              {t('places.use', { name: fromAlike.name })}
            </button>
          </p>
        )}
        {toAlike && (
          <p className="muted small">
            {t('places.didYouMean', { name: toAlike.name })}{' '}
            <button type="button" className="btn link inline" onClick={() => setToPlace(toAlike.name)}>
              {t('places.use', { name: toAlike.name })}
            </button>
          </p>
        )}
        {routeMerge && <MergeProposal store={store} candidate={routeMerge} notify={notify} />}
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
          <select value={tripId} onChange={(e) => chooseWeek(e.target.value)}>
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
      {mapFor && (
        <MapSheet
          store={store}
          title={t(mapFor === 'from' ? 'map.titleFrom' : 'map.titleTo')}
          name={mapFor === 'from' ? fromPlace : toPlace}
          around={mapFor === 'from' ? [toPlace, current?.base ?? ''] : [fromPlace, current?.base ?? '']}
          routeFrom={mapFor === 'from' ? toPlace : fromPlace}
          onChoose={(name) => {
            if (mapFor === 'from') setFromPlace(name)
            else setToPlace(name)
            setMapFor(null)
          }}
          onClose={() => setMapFor(null)}
        />
      )}
    </>
  )
}

/** Van via GPS: alleen een bekende plaats binnen deze afstand. */
const GPS_FROM_NM = 15
const NEW_WEEK = '__nieuw__'
