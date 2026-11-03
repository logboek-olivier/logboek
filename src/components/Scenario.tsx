import { Trash2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { getLang, t } from '../i18n'
import { activeScenario, assumptionsOf, MAX_PCT, MIN_PCT, type OneOffInput } from '../model/scenario'
import { currentSettings, defaultCurrency } from '../model/settings'
import { CURRENCIES, type Currency, type Scenario, type ScenarioOneOff } from '../model/types'
import type { Store } from '../storage/store'
import { aannamesOpslaan, eenmaligToevoegen, eenmaligVerwijderen, eenmaligWijzigen, scenarioActiveren, scenarioHernoemen, scenarioMaken } from '../domain/geld'
import { amountInput, parseAmount } from '../basis/bedrag'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Geld → Verwacht: Gepland of Scenario. Gepland = alleen de agenda (tochten en periodes), vaste lasten en de gemiddelde
// kosten per dagsoort (src/components/Position.tsx); Scenario = het eigen stappenplan (src/components/ScenarioPlanner.tsx).
// Hier de keuze (per apparaat, localStorage, niet gesynct) en de bladen die het stappenplan gebruikt: naam, aannames en
// eenmalige uitgaven. De scenario's zelf en welk scenario actief is, synchroniseren.

export type ForecastMode = 'gepland' | 'scenario'
const MODE_KEY = 'logboek-verwacht-modus'
const listeners = new Set<() => void>()
let cached: ForecastMode | null = null

function readMode(): ForecastMode {
  if (cached) return cached
  try {
    cached = localStorage.getItem(MODE_KEY) === 'scenario' ? 'scenario' : 'gepland'
  } catch {
    cached = 'gepland'
  }
  return cached
}

function setMode(mode: ForecastMode): void {
  cached = mode
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Niet te bewaren: geldt dan tot herladen.
  }
  for (const l of listeners) l()
}

export function useForecastMode(): ForecastMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    readMode,
    () => 'gepland' as const,
  )
}

/** Bovenaan Verwacht: Gepland of Scenario. */
export function ForecastModeSwitch() {
  const mode = useForecastMode()
  return (
    <div className="stack-sm forecast-mode">
      <div className="segments" role="radiogroup" aria-label={t('forecast.mode')}>
        {(['gepland', 'scenario'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`segment${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
            {t(m === 'gepland' ? 'forecast.planned' : 'forecast.scenario')}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Het actieve scenario (of null), uit de gesyncte instellingen. */
export function useActiveScenario(store: Store): Scenario | null {
  const scenarios = useCollection(store, 'scenarios.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  return useMemo(() => activeScenario(scenarios, settings.activeScenarioId), [scenarios, settings.activeScenarioId])
}

export function ScenarioChooser({ store, scenarios, current }: { store: Store; scenarios: readonly Scenario[]; current: Scenario | null }) {
  return (
    <label>
      {t('scenario.choose')}
      <select value={current?.id ?? ''} onChange={(e) => e.target.value && void scenarioActiveren(store, e.target.value)}>
        {!current && <option value="">–</option>}
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function NameSheet({ store, notify, mode, scenario, suggested, onClose }: { store: Store; notify: Notify; mode: 'nieuw' | 'hernoemen'; scenario: Scenario | null; suggested: string; onClose: () => void }) {
  const [name, setName] = useState(scenario?.name ?? suggested)
  const ok = name.trim().length > 0
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    const { undo } = mode === 'hernoemen' && scenario ? await scenarioHernoemen(store, scenario.id, name) : await scenarioMaken(store, name)
    onClose()
    notify(t('scenario.saved'), undo)
  }
  return (
    <Sheet title={mode === 'nieuw' ? t('scenario.new') : t('scenario.rename')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('scenario.name')}
          <input type="text" maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

/** "Beleggingen 6% · bezittingen 2% · rente 2,5% · 20% van het inkomen belegd", of dat er niets is aangenomen. */
export function assumptionsText(scenario: Scenario): string {
  const a = assumptionsOf(scenario)
  if (a.investmentGrowthPct === 0 && a.assetGrowthPct === 0 && a.debtInterestPct === 0 && a.investPct === 0) return t('scenario.assumptionsNone')
  const pct = (n: number) => n.toLocaleString(getLang() === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2 })
  return t('scenario.assumptionsLine', { investments: pct(a.investmentGrowthPct), assets: pct(a.assetGrowthPct), debts: pct(a.debtInterestPct), invest: pct(a.investPct) })
}

/** Een percentage lezen zoals een bedrag (komma of punt); leeg is 0. */
function parsePct(text: string, min: number, max: number): number | null {
  if (text.trim() === '') return 0
  const n = parseAmount(text.replace('%', ''), getLang())
  if (n === null) {
    const plain = Number(text.replace(',', '.'))
    return Number.isFinite(plain) && plain >= min && plain <= max ? plain : null
  }
  return n >= min && n <= max ? n : null
}

/** Aannames: groei beleggingen, groei bezittingen, rente op schulden en het belegde deel van het inkomen. */
export function AssumptionsSheet({ store, notify, scenario, onClose }: { store: Store; notify: Notify; scenario: Scenario; onClose: () => void }) {
  const a = assumptionsOf(scenario)
  const show = (n: number) => (n === 0 ? '' : n.toLocaleString(getLang() === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2, useGrouping: false }))
  const [investments, setInvestments] = useState(show(a.investmentGrowthPct))
  const [assets, setAssets] = useState(show(a.assetGrowthPct))
  const [debts, setDebts] = useState(show(a.debtInterestPct))
  const [invest, setInvest] = useState(show(a.investPct))
  const parsed = { investmentGrowthPct: parsePct(investments, MIN_PCT, MAX_PCT), assetGrowthPct: parsePct(assets, MIN_PCT, MAX_PCT), debtInterestPct: parsePct(debts, MIN_PCT, MAX_PCT), investPct: parsePct(invest, 0, 100) }
  const valid = Object.values(parsed).every((v) => v !== null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const { undo } = await aannamesOpslaan(store, scenario.id, { investmentGrowthPct: parsed.investmentGrowthPct!, assetGrowthPct: parsed.assetGrowthPct!, debtInterestPct: parsed.debtInterestPct!, investPct: parsed.investPct! })
    onClose()
    notify(t('scenario.saved'), undo)
  }
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label>
      {label}
      <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  )
  return (
    <Sheet title={t('scenario.assumptions')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {field(t('scenario.investmentGrowth'), investments, setInvestments)}
        {field(t('scenario.assetGrowth'), assets, setAssets)}
        {field(t('scenario.debtInterest'), debts, setDebts)}
        {field(t('scenario.investPct'), invest, setInvest)}
        <p className="muted small">{valid ? t('scenario.assumptionsHint') : t('scenario.pctInvalid')}</p>
        <button className="btn primary" type="submit" disabled={!valid}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

/** Een eenmalige uitgave: wat, wanneer en het bedrag (met de valuta). */
export function OneOffSheet({ store, notify, scenario, oneOff, onClose }: { store: Store; notify: Notify; scenario: Scenario; oneOff: ScenarioOneOff | null; onClose: () => void }) {
  const lastCurrency = defaultCurrency(currentSettings(useCollection(store, 'settings.json.enc')), 'scenario')
  const [name, setName] = useState(oneOff?.name ?? '')
  const [date, setDate] = useState(oneOff?.date ?? '')
  const [amount, setAmount] = useState(oneOff ? amountInput(oneOff.amount) : '')
  const [currency, setCurrency] = useState<Currency>(oneOff?.currency ?? lastCurrency ?? 'EUR')
  const value = parseAmount(amount, getLang())
  const valid = name.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date) && value !== null && value > 0
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const input: OneOffInput = { name, date, amount: value!, currency }
    const { undo } = oneOff ? await eenmaligWijzigen(store, scenario.id, oneOff.id, input) : await eenmaligToevoegen(store, scenario.id, input)
    onClose()
    notify(t('scenario.oneOffSaved'), undo)
  }
  async function remove() {
    if (!oneOff) return
    const { undo } = await eenmaligVerwijderen(store, scenario.id, oneOff.id)
    onClose()
    notify(t('scenario.oneOffDeleted'), undo)
  }
  return (
    <Sheet title={t(oneOff ? 'scenario.editOneOff' : 'scenario.addOneOff')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('scenario.oneOffName')}
          <input type="text" maxLength={60} autoComplete="off" autoCapitalize="sentences" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!oneOff} />
        </label>
        <label>
          {t('scenario.oneOffDate')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="amount-currency">
          <label className="grow">
            {t('scenario.oneOffAmount')}
            <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            {t('scenario.currency')}
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!valid}>
            {t('common.save')}
          </button>
          {oneOff && (
            <button type="button" className="btn danger" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
