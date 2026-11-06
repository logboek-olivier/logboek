import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { formatDate, formatMoney } from '../format'
import { t } from '../i18n'
import { kindLabel } from '../i18n/labels'
import { nameWithCounter } from '../model/counters'
import { dayMoney } from '../model/day-money'
import { isIncome } from '../model/money'
import { eurValue } from '../model/rates'
import type { Transaction } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { TransactionView } from './Views'

// Agenda met "Toon bedragen": een tik op een dag met geld = de transacties van die dag met het netto bedrag (inkomsten
// min uitgaven, dezelfde regels als Geld, src/model/day-money.ts). Een tik op een transactie = bewerken. "Dag bekijken"
// opent de gewone dagkaart.

function signedText(tx: Transaction): string {
  const value = eurValue(tx)
  const sign = isIncome(tx.kind) ? '+' : '−'
  return value ? `${sign}${formatMoney(value.eur, 'EUR')}` : `${sign}${formatMoney(tx.amount, tx.currency)}`
}

export function totalText(eur: number, other: Record<string, { income: number; costs: number }>): string {
  const parts = [`${eur > 0 ? '+' : ''}${formatMoney(eur, 'EUR')}`]
  for (const [currency, o] of Object.entries(other)) {
    const net = Math.round((o.income - o.costs) * 100) / 100
    if (net !== 0) parts.push(`${net > 0 ? '+' : ''}${formatMoney(net, currency)}`)
  }
  return parts.join(' ')
}

export function DayMoneySheet({ store, notify, date, onDay, onClose }: { store: Store; notify: Notify; date: string; onDay: () => void; onClose: () => void }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const counters = useCounters(store)
  const [open, setOpen] = useState<Transaction | null>(null)
  const { list, totals } = dayMoney(transactions, date)
  if (open) return <TransactionView store={store} tx={open} notify={notify} editFirst onClose={() => setOpen(null)} />
  return (
    <Sheet title={formatDate(date)} kicker={t('dayMoney.kicker')} onClose={onClose}>
      <div className="stack day-money">
        {list.length === 0 && <p className="muted">{t('dayMoney.none')}</p>}
        <ul className="rows">
          {list.map((tx) => {
            const trip = trips.find((x) => x.id === tx.tripId)
            return (
              <li key={tx.id}>
                <button type="button" className="row-item row-button" onClick={() => setOpen(tx)}>
                  <span className="row-main">
                    <span>{tx.note?.trim() || kindLabel(tx.kind)}</span>
                    <span className="muted small">{[kindLabel(tx.kind), trip ? nameWithCounter(trip, counters.get(trip.id)) : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`num ${isIncome(tx.kind) ? 'positive' : 'negative'}`}>{signedText(tx)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {list.length > 0 && (
          <p className="row day-money-total">
            <strong className="grow">{t('dayMoney.net')}</strong>
            <strong className={`num ${totals.balanceEur >= 0 ? 'positive' : 'negative'}`}>{totalText(totals.balanceEur, totals.other)}</strong>
          </p>
        )}
        <button type="button" className="btn" onClick={onDay}>
          <Icon icon={CalendarDays} />
          {t('dayMoney.openDay')}
        </button>
      </div>
    </Sheet>
  )
}
