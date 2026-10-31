import { tripKind } from '../model/trip-kind'
import { ChevronDown, ChevronRight, ChevronUp, Coins, Eye, EyeOff, Plus } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { formatDate, formatMoney } from '../format'
import { t } from '../i18n'
import { kindLabel } from '../i18n/labels'
import { claimCounts, tripClaims } from '../model/claims'
import { active } from '../model/derive'
import { totals } from '../model/money'
import { tripMoney, tripResult, type MoneySum, type TripResult } from '../model/money-path'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { tripEnd } from '../model/salary'
import { currentSettings } from '../model/settings'
import { CURRENCIES, type Currency, type IncomeKind, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { SalaryDot, salaryAmountText, salaryStateLabel } from './MoneyPath'
import { useCollection } from './useCollection'
import { geldToevoegen } from '../domain/geld'
import { parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'
import { sourceForPeriod } from '../basis/organisatie'

// Geld van één trip, verborgen tot Olivier op "Toon bedragen" tikt (studenten kijken mee): inkomsten en uitgaven, het
// resultaat van de trip (salaris + fooi + overige inkomsten − uitgaven, kan negatief zijn; declaraties die nog niet
// terugbetaald zijn apart), het geldpad (salaris verwacht, te ontvangen of ontvangen; fooi contant, bank of onbekend).
// In "Trip bewerken" daarnaast de fooien en inkomsten van de trip, met toevoegen.

/** "€ 1.250,00", met wat zonder koers per valuta blijft erachter. */
export function sumText(sum: MoneySum, sign = false): string {
  const parts = [sum.eur !== 0 || Object.keys(sum.other).length === 0 ? formatMoney(sum.eur, 'EUR') : '', ...Object.entries(sum.other).map(([c, v]) => formatMoney(v, c))].filter(Boolean)
  const text = parts.join(' + ')
  return sign && sum.eur > 0 ? `+${text}` : text
}

const hasAmount = (sum: MoneySum) => sum.eur !== 0 || Object.keys(sum.other).length > 0

/** Het resultaat van een trip als regels: salaris, fooi, overige inkomsten, uitgaven, en het resultaat. */
export function TripResultLines({ result, work = true }: { result: TripResult; /** Training of plezier: geen regels voor salaris en fooi zonder bedrag. */ work?: boolean }) {
  const negative = result.result.eur < 0
  return (
    <div className="stack-sm trip-result">
      <p className="row">
        <strong className="grow">{t('tripResult.title')}</strong>
        <strong className={`num ${negative ? 'negative' : 'positive'}`}>{sumText(result.result)}</strong>
      </p>
      <ul className="plain-list">
        {(work || hasAmount(result.salary)) && (
          <li className="row muted small">
            <span className="grow">{t(result.salaryExpected ? 'tripResult.salaryExpected' : 'tripResult.salary')}</span>
            <span className="num">{sumText(result.salary)}</span>
          </li>
        )}
        {(work || hasAmount(result.tips)) && (
          <li className="row muted small">
            <span className="grow">{t('tripResult.tips')}</span>
            <span className="num">{sumText(result.tips)}</span>
          </li>
        )}
        {hasAmount(result.otherIncome) && (
          <li className="row muted small">
            <span className="grow">{t('tripResult.otherIncome')}</span>
            <span className="num">{sumText(result.otherIncome)}</span>
          </li>
        )}
        <li className="row muted small">
          <span className="grow">{t('tripResult.costs')}</span>
          <span className="num">−{sumText(result.costs)}</span>
        </li>
      </ul>
      {hasAmount(result.openClaims) && <p className="muted small">{t('tripResult.openClaims', { amount: sumText(result.openClaims) })}</p>}
    </div>
  )
}

/**
 * Inkomsten en uitgaven van de trip (Deze trip en het tripoverzicht), verborgen tot "Toon bedragen": het resultaat van
 * de trip, inkomsten en uitgaven, het salaris met zijn status en de fooi naar contant, bank en onbekend.
 */
export function TripMoneySection({ store, trip, heading = 'h2' }: { store: Store; trip: Trip; heading?: 'h2' | 'h3' }) {
  const all = useCollection(store, 'transactions.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const claims = tripClaims(useCollection(store, 'claims.json.enc'), trip.id)
  const counts = claimCounts(claims)
  const transactions = all.filter((tx) => tx.deletedAt === null && tx.tripId === trip.id)
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  const salary = trip.salary
  if (transactions.length === 0 && !salary) return null
  const path = tripMoney(trip, legs, all, todayIso())
  const state = path.salary?.state ?? null
  const tipParts = (['contant', 'bank', 'onbekend'] as const)
    .map((via) => ({ via, sum: path.tips[via] }))
    .filter((p) => p.sum.eur > 0 || Object.keys(p.sum.other).length > 0)
    .map((p) => `${t(`tipVia.${p.via}`)} ${[p.sum.eur > 0 ? formatMoney(p.sum.eur, 'EUR') : '', ...Object.entries(p.sum.other).map(([c, v]) => formatMoney(v, c))].filter(Boolean).join(' + ')}`)
  const sum = totals(transactions)
  const provisional = transactions.some((tx) => eurValue(tx)?.provisional)
  const Heading = heading
  return (
    <div className="section">
      <div className="section-head">
        <Heading>{t('week.money')}</Heading>
        <button className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {shown ? (
        <div className="stack-sm">
          <TripResultLines result={tripResult(trip, legs, all, rates)} work={tripKind(trip, legs).kind === 'werk'} />
          <dl className="grid">
            <div className="stat">
              <dt>{t('week.income')}</dt>
              <dd>{formatMoney(sum.incomeEur, 'EUR')}</dd>
            </div>
            <div className="stat">
              <dt>{t('week.costs')}</dt>
              <dd>{formatMoney(sum.costsEur, 'EUR')}</dd>
            </div>
          </dl>
          {Object.entries(sum.other).map(([c, v]) => (
            <p key={c} className="muted small">
              {t('money.noRateFor', { currency: c })}: +{formatMoney(v.income, c)} −{formatMoney(v.costs, c)}
            </p>
          ))}
          {provisional && <p className="muted small">{t('money.provisionalHint')}</p>}
          {salary && (
            <p className="salary-line row">
              <SalaryDot state={state} />
              <span>
                {salary.status === 'geen'
                  ? t('salaryStatus.geen')
                  : t('salary.line', { amount: salaryAmountText(trip, all), status: salaryStateLabel(state), source: t(salary.source === 'standaard' ? 'salary.sourceStandard' : 'salary.sourceOwn') })}
              </span>
            </p>
          )}
          {tipParts.length > 0 && <p className="muted small">{t('tipVia.line', { parts: tipParts.join(' · ') })}</p>}
          {claims.length > 0 && <p className="muted small">{t('claims.counts', { open: counts.open, submitted: counts.ingediend, repaid: counts.terugbetaald })}</p>}
        </div>
      ) : (
        <p className="muted small">
          <Icon icon={ChevronRight} />
          {[transactions.length > 0 ? t('week.amountsHidden', { n: transactions.length }) : '', salary ? t('salary.hiddenLine', { status: salary.status === 'geen' ? t('salaryStatus.geen') : salaryStateLabel(state) }) : ''].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

const INCOME_KINDS = ['fooi', 'bonus', 'overig-inkomen'] as const satisfies readonly IncomeKind[]

/** Datum voor een nieuwe fooi of inkomst bij een trip: vandaag als die in de trip valt, anders de dichtstbijzijnde dag ervan. */
function dateForTrip(trip: Trip, end: string, today: string): string {
  if (end && today > end) return end
  if (trip.startDate && today < trip.startDate) return trip.startDate
  return today
}

/**
 * In "Trip bewerken", naast het salaris: de fooien en overige inkomsten van de trip en het resultaat, ingeklapt (geen
 * bedragen zonder erom te vragen), met "Toevoegen" (bedrag, soort, valuta; de datum valt binnen de trip). Toevoegen
 * slaat direct op, los van de rest van het formulier, met ongedaan maken.
 */
export function TripIncomeFields({ store, trip, notify }: { store: Store; trip: Trip; notify: Notify }) {
  const all = useCollection(store, 'transactions.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<(typeof INCOME_KINDS)[number]>('fooi')
  const [currency, setCurrency] = useState<Currency>(settings.lastCurrency)
  const [busy, setBusy] = useState(false)
  const income = active(all)
    .filter((tx) => tx.tripId === trip.id && (tx.kind === 'fooi' || tx.kind === 'bonus' || tx.kind === 'overig-inkomen' || tx.kind === 'loon'))
    .sort((a, b) => a.date.localeCompare(b.date))
  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0

  async function add() {
    if (!valid || busy) return
    setBusy(true)
    try {
      const date = dateForTrip(trip, tripEnd(trip, legs), todayIso())
      const { undo } = await geldToevoegen(store, { date, amount: parsed!, currency, kind, source: sourceForPeriod(trip), ...(kind === 'fooi' ? { tipVia: settings.lastTipVia ?? 'contant' } : {}) }, trip.id)
      setAmount('')
      notify(t('tripIncome.saved'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="salary-fields trip-income">
      <button type="button" className="btn quiet disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon icon={Coins} />
        <span className="grow">{t('tripIncome.title')}</span>
        <span className="muted small">{t('tripIncome.count', { n: income.length })}</span>
        <Icon icon={open ? ChevronUp : ChevronDown} />
      </button>
      {open && (
        <div className="stack-sm">
          <TripResultLines result={tripResult(trip, legs, all, rates)} work={tripKind(trip, legs).kind === 'werk'} />
          {income.length > 0 && (
            <ul className="plain-list">
              {income.map((tx) => (
                <li key={tx.id} className="row small">
                  <span className="grow">
                    {kindLabel(tx.kind)} <span className="muted">· {formatDate(tx.date)}</span>
                  </span>
                  <span className="num">{formatMoney(tx.amount, tx.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="type-buttons" role="radiogroup" aria-label={t('tripIncome.kind')}>
            {INCOME_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="grow">
              {t('field.amount')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  // Enter voegt deze inkomst toe en slaat niet de hele trip op.
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void add()
                  }
                }}
              />
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
          <button type="button" className="btn small" disabled={!valid || busy} onClick={() => void add()}>
            <Icon icon={Plus} />
            {t('tripIncome.add')}
          </button>
          <p className="muted small">{t('tripIncome.hint')}</p>
        </div>
      )}
    </fieldset>
  )
}
