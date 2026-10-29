import { Eye, EyeOff, TrendingUp } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { formatMoney, formatMonth, formatMonthShort } from '../format'
import { t } from '../i18n'
import { getRates, subscribeRates } from '../model/rates'
import { salaryOutlook } from '../model/salary'
import { todayIso } from '../model/types'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

// Geld → Vooruitblik: per maand het verwachte en het ontvangen salaris, en het totaal tot het einde van de planning.
// Optioneel een geschatte fooi (gemiddelde per trip van de organisatie), duidelijk apart van het salaris. Alles in
// euro; bedragen pas na "Toon bedragen".

export function SalaryOutlook({ store }: { store: Store }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  const [tips, setTips] = useState(false)
  const any = trips.some((x) => x.deletedAt === null && x.salary) || transactions.some((tx) => tx.deletedAt === null && tx.kind === 'loon')
  if (!any) return null
  const o = salaryOutlook(trips, legs, transactions, todayIso(), rates)
  const expectedTrips = o.months.reduce((n, m) => n + m.trips.length, 0)
  const until = formatMonth(o.until)
  const hasTips = Object.keys(o.tipAverages).length > 0
  return (
    <div className="section card card-body outlook">
      <div className="section-head">
        <h2>
          <Icon icon={TrendingUp} />
          {t('outlook.title')}
        </h2>
        <button className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {!shown ? (
        <p className="muted small">{t('outlook.hidden', { n: expectedTrips, month: until })}</p>
      ) : (
        <>
          <p className="outlook-total">{t('outlook.until', { month: until, amount: formatMoney(o.expectedEur, 'EUR') })}</p>
          {Object.entries(o.other).map(([c, v]) => (
            <p key={c} className="muted small">
              {t('money.noRateFor', { currency: c })}: {formatMoney(v, c)}
            </p>
          ))}
          {hasTips && (
            <label className="check">
              <input type="checkbox" checked={tips} onChange={(e) => setTips(e.target.checked)} />
              {t('outlook.showTips')}
            </label>
          )}
          <table className="table outlook-table">
            <thead>
              <tr>
                <th>{t('money.month')}</th>
                <th className="num">{t('outlook.expected')}</th>
                <th className="num">{t('outlook.received')}</th>
                {tips && <th className="num estimate">{t('outlook.tipEstimate')}</th>}
              </tr>
            </thead>
            <tbody>
              {o.months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                  </td>
                  <td className="num">{m.expectedEur > 0 ? formatMoney(m.expectedEur, 'EUR') : '–'}</td>
                  <td className="num">{m.receivedEur > 0 ? formatMoney(m.receivedEur, 'EUR') : '–'}</td>
                  {tips && <td className="num estimate">{m.tipEstimateEur > 0 ? `≈ ${formatMoney(m.tipEstimateEur, 'EUR')}` : '–'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {tips && (
            <p className="muted small estimate-note">
              {t('outlook.tipTotal', { month: until, amount: formatMoney(o.tipEstimateEur, 'EUR') })} {t('outlook.tipNote')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
