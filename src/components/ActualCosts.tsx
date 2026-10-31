import { Receipt } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { formatMoney, formatMonthShort } from '../format'
import { t } from '../i18n'
import { actualCosts } from '../model/actual-costs'
import { getRates, subscribeRates } from '../model/rates'
import { todayIso } from '../model/types'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

/** Geld → Werkelijk: kosten per maand (vaste lasten geboekt, losse kosten, weekschatting). */
export function ActualCostsSection({ store }: { store: Store }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  const closings = useCollection(store, 'weekreviews.json.enc')
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const rows = actualCosts(transactions, closings, todayIso(), rates)
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
            <th className="num">{t('actual.week')}</th>
            <th className="num">{t('actual.total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{formatMonthShort(r.month)}</td>
              <td className="num">{formatMoney(r.fixedEur, 'EUR')}</td>
              <td className="num">{formatMoney(r.looseEur, 'EUR')}</td>
              <td className="num">{formatMoney(r.weekEur, 'EUR')}</td>
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
