import { CalendarRange } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { eerderSeizoenInvoeren, seasonDate, type SeasonAmount } from '../domain/geld'
import { formatDate } from '../format'
import { t } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { salaryDefault } from '../model/salary'
import { currentSettings, defaultCurrency } from '../model/settings'
import { CURRENCIES, type Currency, type Organisation } from '../model/types'
import type { Store } from '../storage/store'
import { parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'
import { organisationChoices } from '../basis/organisatie'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Geld → "Eerder seizoen" (CLAUDE.md, Zeilgeld): voor geld van een eerder seizoen waarvan Olivier niet meer weet bij welke
// tocht het hoort. Organisatie, jaar en drie bedragen (salaris, fooien, kosten) met valuta; elk ingevuld bedrag wordt één
// transactie bij dat seizoen (src/domain/geld.ts, `addEarlierSeason`).

type Row = { amount: string; currency: Currency }
const PARTS = ['salary', 'tips', 'costs'] as const

export function EarlierSeasonSheet({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const orgs = organisationChoices(trips)
  const [org, setOrg] = useState<Organisation>(orgs[0] ?? 'overig')
  const [year, setYear] = useState(String(Number(todayIso().slice(0, 4)) - 1))
  // Standaard de valuta van het standaardsalaris van die organisatie, anders de laatst gebruikte bij een eerder seizoen.
  const currencyFor = (o: Organisation): Currency => salaryDefault(settings, o)?.currency ?? defaultCurrency(settings, 'seizoen')
  const [rows, setRows] = useState<Record<(typeof PARTS)[number], Row>>(() => {
    const c = currencyFor(orgs[0] ?? 'overig')
    return { salary: { amount: '', currency: c }, tips: { amount: '', currency: c }, costs: { amount: '', currency: c } }
  })
  const [currencyChosen, setCurrencyChosen] = useState(false)
  const chooseOrg = (o: Organisation) => {
    setOrg(o)
    if (!currencyChosen) {
      const c = currencyFor(o)
      setRows((r) => ({ salary: { ...r.salary, currency: c }, tips: { ...r.tips, currency: c }, costs: { ...r.costs, currency: c } }))
    }
  }
  const [busy, setBusy] = useState(false)
  const y = Number(year)
  const yearOk = Number.isInteger(y) && y >= 2000 && y <= Number(todayIso().slice(0, 4))
  const parsed = Object.fromEntries(PARTS.map((p) => [p, rows[p].amount.trim() === '' ? undefined : parseAmount(rows[p].amount)])) as Record<(typeof PARTS)[number], number | null | undefined>
  const invalid = PARTS.some((p) => parsed[p] === null || (parsed[p] !== undefined && !(parsed[p]! > 0)))
  const filled = PARTS.filter((p) => parsed[p] !== undefined && parsed[p] !== null && parsed[p]! > 0)
  const valid = yearOk && !invalid && filled.length > 0
  const date = yearOk ? seasonDate(trips, legs, org, y) : ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const amount = (p: (typeof PARTS)[number]): SeasonAmount | undefined => (parsed[p] ? { amount: parsed[p]!, currency: rows[p].currency } : undefined)
      const { undo } = await eerderSeizoenInvoeren(store, { org, year: y, salary: amount('salary'), tips: amount('tips'), costs: amount('costs') })
      onClose()
      notify(t('earlier.saved', { n: filled.length }), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('earlier.title')} onClose={onClose}>
      <form className="stack earlier-season" onSubmit={(e) => void submit(e)}>
        <p className="muted small">{t('earlier.hint')}</p>
        <div className="two">
          <label>
            {t('week.organisation')}
            <select value={org} onChange={(e) => chooseOrg(e.target.value)}>
              {orgs.map((o) => (
                <option key={o} value={o}>
                  {organisationLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('tripPicker.year')}
            <input type="number" inputMode="numeric" min={2000} max={Number(todayIso().slice(0, 4))} value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
        </div>
        {PARTS.map((p) => (
          <div key={p} className="row">
            <label className="grow">
              {t(`earlier.${p}`)}
              <input type="text" inputMode="decimal" autoComplete="off" value={rows[p].amount} onChange={(e) => setRows({ ...rows, [p]: { ...rows[p], amount: e.target.value } })} />
            </label>
            <label>
              {t('field.currency')}
              <select
                aria-label={`${t('field.currency')}: ${t(`earlier.${p}`)}`}
                value={rows[p].currency}
                onChange={(e) => {
                  setCurrencyChosen(true)
                  setRows({ ...rows, [p]: { ...rows[p], currency: e.target.value as Currency } })
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        {date && <p className="muted small">{t('earlier.date', { date: formatDate(date) })}</p>}
        <button className="btn primary" type="submit" disabled={!valid || busy}>
          <Icon icon={CalendarRange} />
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
