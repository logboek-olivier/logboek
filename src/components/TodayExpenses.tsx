import { Eye, EyeOff, Plus } from 'lucide-react'
import { Suspense, useState, useSyncExternalStore } from 'react'
import { formatMoney } from '../format'
import { t } from '../i18n'
import { expenseTotal, expensesOn } from '../model/today-expenses'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import type { Transaction } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { useCollection } from './useCollection'
import { lazyComponent } from '../lazy'

// Vandaag: de uitgaven van vandaag (november 2026, op verzoek van Olivier: zo ziet hij of hij iets vergat te loggen).
// Het aantal en de laatste drie (soort of omschrijving) staan er direct; het totaal en de bedragen pas na "Toon
// bedragen", omdat Vandaag ook open staat als studenten meekijken. Geboekte vaste lasten tellen niet mee (die staan op de
// laatste dag van de maand en zijn geen uitgave van vandaag).

const TransactionView = lazyComponent(() => import('./Views').then((m) => m.TransactionView))

function label(tx: Transaction): string {
  return tx.note?.trim() || t(`costCategory.${tx.category ?? 'overig'}`)
}

export function TodayExpenses({ store, today, notify, onAdd }: { store: Store; today: string; notify: Notify; onAdd: () => void }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState<Transaction | null>(null)
  const list = expensesOn(transactions, today)
  const total = expenseTotal(list)
  const totalText = [formatMoney(total.eur, 'EUR'), ...Object.entries(total.other).map(([c, v]) => formatMoney(v, c))].join(' + ')
  return (
    <div className="section card card-body stack-sm today-expenses">
      <div className="section-head">
        <h2>{t('today.expenses', { n: list.length })}</h2>
        {list.length > 0 && (
          <button type="button" className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
            <Icon icon={shown ? EyeOff : Eye} />
            {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
          </button>
        )}
      </div>
      {list.length > 0 && (
        <ul className="plain-list today-expense-list">
          {list.slice(0, 3).map((tx) => (
            <li key={tx.id}>
              <button type="button" className="row row-button" onClick={() => setOpen(tx)}>
                <span className="grow">{label(tx)}</span>
                {shown && <span className="num">{eurValue(tx) ? formatMoney(eurValue(tx)!.eur, 'EUR') : formatMoney(tx.amount, tx.currency)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 3 && <p className="muted small">{t('today.expensesMore', { n: list.length - 3 })}</p>}
      {shown && list.length > 0 && (
        <p className="row today-expense-total">
          <strong className="grow">{t('today.expensesTotal')}</strong>
          <strong className="num">{totalText}</strong>
        </p>
      )}
      <button type="button" className="btn" onClick={onAdd}>
        <Icon icon={Plus} />
        {t('today.addExpense')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <TransactionView store={store} tx={open} notify={notify} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </div>
  )
}
