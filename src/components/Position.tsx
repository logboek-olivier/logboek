import { ChevronRight, Landmark, TrendingUp } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDate, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { getLang, t } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { isDebt, parseStand, setBalance } from '../model/accounts'
import { buildIndex, planningEnd } from '../model/calendar'
import { nameWithCounter } from '../model/counters'
import { careerStart, difference, forecast, positionAt, type AccountRow, type PositionInput, type Sum } from '../model/position'
import { dayAverages } from '../model/costs'
import { getRates, subscribeRates } from '../model/rates'
import { currentSettings, saveSettings } from '../model/settings'
import { todayIso, type Account, type Currency } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { LineChart } from './LineChart'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Geld → Mijn positie en de vooruitblik (src/model/position.ts). Een stand per rekening is hier in een paar seconden
// in te tikken (tik op de rekening); de import onder Meer → Rekeningen blijft optioneel.

function usePositionInput(store: Store): PositionInput {
  const accounts = useCollection(store, 'accounts.json.enc')
  const balances = useCollection(store, 'balances.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const rates = useSyncExternalStore(subscribeRates, getRates)
  return useMemo(() => ({ accounts, balances, trips, legs, transactions, rates }), [accounts, balances, trips, legs, transactions, rates])
}

/** € 1.234,00 plus wat zonder koers apart blijft ("+ $ 20,00"). */
function sumText(sum: Sum): string {
  const parts = [formatMoney(sum.eur, 'EUR'), ...Object.entries(sum.other).map(([c, v]) => formatMoney(v, c))]
  return parts.join(' + ') + (sum.provisional ? ` (${t('money.provisional')})` : '')
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatMoney(Math.abs(n), 'EUR')}`
}

export function PositionSection({ store, notify }: { store: Store; notify: Notify }) {
  const input = usePositionInput(store)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const [stand, setStand] = useState<Account | null>(null)
  const today = todayIso()
  const start = careerStart(settings)
  const now = positionAt(input, today)
  const then = positionAt(input, start, true)
  const since = today > start ? difference(now.totals.net, then.totals.net) : null
  const hasAccounts = input.accounts.some((a) => a.deletedAt === null)
  const empty = !hasAccounts && now.receivable.length === 0 && Object.keys(now.cashTips).length === 0
  if (empty) return null

  const accountRows = (rows: AccountRow[]) =>
    rows.map((row) => (
      <li key={row.account.id}>
        <button type="button" className="row position-account" onClick={() => setStand(row.account)}>
          <span className="grow">
            {row.account.name}
            <span className="muted small"> · {row.balance ? formatDate(row.balance.date) : t('position.noStand')}</span>
          </span>
          <span className="num">{row.balance ? formatMoney(row.balance.amount, row.account.currency) : '–'}</span>
          <Icon icon={ChevronRight} />
        </button>
      </li>
    ))

  return (
    <div className="section card card-body stack-sm position">
      <div className="section-head">
        <h2>
          <Icon icon={Landmark} />
          {t('position.title')}
        </h2>
      </div>
      <dl className="position-groups">
        <PositionGroup label={t('position.bank')} sum={now.totals.bank} show={now.bank.length > 0}>
          <ul className="plain-list">{accountRows(now.bank)}</ul>
        </PositionGroup>
        <PositionGroup label={t('position.cash')} sum={now.totals.cash} show={now.cashAccounts.length > 0 || Object.keys(now.cashTips).length > 0}>
          <ul className="plain-list">
            {accountRows(now.cashAccounts)}
            {(Object.entries(now.cashTips) as [Currency, number][]).map(([c, v]) => (
              <li key={c} className="row muted small">
                <span className="grow">{t('position.cashTips')}</span>
                <span className="num">{formatMoney(v, c)}</span>
              </li>
            ))}
          </ul>
        </PositionGroup>
        <PositionGroup label={t('position.receivable')} sum={now.totals.receivable} show={now.receivable.length > 0}>
          <ul className="plain-list">
            {now.receivable.map((r) => (
              <li key={r.trip.id} className="row muted small">
                <span className="grow">{t('position.salaryOf', { trip: nameWithCounter(r.trip, counters.get(r.trip.id)) })}</span>
                <span className="num">{formatMoney(r.amount, r.currency)}</span>
              </li>
            ))}
          </ul>
        </PositionGroup>
        <PositionGroup label={t('position.investments')} sum={now.totals.investments} show={now.investments.length > 0}>
          <ul className="plain-list">{accountRows(now.investments)}</ul>
        </PositionGroup>
        <PositionGroup label={t(now.debts.every((r) => r.account.provider === 'duo') ? 'position.studentDebt' : 'position.debts')} sum={now.totals.debts} show={now.debts.length > 0}>
          <ul className="plain-list">{accountRows(now.debts)}</ul>
        </PositionGroup>
      </dl>
      <div className="position-totals">
        <p className="row">
          <strong className="grow">{t('position.netAll')}</strong>
          <strong className={`num ${now.totals.net.eur >= 0 ? 'positive' : 'negative'}`}>{sumText(now.totals.net)}</strong>
        </p>
        {since !== null && (
          <p className="row">
            <span className="grow">{t('position.since', { date: formatDate(start) })}</span>
            <span className={`num ${since >= 0 ? 'positive' : 'negative'}`}>{signed(since)}</span>
          </p>
        )}
      </div>
      {!hasAccounts && <p className="muted small">{t('position.noAccounts')}</p>}
      {stand && <QuickStandSheet store={store} account={stand} notify={notify} onClose={() => setStand(null)} />}
    </div>
  )
}

function PositionGroup({ label, sum, show, children }: { label: string; sum: Sum; show: boolean; children: React.ReactNode }) {
  if (!show) return null
  return (
    <div className="position-group stack-sm">
      <div className="row">
        <dt className="grow">{label}</dt>
        <dd className="num">{sumText(sum)}</dd>
      </div>
      {children}
    </div>
  )
}

/** Een stand van vandaag in een paar seconden: alleen het bedrag. */
function QuickStandSheet({ store, account, notify, onClose }: { store: Store; account: Account; notify: Notify; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const value = parseStand(amount, getLang())
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (value === null || busy) return
    setBusy(true)
    try {
      const written = await setBalance(store, account, todayIso(), value)
      onClose()
      notify(written ? t('accounts.standSaved') : t('accounts.standNewer'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t('position.standTitle', { name: account.name })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t(isDebt(account) ? 'accounts.debtAmount' : 'accounts.standAmount')} ({account.currency})
          <input className="amount" type="text" inputMode="decimal" autoComplete="off" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <p className="muted small">{t('position.standHint', { date: formatDate(todayIso()) })}</p>
        <button className="btn primary" type="submit" disabled={value === null || busy}>
          {t('accounts.updateStand')}
        </button>
      </form>
    </Sheet>
  )
}

/**
 * Vooruitblik tot het einde van de planning: de netto waarde aan het einde ("≈"), wat de planning toevoegt, een grafiek
 * (gemeten doorgetrokken, verwacht gestippeld) en het verwachte salaris per uitbetaalmoment plus de geschatte fooi.
 */
export function ForecastSection({ store }: { store: Store }) {
  const input = usePositionInput(store)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const calendar = useCollection(store, 'calendar.json.enc')
  const fixed = useCollection(store, 'fixedcosts.json.enc')
  const closings = useCollection(store, 'weekreviews.json.enc')
  const counters = useCounters(store)
  const today = todayIso()
  const index = useMemo(() => buildIndex(calendar, input.trips, input.legs), [calendar, input.trips, input.legs])
  // Kosten: vaste lasten en per dagsoort het eigen gemiddelde (of het standaardbedrag) van de variabele kosten.
  const averages = dayAverages(input.transactions, closings, index, today, settings, input.rates)
  const f = forecast(input, settings, today, planningEnd(index), 6, { fixed, averages, index })
  if (f.items.length === 0 && f.months.every((m) => m.eur === null)) return null
  const until = formatMonth(f.until)
  // Maanden zonder gegevens aan het begin laten we weg (vóór de eerste stand is er niets te tekenen).
  const first = f.months.findIndex((m) => m.eur !== null)
  const months = first > 0 ? f.months.slice(first) : f.months
  return (
    <div className="section card card-body stack-sm forecast">
      <div className="section-head">
        <h2>
          <Icon icon={TrendingUp} />
          {t('forecast.title')}
        </h2>
      </div>
      {f.endEur !== null ? <p className="forecast-end">{t('forecast.end', { month: until, amount: formatMoney(f.endEur, 'EUR') })}</p> : <p className="muted small">{t('forecast.noRate')}</p>}
      <p className="row">
        <span className="grow">{t('forecast.adds')}</span>
        <strong className="num">{signed(f.addsEur)}</strong>
      </p>
      {f.tipEstimateEur > 0 && <p className="muted small">{t('forecast.tipPart', { amount: formatMoney(f.tipEstimateEur, 'EUR') })}</p>}
      {f.costsEur < 0 && <p className="muted small">{t('forecast.costsPart', { amount: formatMoney(-f.costsEur, 'EUR') })}</p>}
      {f.costsUnknown && <p className="muted small">{t('forecast.costsUnknown')}</p>}
      <LineChart
        points={months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), value: m.eur, future: m.future }))}
        label={`${t('forecast.chart')}: ${months.map((m) => `${formatMonth(m.month)} ${m.eur === null ? '–' : formatMoney(m.eur, 'EUR')}${m.future ? ` (${t('forecast.expected')})` : ''}`).join(', ')}`}
        format={(n) => formatMoneyShort(n)}
        labelEvery={months.length > 8 ? 2 : 1}
      />
      <ul className="legend">
        <li>
          <span className="swatch line" /> {t('forecast.measured')}
        </li>
        <li>
          <span className="swatch line dashed" /> {t('forecast.expected')}
        </li>
      </ul>
      {f.items.length > 0 && (
        <ul className="plain-list forecast-items">
          {f.items.map((item, i) => (
            <li key={i} className="row small">
              <span className="muted">{formatDate(item.date)}</span>
              <span className="grow">
                {item.kind === 'salaris'
                  ? t('forecast.salary', { org: item.org ? organisationLabel(item.org) : t('forecast.noOrg'), n: item.trips.length })
                  : item.kind === 'fooi'
                    ? t('forecast.tip', { trip: nameWithCounter(item.trips[0]!, counters.get(item.trips[0]!.id)) })
                    : item.kind === 'vaste-lasten'
                      ? t('forecast.fixed', { month: formatMonth(item.date.slice(0, 7)) })
                      : t('forecast.variable', { month: formatMonth(item.date.slice(0, 7)) })}
              </span>
              <span className={`num${item.kind === 'fooi' || item.kind === 'kosten' ? ' muted' : ''}${item.eur < 0 ? ' negative' : ''}`}>{item.eur < 0 ? `−${formatMoney(-item.eur, 'EUR')}` : formatMoney(item.eur, 'EUR')}</span>
            </li>
          ))}
        </ul>
      )}
      {Object.entries(f.other).map(([c, v]) => (
        <p key={c} className="muted small">
          {t('money.noRateFor', { currency: c })}: {formatMoney(v, c)}
        </p>
      ))}
    </div>
  )
}

/** Instellingen → Start zeilcarrière: de datum voor "Sinds …" in Mijn positie. */
export function CareerStartSheet({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [date, setDate] = useState(careerStart(settings))
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    await saveSettings(store, { careerStart: date })
    void store.sync()
    onClose()
    notify(t('toast.saved'))
  }
  return (
    <Sheet title={t('position.careerStart')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('position.careerStartDate')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small">{t('position.careerStartHint')}</p>
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
