import { tripKind } from '../model/trip-kind'
import { ChevronRight, Eye, EyeOff } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { formatMoney } from '../format'
import { t } from '../i18n'
import { claimCounts, tripClaims } from '../model/claims'
import { active } from '../model/derive'
import { totals } from '../model/money'
import type { MoneySum } from '../model/money-path'
import { tripResult, type TripResult } from '../domain/geldrapport'
import { booked } from '../domain/geldmodel'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import type { Trip } from '../model/types'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { SalaryDot, salaryAmountText, salaryStateLabel, tripSalary } from './MoneyPath'
import { useCollection } from './useCollection'
import { todayIso } from '../basis/datum'

// Geld van één tocht, verborgen tot Olivier op "Toon bedragen" tikt (studenten kijken mee): het resultaat van de tocht
// (de som van zijn transacties: salaris + fooi + overige inkomsten − uitgaven, kan negatief zijn), inkomsten en uitgaven
// en het salaris met zijn status (src/domain/geldmodel.ts). In "Trip bewerken" daarnaast het salaris (tik = bewerken) en
// de fooien en inkomsten van de tocht, met toevoegen.

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
 * Inkomsten en uitgaven van de tocht (Deze trip en het tripoverzicht), verborgen tot "Toon bedragen": het resultaat van
 * de tocht, inkomsten en uitgaven, en het salaris met zijn status.
 */
export function TripMoneySection({ store, trip, heading = 'h2' }: { store: Store; trip: Trip; heading?: 'h2' | 'h3' }) {
  const all = useCollection(store, 'transactions.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const claims = tripClaims(useCollection(store, 'claims.json.enc'), trip.id)
  const counts = claimCounts(claims)
  const own = active(all).filter((tx) => tx.tripId === trip.id)
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  const { salary, state } = tripSalary(trip, legs, all, todayIso())
  if (own.length === 0) return null
  const real = booked(own)
  const sum = totals(real)
  const provisional = own.some((tx) => eurValue(tx)?.provisional)
  const Heading = heading
  const salaryText = salary ? (state === null ? t('salaryStatus.geen') : t('salary.lineShort', { amount: salaryAmountText(trip, all), status: salaryStateLabel(state) })) : ''
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
          <TripResultLines result={tripResult(trip, all)} work={tripKind(trip, legs).kind === 'werk'} />
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
              <span>{salaryText}</span>
            </p>
          )}
          {claims.length > 0 && <p className="muted small">{t('claims.counts', { open: counts.open, submitted: counts.ingediend, repaid: counts.terugbetaald })}</p>}
        </div>
      ) : (
        <p className="muted small">
          <Icon icon={ChevronRight} />
          {[real.length > 0 ? t('week.amountsHidden', { n: real.length }) : '', salary ? t('salary.hiddenLine', { status: state === null ? t('salaryStatus.geen') : salaryStateLabel(state) }) : ''].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}
