import { t } from '../i18n'
import { CostForm, IncomeForm } from '../screens/QuickAdd'
import type { Store } from '../storage/store'
import { ClaimForm } from './Claims'
import type { Notify } from './EditSheets'
import { Sheet } from './Sheet'

// "+ Uitgave", "+ Inkomsten" en "+ Declaratie" direct vanaf de periodepagina: hetzelfde formulier als onder +, met de
// periode al gekozen.

export type MoneyAdd = 'uitgave' | 'inkomsten' | 'declaratie'

export function PeriodMoneyAddSheet({ store, what, periodId, title, onClose, notify }: { store: Store; what: MoneyAdd; periodId: string; title: string; onClose: () => void; notify: Notify }) {
  const done = (message: string) => {
    notify(message)
    onClose()
  }
  const heading = what === 'uitgave' ? t('period.addExpense') : what === 'inkomsten' ? t('period.addIncome') : t('period.addClaim')
  return (
    <Sheet title={`${heading} · ${title}`} onClose={onClose}>
      {what === 'uitgave' && <CostForm store={store} onDone={done} tripId={periodId} />}
      {what === 'inkomsten' && <IncomeForm store={store} onDone={done} tripId={periodId} />}
      {what === 'declaratie' && <ClaimForm store={store} onDone={done} tripId={periodId} />}
    </Sheet>
  )
}
