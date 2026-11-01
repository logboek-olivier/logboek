import { Ban, Check, Clock, Pencil, Wallet } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { defaultChanges, salaryQuestions } from '../model/salary'
import { asksPerTrip, payoutRule } from '../model/money-path'
import { currentSettings } from '../model/settings'
import { CURRENCIES, ORGANISATIONS, type Currency, type Organisation, type PayoutRule, type SalaryDefault, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { organisationLabel } from '../i18n/labels'
import { geenSalaris, salarisLaterVragen, salarisOntvangen, standaardsalarisOpslaan } from '../domain/geld'
import { instellingenOpslaan } from '../domain/instellingen'
import { amountInput, parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'

// Salaris: standaardbedrag per organisatie (Instellingen), en op Vandaag "Salaris van <trip> ontvangen?" na de
// einddatum. Vandaag toont geen bedragen; het werkelijke bedrag staat pas in het blad "Ander bedrag".

type Row = { amount: string; currency: Currency }
type PayoutRow = { kind: PayoutRule['kind']; day: string }

/** Instellingen → Salaris per organisatie. Een gewijzigd bedrag vraagt eerst of het ook voor komende trips geldt. */
export function SalaryDefaultsSheet({ store, onClose, notify }: { store: Store; onClose: () => void; notify: Notify }) {
  const settings = currentSettings(store.get('settings.json.enc'))
  const [rows, setRows] = useState<Record<Organisation, Row>>(() => {
    const out = {} as Record<Organisation, Row>
    for (const org of ORGANISATIONS) {
      const d = settings.salaryDefaults?.[org]
      out[org] = { amount: d ? amountInput(d.amount) : '', currency: d?.currency ?? 'EUR' }
    }
    return out
  })
  // Uitbetaling per organisatie: na elke trip (standaard) of maandelijks rond dag N voor de trips van de vorige maand.
  const [payouts, setPayouts] = useState<Record<Organisation, PayoutRow>>(() => {
    const out = {} as Record<Organisation, PayoutRow>
    for (const org of ORGANISATIONS) {
      const rule = payoutRule(settings, org)
      out[org] = { kind: rule.kind, day: rule.kind === 'maandelijks' ? String(rule.day) : '1' }
    }
    return out
  })
  const [asking, setAsking] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  function nextPayouts(): Partial<Record<Organisation, PayoutRule>> {
    const out: Partial<Record<Organisation, PayoutRule>> = {}
    for (const org of ORGANISATIONS) {
      const day = Math.round(Number(payouts[org].day))
      if (payouts[org].kind === 'maandelijks') out[org] = { kind: 'maandelijks', day: Number.isFinite(day) ? Math.min(28, Math.max(1, day)) : 1 }
    }
    return out
  }

  function next(): Partial<Record<Organisation, SalaryDefault>> {
    const out: Partial<Record<Organisation, SalaryDefault>> = {}
    for (const org of ORGANISATIONS) {
      const amount = parseAmount(rows[org].amount)
      if (amount !== null && amount > 0) out[org] = { amount, currency: rows[org].currency }
    }
    return out
  }

  async function save(alsoStale: boolean) {
    setBusy(true)
    try {
      await standaardsalarisOpslaan(store, next(), alsoStale, todayIso())
      await instellingenOpslaan(store, { payouts: nextPayouts() })
      onClose()
      notify(t('salary.saved'))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const changes = defaultChanges(store.list('trips.json.enc'), store.list('legs.json.enc'), settings, next(), todayIso())
    const stale = changes.reduce((n, c) => n + c.stale.length, 0)
    if (stale > 0) setAsking(stale)
    else void save(false)
  }

  return (
    <Sheet title={t('salary.defaults')} onClose={onClose}>
      {asking !== null ? (
        <div className="stack">
          <p>{t('salary.askStale', { n: asking })}</p>
          <p className="muted small">{t('salary.askStaleHint')}</p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save(true)}>
            {t('salary.yesAlso')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save(false)}>
            {t('salary.onlyNew')}
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="muted small">{t('salary.defaultsHint')}</p>
          {ORGANISATIONS.map((org) => (
            <div key={org} className="stack-sm salary-org">
              <div className="row">
                <label className="grow">
                  {organisationLabel(org)}
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={rows[org].amount}
                    onChange={(e) => setRows({ ...rows, [org]: { ...rows[org], amount: e.target.value } })}
                  />
                </label>
                <label>
                  {t('field.currency')}
                  <select aria-label={`${t('field.currency')}: ${organisationLabel(org)}`} value={rows[org].currency} onChange={(e) => setRows({ ...rows, [org]: { ...rows[org], currency: e.target.value as Currency } })}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="row payout-rule">
                <label className="grow">
                  {t('payout.rule')}
                  <select aria-label={`${t('payout.rule')}: ${organisationLabel(org)}`} value={payouts[org].kind} onChange={(e) => setPayouts({ ...payouts, [org]: { ...payouts[org], kind: e.target.value as PayoutRule['kind'] } })}>
                    <option value="per-trip">{t('payout.perTrip')}</option>
                    <option value="maandelijks">{t('payout.monthly')}</option>
                  </select>
                </label>
                {payouts[org].kind === 'maandelijks' && (
                  <label>
                    {t('payout.day')}
                    <input aria-label={`${t('payout.day')}: ${organisationLabel(org)}`} type="number" inputMode="numeric" min={1} max={28} value={payouts[org].day} onChange={(e) => setPayouts({ ...payouts, [org]: { ...payouts[org], day: e.target.value } })} />
                  </label>
                )}
              </div>
            </div>
          ))}
          <button className="btn primary" type="submit" disabled={busy}>
            {t('common.save')}
          </button>
        </form>
      )}
    </Sheet>
  )
}

/** Samenvatting voor de rij in Instellingen, zonder bedragen: voor welke organisaties een standaardbedrag staat. */
export function salaryDefaultsLine(store: Store): string {
  const defaults = currentSettings(store.get('settings.json.enc')).salaryDefaults ?? {}
  const orgs = ORGANISATIONS.filter((o) => (defaults[o]?.amount ?? 0) > 0)
  return orgs.length > 0 ? orgs.map((o) => organisationLabel(o)).join(', ') : t('salary.noDefaults')
}

/** Vandaag: "Salaris van <trip> ontvangen?" voor trips die voorbij zijn, zonder bedragen. */
export function SalaryQuestions({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const [other, setOther] = useState<Trip | null>(null)
  // Eén tik tegelijk: een tweede tik voordat het scherm bijgewerkt is, boekt het salaris niet nog eens.
  const [busy, setBusy] = useState(false)
  // Een organisatie die maandelijks uitbetaalt, krijgt één vraag per uitbetaling (PayoutQuestions), niet per trip.
  const questions = salaryQuestions(trips, legs, todayIso(), transactions)
    .filter((x) => asksPerTrip(settings, x))
    .slice(0, 3)
  if (questions.length === 0 && !other) return null
  return (
    <>
      {questions.map((trip) => {
        const name = nameWithCounter(trip, counters.get(trip.id))
        return (
          <div key={trip.id} className="card card-body stack-sm salary-question">
            <p className="row">
              <Icon icon={Wallet} />
              <span className="grow">{t('salary.question', { trip: name })}</span>
            </p>
            <div className="row wrap">
              <button
                type="button"
                className="btn small primary"
                disabled={busy}
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  try {
                    const undo = await salarisOntvangen(store, trip, todayIso())
                    notify(t('salary.receivedToast'), undo)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Icon icon={Check} />
                {t('salary.yes')}
              </button>
              <button type="button" className="btn small" onClick={() => setOther(trip)}>
                <Icon icon={Pencil} />
                {t('salary.otherAmount')}
              </button>
              <button
                type="button"
                className="btn small quiet"
                onClick={async () => {
                  const undo = await salarisLaterVragen(store, trip, todayIso())
                  notify(t('salary.laterToast'), undo)
                }}
              >
                <Icon icon={Clock} />
                {t('salary.notYet')}
              </button>
              <button
                type="button"
                className="btn small quiet"
                disabled={busy}
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  try {
                    const undo = await geenSalaris(store, trip)
                    notify(t('salary.noneToast'), undo)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Icon icon={Ban} />
                {t('salary.noneButton')}
              </button>
            </div>
          </div>
        )
      })}
      {other && <ReceiveSheet store={store} trip={other} notify={notify} onClose={() => setOther(null)} />}
    </>
  )
}

/** Het werkelijk ontvangen bedrag invullen (voorgevuld met het verwachte bedrag). */
function ReceiveSheet({ store, trip, notify, onClose }: { store: Store; trip: Trip; notify: Notify; onClose: () => void }) {
  const counters = useCounters(store)
  const s = trip.salary
  const [amount, setAmount] = useState(s ? amountInput(s.amount) : '')
  const [currency, setCurrency] = useState<Currency>(s?.currency ?? 'EUR')
  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0
  // Eén tik tegelijk: een tweede tik tijdens het opslaan boekt niets nog eens.
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const undo = await salarisOntvangen(store, trip, todayIso(), { amount: parsed, currency })
      onClose()
      notify(t('salary.receivedToast'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('salary.question', { trip: nameWithCounter(trip, counters.get(trip.id)) })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="row">
          <label className="grow">
            {t('salary.actual')}
            <input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
        <button className="btn primary" type="submit" disabled={!valid || busy}>
          <Icon icon={Check} />
          {t('salary.saveReceived')}
        </button>
      </form>
    </Sheet>
  )
}
