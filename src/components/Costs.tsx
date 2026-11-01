import { Plus, Receipt, Trash2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatMoney, formatMonth } from '../format'
import { t } from '../i18n'
import { buildIndex } from '../model/calendar'
import { cleanDefaults, dayAverages, fixedAmount, fixedInMonth } from '../model/costs'
import { active } from '../model/derive'
import { getRates, subscribeRates } from '../model/rates'
import { currentSettings } from '../model/settings'
import { COST_DAY_TYPES, CURRENCIES, type CostDayType, type Currency, type FixedCost } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { ViewRows } from './Views'
import { vasteLastenBoeken, vasteLastToevoegen, vasteLastVerwijderen, vasteLastWijzigen } from '../domain/geld'
import { instellingenOpslaan } from '../domain/instellingen'
import { amountInput, parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'

// Geld → Kosten (src/model/costs.ts): vaste lasten met een bedrag per maand dat vanaf een maand verandert, en de
// variabele kosten per dag per dagsoort: het eigen gemiddelde, of het standaardbedrag zolang er te weinig gegevens zijn.

export function CostsSection({ store, notify }: { store: Store; notify: Notify }) {
  const fixed = active(useCollection(store, 'fixedcosts.json.enc'))
  const transactions = useCollection(store, 'transactions.json.enc')
  const closings = useCollection(store, 'weekreviews.json.enc')
  const calendar = useCollection(store, 'calendar.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const today = todayIso()
  const stays = useCollection(store, 'periods.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs, [], stays), [calendar, trips, legs, stays])
  const averages = dayAverages(transactions, closings, index, today, settings, rates)
  const [viewing, setViewing] = useState<FixedCost | null>(null)
  const [adding, setAdding] = useState(false)
  const [defaults, setDefaults] = useState(false)
  const thisMonth = today.slice(0, 7)
  const perMonth = fixedInMonth(fixed, thisMonth, rates)

  return (
    <div className="section card card-body stack-sm costs">
      <div className="section-head">
        <h2>
          <Icon icon={Receipt} />
          {t('costs.title')}
        </h2>
      </div>
      <h3>{t('costs.fixed')}</h3>
      <p className="muted small">{t('actual.fixedHint')}</p>
      {fixed.length === 0 ? (
        <p className="muted small">{t('costs.noFixed')}</p>
      ) : (
        <ul className="plain-list">
          {fixed.map((c) => (
            <li key={c.id}>
              <button type="button" className="row cost-row" onClick={() => setViewing(c)}>
                <span className="grow">{c.name}</span>
                <span className="num">{t('costs.perMonth', { amount: formatMoney(fixedAmount(c, thisMonth), c.currency) })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {fixed.length > 0 && (
        <p className="row small">
          <span className="grow muted">{t('costs.fixedTotal')}</span>
          <strong className="num">
            {[formatMoney(perMonth.eur, 'EUR'), ...Object.entries(perMonth.other).map(([cur, v]) => formatMoney(v, cur))].join(' + ')}
          </strong>
        </p>
      )}
      <button type="button" className="btn small" onClick={() => setAdding(true)}>
        <Icon icon={Plus} />
        {t('costs.addFixed')}
      </button>
      <h3>{t('costs.variable')}</h3>
      <ul className="plain-list">
        {COST_DAY_TYPES.map((type) => {
          const a = averages[type]
          return (
            <li key={type} className="row small cost-day">
              <span className="grow">{t(`dayType.${type}`)}</span>
              <span className="muted">{a.source === 'geleerd' ? t('costs.learned', { n: a.days }) : a.source === 'standaard' ? t('costs.standard') : t('costs.unknown')}</span>
              <span className="num">{a.source === 'onbekend' ? '–' : t('costs.perDay', { amount: formatMoney(a.perDay, 'EUR') })}</span>
            </li>
          )
        })}
      </ul>
      <p className="muted small">{t('costs.variableHint')}</p>
      <button type="button" className="btn small" onClick={() => setDefaults(true)}>
        {t('costs.defaults')}
      </button>
      {viewing && <FixedCostView store={store} cost={viewing} notify={notify} onClose={() => setViewing(null)} />}
      {adding && <FixedCostSheet store={store} cost={null} notify={notify} onClose={() => setAdding(false)} />}
      {defaults && <DefaultsSheet store={store} notify={notify} onClose={() => setDefaults(false)} />}
    </div>
  )
}

/** Eén vaste last bekijken: het bedrag nu en de wijzigingen per maand; bewerken via het potlood. */
function FixedCostView({ store, cost, notify, onClose }: { store: Store; cost: FixedCost; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const current = useCollection(store, 'fixedcosts.json.enc').find((c) => c.id === cost.id) ?? cost
  if (editing) return <FixedCostSheet store={store} cost={current} notify={notify} onClose={onClose} />
  const month = todayIso().slice(0, 7)
  return (
    <Sheet title={current.name} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <p className="view-amount">{t('costs.perMonth', { amount: formatMoney(fixedAmount(current, month), current.currency) })}</p>
        <ViewRows rows={[...current.amounts].sort((a, b) => b.from.localeCompare(a.from)).map((a): [string, string] => [t('costs.from', { month: formatMonth(a.from) }), a.amount > 0 ? formatMoney(a.amount, current.currency) : t('costs.stopped')])} />
      </div>
    </Sheet>
  )
}

/** Een vaste last toevoegen of wijzigen: naam, bedrag per maand, valuta en vanaf welke maand. */
function FixedCostSheet({ store, cost, notify, onClose }: { store: Store; cost: FixedCost | null; notify: Notify; onClose: () => void }) {
  const month = todayIso().slice(0, 7)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [name, setName] = useState(cost?.name ?? '')
  const [amount, setAmount] = useState(cost ? amountInput(fixedAmount(cost, month)) : '')
  const [currency, setCurrency] = useState<Currency>(cost?.currency ?? settings.lastCurrency)
  const [from, setFrom] = useState(month)
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)
  const valid = name.trim() !== '' && parsed !== null && /^\d{4}-\d{2}$/.test(from)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      if (cost) {
        const undo = await vasteLastWijzigen(store, cost, { name, amount: parsed, from })
        onClose()
        notify(t('costs.saved'), undo)
      } else {
        await vasteLastToevoegen(store, { name, amount: parsed, currency, from })
        // Een vaste last vanaf een voorbije maand: die maanden staan direct als uitgave bij Werkelijk.
        await vasteLastenBoeken(store, todayIso())
        onClose()
        notify(t('costs.saved'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (!cost || busy) return
    const undo = await vasteLastWijzigen(store, cost, { amount: 0, from })
    onClose()
    notify(t('costs.stoppedToast', { month: formatMonth(from) }), undo)
  }

  async function remove() {
    if (!cost) return
    const undo = await vasteLastVerwijderen(store, cost)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={cost ? t('costs.edit') : t('costs.addFixed')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('costs.name')}
          <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={80} placeholder={t('costs.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          <label className="grow">
            {t('costs.amount')}
            <input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            {t('field.currency')}
            <select value={currency} disabled={cost !== null} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t('costs.fromMonth')}
          <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        {cost && <p className="muted small">{t('costs.fromHint')}</p>}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!valid || busy}>
            {t('common.save')}
          </button>
          {cost && (
            <button className="btn" type="button" disabled={busy || !/^\d{4}-\d{2}$/.test(from)} onClick={() => void stop()}>
              {t('costs.stop')}
            </button>
          )}
          {cost && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

/** Standaard variabele kosten per dag per dagsoort, zolang de app nog geen eigen gemiddelde heeft. */
function DefaultsSheet({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [values, setValues] = useState<Record<CostDayType, string>>(() => {
    const out = {} as Record<CostDayType, string>
    for (const type of COST_DAY_TYPES) {
      const v = settings.costDefaults?.[type]
      out[type] = typeof v === 'number' ? amountInput(v) : ''
    }
    return out
  })
  const parsed = Object.fromEntries(COST_DAY_TYPES.map((type) => [type, values[type].trim() === '' ? null : parseAmount(values[type])])) as Record<CostDayType, number | null>
  const invalid = COST_DAY_TYPES.some((type) => values[type].trim() !== '' && parsed[type] === null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (invalid) return
    await instellingenOpslaan(store, { costDefaults: cleanDefaults(parsed) })
    onClose()
    notify(t('costs.saved'))
  }

  return (
    <Sheet title={t('costs.defaults')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted small">{t('costs.defaultsHint')}</p>
        {COST_DAY_TYPES.map((type) => (
          <label key={type}>
            {t('costs.defaultFor', { type: t(`dayType.${type}`) })}
            <input type="text" inputMode="decimal" autoComplete="off" value={values[type]} onChange={(e) => setValues({ ...values, [type]: e.target.value })} />
          </label>
        ))}
        <button className="btn primary" type="submit" disabled={invalid}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
