import { Ban, Check, Clock, HandCoins, Pencil, Wallet } from 'lucide-react'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDate, formatMoney, formatMonth } from '../format'
import { t } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { nameWithCounter } from '../model/counters'
import { active } from '../model/derive'
import type { Undo } from '../domain/commit'
import { salaryOf, salaryState, salaryStatus, type SalaryState } from '../domain/geldmodel'
import { expectedPayout, expectedSalary, minimumPayout, openSalaryTrips, payoutQuestions, payoutSuggestion, type PayoutQuestion } from '../model/money-path'
import { getRates, subscribeRates } from '../model/rates'
import { salaryDefault, tripEnd } from '../model/salary'
import { weekView } from '../model/weeks'
import { currentSettings, defaultCurrency } from '../model/settings'
import { CURRENCIES, type Currency, type Leg, type Organisation, type SalaryStatus, type Transaction, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { salarisLaterVragen, salarisOpslaan, uitbetalingInvoeren } from '../domain/geld'
import { amountInput, parseAmount, round2 } from '../basis/bedrag'
import { todayIso } from '../basis/datum'
import { organisationChoices } from '../basis/organisatie'

// Salaris en uitbetalingen (src/domain/geldmodel.ts, src/model/money-path.ts): het salaris van een tocht als bolletje
// (grijs verwacht, oranje te ontvangen, groen ontvangen), het salarisblad (één salaris per tocht) en een uitbetaling per
// organisatie die de tochten in één keer afvinkt.

/** Bolletje voor de status van het salaris; de tekst ernaast (of het label) zegt wat het betekent. */
export function SalaryDot({ state }: { state: SalaryState | null }) {
  return <span className={`salary-dot ${state ?? 'geen'}`} aria-hidden="true" />
}

export function salaryStateLabel(state: SalaryState | null): string {
  return t(state ? `salaryState.${state}` : 'salaryState.geen')
}

/** Het salaris van een tocht met zijn status (verwacht, te ontvangen, ontvangen; null bij geen of zonder salaris). */
export function tripSalary(trip: Trip, legs: readonly Leg[], transactions: readonly Transaction[], today: string): { salary: Transaction | undefined; state: SalaryState | null } {
  const salary = salaryOf(trip.id, transactions)
  return { salary, state: salary ? salaryState(salary, trip, tripEnd(trip, legs), today) : null }
}

/** Het bedrag bij het bolletje: het salaris van de tocht (ontvangen of verwacht). */
export function salaryAmountText(trip: Trip, transactions: readonly Transaction[]): string {
  const s = salaryOf(trip.id, transactions)
  return s && salaryStatus(s) !== 'geen' ? formatMoney(s.amount, s.currency) : ''
}

function CurrencySelect({ value, onChange, label, disabled }: { value: Currency; onChange: (c: Currency) => void; label?: string; disabled?: boolean }) {
  return (
    <label>
      {t('field.currency')}
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Currency)}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Geld: te ontvangen salaris per organisatie met "Uitbetaling invoeren". */
export function MoneyPathSection({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const counters = useCounters(store)
  const today = todayIso()
  const [paying, setPaying] = useState(false)
  const open = organisationChoices(trips).map((org) => ({ org, trips: openSalaryTrips(trips, legs, transactions, org, today) })).filter((o) => o.trips.length > 0)
  const hasSalary = active(trips).some((x) => !!salaryOf(x.id, transactions))
  if (!hasSalary) return null
  return (
    <div className="section card card-body stack-sm money-path">
      <div className="section-head">
        <h2>{t('payout.title')}</h2>
      </div>
      {open.length === 0 ? (
        <p className="muted small">{t('payout.nothingOpen')}</p>
      ) : (
        <ul className="plain-list">
          {open.map((o) => (
            <li key={o.org} className="row">
              <SalaryDot state="te-ontvangen" />
              <span className="grow">{t('payout.openLine', { org: organisationLabel(o.org), n: o.trips.length })}</span>
              <span className="muted small">{o.trips.map((x) => nameWithCounter(x, counters.get(x.id))).join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={() => setPaying(true)}>
        <Icon icon={HandCoins} />
        {t('payout.enter')}
      </button>
      {paying && <PayoutSheet store={store} notify={notify} onClose={() => setPaying(false)} />}
    </div>
  )
}

/**
 * "SV betaalde € X op <datum>": organisatie, bedrag, valuta en datum; de open trips van die organisatie met een
 * voorstel volgens de uitbetaling (na elke trip of maandelijks), en het verschil met het verwachte bedrag.
 */
export function PayoutSheet({ store, notify, onClose, org: initialOrg, preset }: { store: Store; notify: Notify; onClose: () => void; org?: Organisation; preset?: readonly string[] }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const counters = useCounters(store)
  useSyncExternalStore(subscribeRates, getRates)
  const rates = getRates()
  const today = todayIso()
  const withOpen = organisationChoices(trips).filter((o) => openSalaryTrips(trips, legs, transactions, o, today).length > 0)
  const [org, setOrgState] = useState<Organisation>(initialOrg ?? withOpen[0] ?? organisationChoices()[0] ?? 'overig')
  const [date, setDate] = useState(today)
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(preset ? new Set(preset) : null)
  const [typedAmount, setTypedAmount] = useState<string | null>(null)
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null)
  const [busy, setBusy] = useState(false)
  const open = openSalaryTrips(trips, legs, transactions, org, date)
  const selected = chosen ? open.filter((x) => chosen.has(x.id)) : payoutSuggestion(trips, legs, settings, org, date, transactions)
  const tripCurrencies = new Set(selected.map((x) => expectedSalary(x, transactions)!.currency))
  const currency = pickedCurrency ?? (tripCurrencies.size === 1 ? [...tripCurrencies][0]! : 'EUR')
  const expected = selected.length > 0 ? expectedPayout(selected, legs, transactions, currency, date, rates) : null
  // Het verwachte bedrag staat er al, zolang Olivier zelf niets typt.
  const amountText = typedAmount ?? (expected !== null ? amountInput(expected) : '')
  const parsed = parseAmount(amountText)
  const valid = parsed !== null && parsed >= minimumPayout(selected.length) && !!date && selected.length > 0
  const diff = parsed !== null && expected !== null ? round2(parsed - expected) : null

  function setOrg(next: Organisation) {
    setOrgState(next)
    setChosen(null)
    setTypedAmount(null)
    setPickedCurrency(null)
  }

  function toggle(id: string) {
    const next = new Set(selected.map((x) => x.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const undo = await uitbetalingInvoeren(store, { org, amount: parsed, currency, date }, selected, rates)
      onClose()
      notify(t('payout.saved', { n: selected.length }), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('payout.enter')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('week.organisation')}
          <select value={org} onChange={(e) => setOrg(e.target.value as Organisation)}>
            {organisationChoices(trips).map((o) => (
              <option key={o} value={o}>
                {organisationLabel(o)}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="grow">
            {t('payout.amount')}
            <input
              className="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => {
                setTypedAmount(e.target.value)
                // Een getypt bedrag hoort bij de valuta van dat moment: die verandert daarna niet meer vanzelf.
                if (pickedCurrency === null) setPickedCurrency(currency)
              }}
            />
          </label>
          <CurrencySelect value={currency} onChange={setPickedCurrency} />
        </div>
        <label>
          {t('payout.date')}
          <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="stack-sm" role="group" aria-label={t('payout.trips')}>
          <span className="muted small">{t('payout.trips')}</span>
          {open.length === 0 ? (
            <p className="muted small">{t('payout.noTrips', { org: organisationLabel(org) })}</p>
          ) : (
            open.map((x) => (
              <label key={x.id} className="check payout-trip">
                <input type="checkbox" checked={selected.some((s) => s.id === x.id)} onChange={() => toggle(x.id)} />
                <span className="grow">
                  {nameWithCounter(x, counters.get(x.id))}
                  <span className="muted small"> · {formatDate(tripEnd(x, legs))}</span>
                </span>
                <span className="num small">{formatMoney(expectedSalary(x, transactions)!.amount, expectedSalary(x, transactions)!.currency)}</span>
              </label>
            ))
          )}
        </div>
        {selected.length > 0 && (
          <p className="muted small payout-expected">
            {expected === null ? t('payout.expectedUnknown') : t('payout.expected', { amount: formatMoney(expected, currency) })}
            {diff !== null && diff !== 0 && (
              <>
                {' · '}
                <strong className={diff > 0 ? 'positive' : 'negative'}>{t('payout.difference', { amount: `${diff > 0 ? '+' : '−'}${formatMoney(Math.abs(diff), currency)}` })}</strong>
              </>
            )}
            {diff === 0 && ` · ${t('payout.asExpected')}`}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={!valid || busy}>
          <Icon icon={Check} />
          {t('payout.save', { n: selected.length })}
        </button>
      </form>
    </Sheet>
  )
}

/**
 * Het salaris van één tocht (vanuit de tocht, de agenda en het seizoensoverzicht): precies één per tocht, dus dit blad
 * werkt het bestaande salaris bij of maakt het ene salaris. Verwacht, ontvangen (alleen met een bedrag, met de datum van
 * ontvangst) of geen salaris. "Standaardbedrag gebruiken" vult alleen het bedrag in.
 */
export function TripSalarySheet({ store, trip, notify, onClose }: { store: Store; trip: Trip; notify: Notify; onClose: () => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const current = useCollection(store, 'trips.json.enc').find((x) => x.id === trip.id) ?? trip
  const transactions = useCollection(store, 'transactions.json.enc')
  const today = todayIso()
  const existing = salaryOf(current.id, transactions)
  const def = salaryDefault(settings, current.organisation)
  const [status, setStatus] = useState<SalaryStatus>(existing ? salaryStatus(existing) : 'verwacht')
  const [amount, setAmount] = useState(existing && existing.amount > 0 ? amountInput(existing.amount) : !existing && def ? amountInput(def.amount) : '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? def?.currency ?? defaultCurrency(settings, 'salaris'))
  const [date, setDate] = useState(existing && salaryStatus(existing) === 'ontvangen' ? existing.date : today)
  const [busy, setBusy] = useState(false)
  const parsed = status === 'geen' ? 0 : amount.trim() === '' ? 0 : parseAmount(amount)
  // Ontvangen kan alleen met een bedrag; verwacht mag (nog) zonder.
  const missing = status === 'ontvangen' && !(parsed !== null && parsed > 0)
  const valid = parsed !== null && parsed >= 0 && !missing && (status !== 'ontvangen' || !!date)
  const name = nameWithCounter(current, counters.get(current.id))

  async function save() {
    if (!valid || busy) return
    setBusy(true)
    try {
      const { undo } = await salarisOpslaan(store, current.id, { amount: parsed!, currency, status, ...(status === 'ontvangen' ? { date } : {}) })
      onClose()
      notify(t('salary.tripSaved'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('salary.tripTitle', { trip: name })} onClose={onClose}>
      {/* Geen <form>: dit blad opent ook vanuit Trip bewerken, dat zelf een formulier is (een genest formulier verstuurt
          het buitenste, en dat blokkeert de CSP). */}
      <div className="stack">
        <div className="segments" role="radiogroup" aria-label={t('salary.status')}>
          {(['verwacht', 'ontvangen', 'geen'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} className={`segment${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
              {t(`salaryStatus.${s}`)}
            </button>
          ))}
        </div>
        {status !== 'geen' && (
          <>
            <div className="row">
              <label className="grow">
                {t('salary.amount')}
                <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
            {def && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setAmount(amountInput(def.amount))
                  setCurrency(def.currency)
                }}
              >
                {t('salary.useStandard', { amount: formatMoney(def.amount, def.currency) })}
              </button>
            )}
          </>
        )}
        {status === 'ontvangen' && (
          <label>
            {t('salary.receivedOn')}
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {missing && <p className="warning small">{t('salary.receivedNeedsAmount')}</p>}
        <button className="btn primary" type="button" disabled={!valid || busy} onClick={() => void save()}>
          <Icon icon={status === 'ontvangen' ? Check : status === 'geen' ? Ban : Pencil} />
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  )
}

/**
 * Vandaag, bij een maandelijkse uitbetaling: "Uitbetaling van (organisatie) voor (maand) ontvangen?" (zonder
 * bedragen). Ja boekt het verwachte bedrag, "Ander bedrag" opent de uitbetaling, "Nog niet" vraagt een week later.
 */
export function PayoutQuestions({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const transactions = useCollection(store, 'transactions.json.enc')
  useSyncExternalStore(subscribeRates, getRates)
  const [other, setOther] = useState<PayoutQuestion | null>(null)
  // Eén tik tegelijk: een tweede tik voordat het scherm bijgewerkt is, boekt niets nog eens.
  const [busy, setBusy] = useState(false)
  const today = todayIso()
  const questions = payoutQuestions(trips, legs, settings, today, transactions)
  if (questions.length === 0 && !other) return null

  async function yes(q: PayoutQuestion) {
    if (busy) return
    const currencies = new Set(q.trips.map((x) => expectedSalary(x, transactions)!.currency))
    const currency = currencies.size === 1 ? [...currencies][0]! : 'EUR'
    const expected = expectedPayout(q.trips, legs, transactions, currency, today, getRates())
    // Zonder koers is het verwachte bedrag niet op te tellen: dan het bedrag zelf invullen.
    if (expected === null) return setOther(q)
    setBusy(true)
    try {
      const undo = await uitbetalingInvoeren(store, { org: q.org, amount: expected, currency, date: today }, q.trips, getRates())
      notify(t('payout.saved', { n: q.trips.length }), undo)
    } finally {
      setBusy(false)
    }
  }

  async function later(q: PayoutQuestion) {
    if (busy) return
    setBusy(true)
    try {
      const undos: Undo[] = []
      for (const x of q.trips) undos.push(await salarisLaterVragen(store, x.id, today))
      notify(t('salary.laterToast'), async () => {
        for (const undo of undos) await undo()
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {questions.map((q) => (
        <div key={q.org} className="card card-body stack-sm salary-question">
          <p className="row">
            <Icon icon={Wallet} />
            <span className="grow">{t('payout.question', { org: organisationLabel(q.org), month: formatMonth(q.month), n: q.trips.length })}</span>
          </p>
          <div className="row wrap">
            <button type="button" className="btn small primary" disabled={busy} onClick={() => void yes(q)}>
              <Icon icon={Check} />
              {t('salary.yes')}
            </button>
            <button type="button" className="btn small" onClick={() => setOther(q)}>
              <Icon icon={Pencil} />
              {t('salary.otherAmount')}
            </button>
            <button type="button" className="btn small quiet" disabled={busy} onClick={() => void later(q)}>
              <Icon icon={Clock} />
              {t('salary.notYet')}
            </button>
          </div>
        </div>
      ))}
      {other && <PayoutSheet store={store} notify={notify} org={other.org} preset={other.trips.map((x) => x.id)} onClose={() => setOther(null)} />}
    </>
  )
}

/**
 * Agenda: het salaris van de trips in deze maand, met het bolletje, de status en (na "Toon bedragen") het bedrag. Tik =
 * salaris zetten of wijzigen.
 */
export function MonthSalaries({ store, month, showAmounts, notify }: { store: Store; month: string; showAmounts: boolean; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const counters = useCounters(store)
  const [editing, setEditing] = useState<Trip | null>(null)
  const today = todayIso()
  // Alleen tochten waar salaris bij hoort: met een organisatie of al een salaris (eigen zeilen of trainen niet).
  const inMonth = active(trips)
    .filter((x) => salaryOf(x.id, transactions) || (x.organisation && x.organisation !== 'eigen'))
    .map((x) => ({ trip: x, view: weekView(x, legs) }))
    .filter((e) => e.view.startDate && e.view.endDate && e.view.startDate <= `${month}-31` && e.view.endDate >= `${month}-01`)
    .sort((a, b) => a.view.startDate.localeCompare(b.view.startDate))
  if (inMonth.length === 0) return null
  return (
    <div className="month-salaries stack-sm">
      <h2 className="small-heading">{t('salary.thisMonth')}</h2>
      <ul className="plain-list">
        {inMonth.map(({ trip }) => {
          const { state } = tripSalary(trip, legs, transactions, today)
          return (
            <li key={trip.id}>
              <button type="button" className="row month-salary" onClick={() => setEditing(trip)}>
                <SalaryDot state={state} />
                <span className="grow">{nameWithCounter(trip, counters.get(trip.id))}</span>
                <span className="muted small">{salaryStateLabel(state)}</span>
                {showAmounts && <span className="num small">{salaryAmountText(trip, transactions)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {editing && <TripSalarySheet store={store} trip={editing} notify={notify} onClose={() => setEditing(null)} />}
    </div>
  )
}
