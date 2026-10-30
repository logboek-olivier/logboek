import { Banknote, Check, Clock, HandCoins, Pencil, Wallet } from 'lucide-react'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDate, formatMoney, formatMonth } from '../format'
import { t } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { nameWithCounter } from '../model/counters'
import { active } from '../model/derive'
import type { Undo } from '../model/edit'
import { amountInput, parseAmount, round2 } from '../model/money'
import {
  cashOnHand,
  depositCash,
  expectedPayout,
  hasSalaryIncome,
  minimumPayout,
  openSalaryTrips,
  payoutQuestions,
  payoutSuggestion,
  receivedSalary,
  recordPayout,
  salaryState,
  type PayoutQuestion,
  type SalaryState,
} from '../model/money-path'
import { getRates, subscribeRates } from '../model/rates'
import { askSalaryLater, cleanSalary, receiveSalary, salaryDefault, tripEnd } from '../model/salary'
import { weekView } from '../model/weeks'
import { currentSettings } from '../model/settings'
import { CURRENCIES, ORGANISATIONS, todayIso, type Currency, type Organisation, type SalarySource, type Transaction, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Geldpad per trip (src/model/money-path.ts): het salaris als bolletje (grijs verwacht, oranje te ontvangen, groen
// ontvangen), een uitbetaling per organisatie die de trips in één keer afvinkt, en contante fooien tot ze gestort zijn.

/** Bolletje voor de status van het salaris; de tekst ernaast (of het label) zegt wat het betekent. */
export function SalaryDot({ state }: { state: SalaryState | null }) {
  return <span className={`salary-dot ${state ?? 'geen'}`} aria-hidden="true" />
}

export function salaryStateLabel(state: SalaryState | null): string {
  return t(state ? `salaryState.${state}` : 'salaryState.geen')
}

/** Het bedrag bij het bolletje: ontvangen = wat er echt binnenkwam, anders het verwachte salaris. */
export function salaryAmountText(trip: Trip, transactions: readonly Transaction[]): string {
  const received = receivedSalary(trip, transactions)
  if (received) return formatMoney(received.amount, received.currency)
  return trip.salary ? formatMoney(trip.salary.amount, trip.salary.currency) : ''
}

function CurrencySelect({ value, onChange, label }: { value: Currency; onChange: (c: Currency) => void; label?: string }) {
  return (
    <label>
      {t('field.currency')}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Currency)}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Geld: te ontvangen salaris per organisatie met "Uitbetaling invoeren", en Contant per valuta met "Gestort". */
export function MoneyPathSection({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const counters = useCounters(store)
  const today = todayIso()
  const [paying, setPaying] = useState(false)
  const [deposit, setDeposit] = useState<{ currency: Currency; amount: number } | null>(null)
  const open = ORGANISATIONS.map((org) => ({ org, trips: openSalaryTrips(trips, legs, org, today) })).filter((o) => o.trips.length > 0)
  const cash = Object.entries(cashOnHand(transactions)) as [Currency, number][]
  const hasSalary = active(trips).some((x) => x.salary)
  if (!hasSalary && cash.length === 0) return null
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
      {hasSalary && (
        <button type="button" className="btn" onClick={() => setPaying(true)}>
          <Icon icon={HandCoins} />
          {t('payout.enter')}
        </button>
      )}
      <h3>{t('cash.title')}</h3>
      {cash.length === 0 ? (
        <p className="muted small">{t('cash.none')}</p>
      ) : (
        <ul className="plain-list">
          {cash.map(([currency, amount]) => (
            <li key={currency} className="row cash-row">
              <Icon icon={Banknote} />
              <span className="grow num">{formatMoney(amount, currency)}</span>
              <button type="button" className="btn small" onClick={() => setDeposit({ currency, amount })}>
                {t('cash.deposit')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t('cash.hint')}</p>
      {paying && <PayoutSheet store={store} notify={notify} onClose={() => setPaying(false)} />}
      {deposit && <DepositSheet store={store} notify={notify} {...deposit} onClose={() => setDeposit(null)} />}
    </div>
  )
}

/** "Gestort op …": de contante fooien in deze valuta gaan uit Contant (ze staan nu op de bank). */
function DepositSheet({ store, notify, currency, amount, onClose }: { store: Store; notify: Notify; currency: Currency; amount: number; onClose: () => void }) {
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!date || busy) return
    setBusy(true)
    try {
      const undo = await depositCash(store, currency, date)
      onClose()
      notify(t('cash.deposited'), undo)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t('cash.depositTitle', { amount: formatMoney(amount, currency) })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('cash.depositDate')}
          <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small">{t('cash.depositHint')}</p>
        <button className="btn primary" type="submit" disabled={!date || busy}>
          <Icon icon={Check} />
          {t('cash.depositSave')}
        </button>
      </form>
    </Sheet>
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
  const withOpen = ORGANISATIONS.filter((o) => openSalaryTrips(trips, legs, o, today).length > 0)
  const [org, setOrgState] = useState<Organisation>(initialOrg ?? withOpen[0] ?? 'sailing-virgins')
  const [date, setDate] = useState(today)
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(preset ? new Set(preset) : null)
  const [typedAmount, setTypedAmount] = useState<string | null>(null)
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null)
  const [busy, setBusy] = useState(false)
  const open = openSalaryTrips(trips, legs, org, date)
  const selected = chosen ? open.filter((x) => chosen.has(x.id)) : payoutSuggestion(trips, legs, settings, org, date, transactions)
  const tripCurrencies = new Set(selected.map((x) => x.salary!.currency))
  const currency = pickedCurrency ?? (tripCurrencies.size === 1 ? [...tripCurrencies][0]! : 'EUR')
  const expected = selected.length > 0 ? expectedPayout(selected, legs, currency, date, rates) : null
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
      const undo = await recordPayout(store, { org, amount: parsed, currency, date }, selected, rates)
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
            {ORGANISATIONS.map((o) => (
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
                  {hasSalaryIncome(x, transactions) && <span className="warning small"> · {t('payout.alreadyBooked')}</span>}
                </span>
                <span className="num small">{formatMoney(x.salary!.amount, x.salary!.currency)}</span>
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
 * Salaris van één trip zetten of wijzigen (vanuit de agenda en het seizoensoverzicht): bedrag en valuta, of het
 * standaardbedrag van de organisatie; en "Ontvangen". Een getypt bedrag is eigen en wordt nooit vanzelf overschreven;
 * een ontvangen salaris staat vast (het inkomen staat bij Geld).
 */
export function TripSalarySheet({ store, trip, notify, onClose }: { store: Store; trip: Trip; notify: Notify; onClose: () => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const legs = useCollection(store, 'legs.json.enc')
  const counters = useCounters(store)
  const current = useCollection(store, 'trips.json.enc').find((x) => x.id === trip.id) ?? trip
  const transactions = useCollection(store, 'transactions.json.enc')
  const today = todayIso()
  const state = salaryState(current, legs, today)
  const paid = receivedSalary(current, transactions)
  const def = salaryDefault(settings, current.organisation)
  const [amount, setAmount] = useState(current.salary ? amountInput(current.salary.amount) : def ? amountInput(def.amount) : '')
  const [currency, setCurrency] = useState<Currency>(current.salary?.currency ?? def?.currency ?? settings.lastCurrency)
  const [source, setSource] = useState<SalarySource>(current.salary?.source ?? (def ? 'standaard' : 'eigen'))
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0
  const name = nameWithCounter(current, counters.get(current.id))

  function draft(): Trip {
    const base = current.salary ?? { status: 'verwacht' as const }
    return { ...current, salary: cleanSalary({ ...base, amount: parsed!, currency, source, status: base.status }) }
  }

  async function save() {
    if (!valid || busy) return
    setBusy(true)
    try {
      await store.put('trips.json.enc', { ...draft(), updatedAt: new Date().toISOString() })
      void store.sync()
      onClose()
      notify(t('salary.tripSaved'), async () => {
        await store.put('trips.json.enc', { ...current, updatedAt: new Date().toISOString() })
        void store.sync()
      })
    } finally {
      setBusy(false)
    }
  }

  async function received() {
    if (!valid || busy) return
    setBusy(true)
    try {
      // Het verwachte salaris blijft staan (behalve als er nog geen was); het ingevulde bedrag is wat er binnenkwam.
      const undo = await receiveSalary(store, current.salary ? current : draft(), today, { amount: parsed!, currency })
      onClose()
      notify(t('salary.receivedToast'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('salary.tripTitle', { trip: name })} onClose={onClose}>
      <div className="stack">
        <p className="row">
          <SalaryDot state={state} />
          <span>{salaryStateLabel(state)}</span>
        </p>
        {state === 'ontvangen' ? (
          <p className="muted small">
            {t('salary.receivedFixed', { amount: paid ? formatMoney(paid.amount, paid.currency) : formatMoney(current.salary!.amount, current.salary!.currency) })}
            {paid && (paid.amount !== current.salary!.amount || paid.currency !== current.salary!.currency) && ` ${t('salary.expectedWas', { amount: formatMoney(current.salary!.amount, current.salary!.currency) })}`}
          </p>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="row">
              <label className="grow">
                {t('salary.amount')}
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    setSource('eigen')
                  }}
                />
              </label>
              <CurrencySelect
                value={currency}
                onChange={(c) => {
                  setCurrency(c)
                  setSource('eigen')
                }}
              />
            </div>
            {def && source !== 'standaard' && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setAmount(amountInput(def.amount))
                  setCurrency(def.currency)
                  setSource('standaard')
                }}
              >
                {t('salary.useStandard', { amount: formatMoney(def.amount, def.currency) })}
              </button>
            )}
            {source === 'standaard' && current.organisation && <p className="muted small">{t('salary.isStandard', { org: organisationLabel(current.organisation) })}</p>}
            <button className="btn primary" type="submit" disabled={!valid || busy}>
              <Icon icon={Pencil} />
              {t('common.save')}
            </button>
            {state === 'te-ontvangen' && (
              <button type="button" className="btn" disabled={!valid || busy} onClick={() => void received()}>
                <Icon icon={Check} />
                {t('salary.markReceived')}
              </button>
            )}
          </form>
        )}
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
    const currencies = new Set(q.trips.map((x) => x.salary!.currency))
    const currency = currencies.size === 1 ? [...currencies][0]! : 'EUR'
    const expected = expectedPayout(q.trips, legs, currency, today, getRates())
    // Zonder koers is het verwachte bedrag niet op te tellen: dan het bedrag zelf invullen.
    if (expected === null) return setOther(q)
    setBusy(true)
    try {
      const undo = await recordPayout(store, { org: q.org, amount: expected, currency, date: today }, q.trips, getRates())
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
      for (const x of q.trips) undos.push(await askSalaryLater(store, x, today))
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
  // Alleen trips waar salaris bij hoort: met een organisatie of al een salaris (eigen zeilen of trainen niet).
  const inMonth = active(trips)
    .filter((x) => x.salary || (x.organisation && x.organisation !== 'eigen'))
    .map((x) => ({ trip: x, view: weekView(x, legs) }))
    .filter((e) => e.view.startDate && e.view.endDate && e.view.startDate <= `${month}-31` && e.view.endDate >= `${month}-01`)
    .sort((a, b) => a.view.startDate.localeCompare(b.view.startDate))
  if (inMonth.length === 0) return null
  return (
    <div className="month-salaries stack-sm">
      <h2 className="small-heading">{t('salary.thisMonth')}</h2>
      <ul className="plain-list">
        {inMonth.map(({ trip }) => {
          const state = salaryState(trip, legs, today)
          return (
            <li key={trip.id}>
              <button type="button" className="row month-salary" onClick={() => setEditing(trip)}>
                <SalaryDot state={state} />
                <span className="grow">{nameWithCounter(trip, counters.get(trip.id))}</span>
                <span className="muted small">{salaryStateLabel(state)}</span>
                {showAmounts && trip.salary && <span className="num small">{salaryAmountText(trip, transactions)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {editing && <TripSalarySheet store={store} trip={editing} notify={notify} onClose={() => setEditing(null)} />}
    </div>
  )
}
