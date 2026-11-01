import { Receipt } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { formatMoney, formatMonthShort } from '../format'
import { t } from '../i18n'
import { actualCosts } from '../model/actual-costs'
import { getRates, subscribeRates } from '../model/rates'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'
import { todayIso } from '../basis/datum'

/** Geld → Werkelijk: kosten per maand (vaste lasten geboekt en losse kosten). */
export function ActualCostsSection({ store }: { store: Store }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  // Opnieuw tekenen zodra de koersen er zijn (eurOf rekent met de koersen van dat moment).
  useSyncExternalStore(subscribeRates, getRates)
  const rows = actualCosts(transactions, todayIso())
  if (rows.length === 0) return null
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
              <td>{formatMonthShort(r.month)}</td>
              <td className="num">{formatMoney(r.fixedEur, 'EUR')}</td>
              <td className="num">{formatMoney(r.looseEur, 'EUR')}</td>
              <td className="num">
                <strong>{formatMoney(r.totalEur, 'EUR')}</strong>
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
