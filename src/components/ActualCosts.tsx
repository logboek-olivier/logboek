import { Receipt } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { formatDate, formatMoney, formatMonth, formatMonthShort } from '../format'
import { t } from '../i18n'
import { actualCostsDrill } from '../domain/doorklik'
import { actualCosts } from '../model/actual-costs'
import type { Period } from '../model/position'
import type { DrillRequest } from './DrillSheet'
import { getRates, subscribeRates } from '../model/rates'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'
import { todayIso } from '../basis/datum'

/**
 * Geld → Werkelijk: kosten per maand (vaste lasten geboekt en losse kosten) in de periode bovenaan Geld. Elk bedrag
 * opent de uitgaven eronder (per maand en per kolom).
 */
export function ActualCostsSection({ store, period, onDrill }: { store: Store; period: Period; onDrill: (request: DrillRequest) => void }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  // Opnieuw tekenen zodra de koersen er zijn (eurOf rekent met de koersen van dat moment).
  useSyncExternalStore(subscribeRates, getRates)
  const rows = actualCosts(transactions, todayIso(), 6, period)
  if (rows.length === 0) return null
  const periodText = t('drill.period', { from: formatDate(period.from), to: formatDate(period.to) })
  const cell = (month: string, column: 'vast' | 'los' | 'totaal', eur: number, strong = false) => {
    const label = `${formatMonth(month)} · ${t(column === 'vast' ? 'actual.fixed' : column === 'los' ? 'actual.loose' : 'actual.total')}`
    const text = formatMoney(eur, 'EUR')
    return (
      <button type="button" className="tap-cell" aria-label={`${label}: ${text}`} onClick={() => onDrill({ title: label, drill: actualCostsDrill(transactions, trips, month, column, period), period: periodText, hint: column === 'vast' ? t('actual.fixedHint') : undefined })}>
        {strong ? <strong>{text}</strong> : text}
      </button>
    )
  }
  return (
    <div className="section card card-body stack-sm actual-costs">
      <div className="section-head">
        <h2>
          <Icon icon={Receipt} />
          {t('actual.title')}
        </h2>
      </div>
      <p className="muted small">{t('actual.fixedHint')}</p>
      <table className="table">
        <thead>
          <tr>
            <th>{t('money.month')}</th>
            <th className="num">{t('actual.fixed')}</th>
            <th className="num">{t('actual.loose')}</th>
            <th className="num">{t('actual.total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>
                {formatMonthShort(r.month)} {r.month.slice(2, 4)}
              </td>
              <td className="num">{cell(r.month, 'vast', r.fixedEur)}</td>
              <td className="num">{cell(r.month, 'los', r.looseEur)}</td>
              <td className="num">
                {cell(r.month, 'totaal', r.totalEur, true)}
                {Object.entries(r.other).map(([c, v]) => (
                  <span key={c} className="muted small">
                    {' '}
                    + {formatMoney(v, c)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
