import { ChevronDown, ChevronUp, Coins, Pencil, Plus, Receipt, TriangleAlert } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { geldToevoegen } from '../domain/geld'
import { salariesOf } from '../domain/geldmodel'
import { tripResult } from '../domain/geldrapport'
import { formatDate, formatMoney } from '../format'
import { t } from '../i18n'
import { kindLabel } from '../i18n/labels'
import { active } from '../model/derive'
import { kindForCategory } from '../model/expenses'
import { getRates, subscribeRates } from '../model/rates'
import { tripEnd } from '../model/salary'
import { currentSettings, defaultCurrency } from '../model/settings'
import { COST_CATEGORIES, CURRENCIES, type CostCategory, type Currency, type Transaction, type Trip } from '../model/types'
import { tripKind } from '../model/trip-kind'
import type { Store } from '../storage/store'
import { parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'
import { sourceForPeriod } from '../basis/organisatie'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { SalaryDot, salaryAmountText, salaryStateLabel, tripSalary, TripSalarySheet } from './MoneyPath'
import { TripResultLines } from './TripMoney'
import { useCollection } from './useCollection'
import { TransactionView } from './Views'

// Het geld van één tocht in "Trip bewerken" (CLAUDE.md, Zeilgeld): één blok met het salaris (één regel, tik = bewerken),
// de fooien en andere inkomsten en de kosten (elk een lijst: toevoegen, tik = bekijken en bewerken of verwijderen), en het
// resultaat eronder. Alles wordt direct opgeslagen, met ongedaan maken. Ingeklapt: geen bedragen zonder erom te vragen.

const INCOME = ['fooi', 'bonus', 'overig-inkomen'] as const

/** Datum voor nieuw geld bij een tocht: vandaag als die in de tocht valt, anders de dichtstbijzijnde dag ervan. */
function dateForTrip(trip: Trip, end: string, today: string): string {
  if (end && today > end) return end
  if (trip.startDate && today < trip.startDate) return trip.startDate
  return today
}

function AddLine({ store, trip, notify, mode }: { store: Store; trip: Trip; notify: Notify; mode: 'inkomsten' | 'kosten' }) {
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<(typeof INCOME)[number]>('fooi')
  // Per soort de laatst gebruikte valuta: een fooi apart van een uitgave.
  const [currency, setCurrency] = useState<Currency>(defaultCurrency(settings, mode === 'kosten' ? 'uitgave' : 'fooi'))
  const [category, setCategory] = useState<CostCategory>(settings.lastCostCategory ?? 'eten')
  const [date, setDate] = useState(() => dateForTrip(trip, tripEnd(trip, legs), todayIso()))
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0 && !!date

  async function add() {
    if (!valid || busy) return
    setBusy(true)
    try {
      const fields =
        mode === 'kosten'
          ? { date, amount: parsed!, currency, kind: kindForCategory(category), category, source: sourceForPeriod(trip) }
          : { date, amount: parsed!, currency, kind, source: sourceForPeriod(trip) }
      const { undo } = await geldToevoegen(store, fields, trip.id, mode === 'kosten' ? { lastCostCategory: category } : { lastIncomeKind: kind })
      setAmount('')
      notify(t(mode === 'kosten' ? 'tripMoney.costSaved' : 'tripIncome.saved'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm add-line">
      <div className="type-buttons" role="radiogroup" aria-label={t(mode === 'kosten' ? 'costs.category' : 'tripIncome.kind')}>
        {mode === 'kosten'
          ? COST_CATEGORIES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} className={`chip${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
                {t(`costCategory.${c}`)}
              </button>
            ))
          : INCOME.map((k) => (
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
              // Enter voegt dit bedrag toe en slaat niet de hele tocht op.
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
      <label>
        {t(mode === 'kosten' ? 'field.date' : 'tripMoney.receivedOn')}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button type="button" className="btn small" disabled={!valid || busy} onClick={() => void add()}>
        <Icon icon={Plus} />
        {t(mode === 'kosten' ? 'tripMoney.addCost' : 'tripIncome.add')}
      </button>
    </div>
  )
}

function MoneyRows({ list, onOpen }: { list: Transaction[]; onOpen: (tx: Transaction) => void }) {
  if (list.length === 0) return null
  return (
    <ul className="rows money-rows">
      {list.map((tx) => (
        <li key={tx.id}>
          <button type="button" className="row-item" onClick={() => onOpen(tx)}>
            <span className="row-main">
              <span className="row-title">{tx.note?.trim() || (tx.kind === 'kosten' || tx.kind === 'investering' ? t(`costCategory.${tx.category ?? 'overig'}`) : kindLabel(tx.kind))}</span>
              <span className="muted small">{formatDate(tx.date)}</span>
            </span>
            <span className="num">{formatMoney(tx.amount, tx.currency)}</span>
            <Icon icon={Pencil} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function TripMoneyBlock({ store, trip, notify }: { store: Store; trip: Trip; notify: Notify }) {
  const all = useCollection(store, 'transactions.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  useSyncExternalStore(subscribeRates, getRates)
  const [open, setOpen] = useState(false)
  const [salaryOpen, setSalaryOpen] = useState(false)
  const [viewing, setViewing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState<'inkomsten' | 'kosten' | null>(null)
  const own = active(all)
    .filter((tx) => tx.tripId === trip.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const salaries = salariesOf(trip.id, all)
  const { salary, state } = tripSalary(trip, legs, all, todayIso())
  const income = own.filter((tx) => tx.kind === 'fooi' || tx.kind === 'bonus' || tx.kind === 'overig-inkomen' || tx.kind === 'terugbetaling')
  const costs = own.filter((tx) => tx.kind === 'kosten' || tx.kind === 'investering')
  const work = tripKind(trip, legs).kind === 'werk'

  return (
    <fieldset className="trip-money">
      <button type="button" className="btn quiet disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon icon={Coins} />
        <span className="grow">{t('tripMoney.title')}</span>
        <span className="muted small">{t('tripMoney.count', { n: own.length })}</span>
        <Icon icon={open ? ChevronUp : ChevronDown} />
      </button>
      {open && (
        <div className="stack">
          {(work || salary) && (
            <div className="stack-sm">
              {salaries.length > 1 ? (
                <>
                  <p className="warning small">
                    <Icon icon={TriangleAlert} />
                    {t('tripMoney.multipleSalaries', { n: salaries.length })}
                  </p>
                  <MoneyRows list={salaries} onOpen={setViewing} />
                </>
              ) : (
                <button type="button" className="row-item salary-row" onClick={() => setSalaryOpen(true)}>
                  <SalaryDot state={state} />
                  <span className="row-main">
                    <span className="row-title">{t('salary.title')}</span>
                    <span className="muted small">{salary ? (state === null ? t('salaryStatus.geen') : t('salary.lineShort', { amount: salaryAmountText(trip, all) || t('tripMoney.noAmount'), status: salaryStateLabel(state) })) : t('salary.none')}</span>
                  </span>
                  <Icon icon={Pencil} />
                </button>
              )}
            </div>
          )}
          <div className="stack-sm">
            <h3 className="small-heading">{t('tripMoney.income')}</h3>
            <MoneyRows list={income} onOpen={setViewing} />
            {adding === 'inkomsten' ? (
              <AddLine store={store} trip={trip} notify={notify} mode="inkomsten" />
            ) : (
              <button type="button" className="btn small" onClick={() => setAdding('inkomsten')}>
                <Icon icon={Plus} />
                {t('tripMoney.addIncome')}
              </button>
            )}
          </div>
          <div className="stack-sm">
            <h3 className="small-heading">{t('tripMoney.costs')}</h3>
            <MoneyRows list={costs} onOpen={setViewing} />
            {adding === 'kosten' ? (
              <AddLine store={store} trip={trip} notify={notify} mode="kosten" />
            ) : (
              <button type="button" className="btn small" onClick={() => setAdding('kosten')}>
                <Icon icon={Receipt} />
                {t('tripMoney.addCost')}
              </button>
            )}
          </div>
          <TripResultLines result={tripResult(trip, all)} work={work} />
        </div>
      )}
      {salaryOpen && <TripSalarySheet store={store} trip={trip} notify={notify} onClose={() => setSalaryOpen(false)} />}
      {viewing && <TransactionView store={store} tx={viewing} notify={notify} onClose={() => setViewing(null)} />}
    </fieldset>
  )
}
