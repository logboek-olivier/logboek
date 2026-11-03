import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDate, formatMoney } from '../format'
import { getLang, t } from '../i18n'
import { activeScenario, assumptionsOf, blockRanges, liveScenarios, MAX_BLOCKS, MAX_ONE_OFFS, MAX_PCT, MAX_WEEKS, MIN_PCT, scenarioHorizon, scenarioStart, validOneOffs, type BlockInput, type OneOffInput } from '../model/scenario'
import { currentSettings } from '../model/settings'
import { CURRENCIES, type Currency, type Scenario, type ScenarioBlock, type ScenarioOneOff } from '../model/types'
import type { Store } from '../storage/store'
import { aannamesOpslaan, blokToevoegen, blokVerplaatsen, blokVerwijderen, blokWijzigen, eenmaligToevoegen, eenmaligVerwijderen, eenmaligWijzigen, scenarioActiveren, scenarioDatumsAanpassen, scenarioHernoemen, scenarioMaken, scenarioVerwijderen } from '../domain/geld'
import { amountInput, parseAmount } from '../basis/bedrag'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Geld → Verwacht: Gepland of Scenario (src/model/scenario.ts). Gepland = alleen de agenda (tochten en periodes), vaste
// lasten en de gemiddelde kosten per dagsoort; Scenario = Gepland plus de blokken van het actieve scenario voor de weken
// ná de planning. Een blok heeft hoogstens drie velden: aantal weken, inkomen per week (met de valuta ernaast) en
// optioneel kosten per week. De keuze Gepland of Scenario geldt per apparaat (localStorage, niet gesynct); de
// scenario's zelf en welk scenario actief is, synchroniseren.

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
      <p className="muted small">{t(mode === 'gepland' ? 'forecast.plannedHint' : 'forecast.scenarioHint')}</p>
    </div>
  )
}

/** Het actieve scenario (of null), uit de gesyncte instellingen. */
export function useActiveScenario(store: Store): Scenario | null {
  const scenarios = useCollection(store, 'scenarios.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  return useMemo(() => activeScenario(scenarios, settings.activeScenarioId), [scenarios, settings.activeScenarioId])
}

/** Scenario kiezen, maken en bewerken: begindatum en blokken (toevoegen, bewerken, verwijderen, omhoog en omlaag). */
export function ScenarioSection({ store, notify, planningEnd, today }: { store: Store; notify: Notify; planningEnd: string | null; today: string }) {
  const scenarios = liveScenarios(useCollection(store, 'scenarios.json.enc'))
  const current = useActiveScenario(store)
  const [naming, setNaming] = useState<'nieuw' | 'hernoemen' | null>(null)
  const [editing, setEditing] = useState<ScenarioBlock | 'nieuw' | null>(null)
  const [starting, setStarting] = useState(false)
  const [assuming, setAssuming] = useState(false)
  const [oneOff, setOneOff] = useState<ScenarioOneOff | 'nieuw' | null>(null)
  if (!current) {
    return (
      <div className="section card card-body stack-sm scenario">
        <h2>{t('scenario.title')}</h2>
        <p className="muted small">{t('scenario.none')}</p>
        {scenarios.length > 1 && <ScenarioChooser store={store} scenarios={scenarios} current={null} />}
        <button type="button" className="btn primary" onClick={() => setNaming('nieuw')}>
          <Icon icon={Plus} />
          {t('scenario.create')}
        </button>
        {naming && <NameSheet store={store} notify={notify} mode={naming} scenario={null} suggested={t('scenario.defaultName', { n: scenarios.length + 1 })} onClose={() => setNaming(null)} />}
      </div>
    )
  }
  const start = scenarioStart(current, planningEnd, today)
  const ranges = blockRanges(current, start)
  const oneOffs = validOneOffs(current)
  const horizon = scenarioHorizon(current, ranges, today)
  async function remove() {
    const undo = await scenarioVerwijderen(store, current!.id)
    notify(t('scenario.deleted'), undo)
  }
  async function move(block: ScenarioBlock, by: -1 | 1) {
    const { undo } = await blokVerplaatsen(store, current!.id, block.id, by)
    notify(t('scenario.blockMoved'), undo)
  }
  return (
    <div className="section card card-body stack-sm scenario">
      <div className="section-head">
        <h2>{current.name}</h2>
        <button type="button" className="btn icon" aria-label={t('scenario.rename')} onClick={() => setNaming('hernoemen')}>
          <Icon icon={Pencil} />
        </button>
      </div>
      {scenarios.length > 1 && <ScenarioChooser store={store} scenarios={scenarios} current={current} />}
      <p className="row small">
        <span className="grow">
          {t('scenario.startsOn', { date: formatDate(start) })}
          <span className="muted"> · {current.startDate ? t('scenario.ownStart') : t('scenario.afterPlanning')}</span>
        </span>
        <button type="button" className="btn link small" onClick={() => setStarting(true)}>
          {t('scenario.changeStart')}
        </button>
      </p>
      {ranges.length === 0 ? (
        <p className="muted small">{t('scenario.noBlocks')}</p>
      ) : (
        <ol className="plain-list scenario-blocks">
          {ranges.map((r, i) => (
            <li key={r.block.id} className="row scenario-block">
              <button type="button" className="grow scenario-block-main" aria-label={`${t('scenario.blockLine', { n: r.number, weeks: r.block.weeks, amount: formatMoney(r.block.incomePerWeek, r.block.currency) })} · ${t('scenario.edit')}`} onClick={() => setEditing(r.block)}>
                <span>{t('scenario.blockLine', { n: r.number, weeks: r.block.weeks, amount: formatMoney(r.block.incomePerWeek, r.block.currency) })}</span>
                <span className="muted small">
                  {formatDate(r.from)} – {formatDate(r.to)} · {r.block.costsPerWeek === undefined ? t('scenario.costsAverage') : t('scenario.costsOwn', { amount: formatMoney(r.block.costsPerWeek, r.block.currency) })}
                </span>
              </button>
              <div className="scenario-move">
                <button type="button" className="btn icon" aria-label={`${t('scenario.up')}: ${t('scenario.blockN', { n: r.number })}`} disabled={i === 0} onClick={() => void move(r.block, -1)}>
                  <Icon icon={ArrowUp} />
                </button>
                <button type="button" className="btn icon" aria-label={`${t('scenario.down')}: ${t('scenario.blockN', { n: r.number })}`} disabled={i === ranges.length - 1} onClick={() => void move(r.block, 1)}>
                  <Icon icon={ArrowDown} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {current.blocks.length < MAX_BLOCKS ? (
        <button type="button" className="btn" onClick={() => setEditing('nieuw')}>
          <Icon icon={Plus} />
          {t('scenario.addBlock')}
        </button>
      ) : (
        <p className="muted small">{t('scenario.max', { n: MAX_BLOCKS })}</p>
      )}
      {/* Aannames: groei, rente en het belegde deel van het inkomen. Leeg is 0: de app verzint geen groei. */}
      <h3 className="small-heading">{t('scenario.assumptions')}</h3>
      <p className="row small">
        <span className="grow">{assumptionsText(current)}</span>
        <button type="button" className="btn link small" onClick={() => setAssuming(true)}>
          {t('scenario.changeStart')}
        </button>
      </p>
      {/* Eenmalige uitgaven: een auto, een dure vakantie. */}
      <h3 className="small-heading">{t('scenario.oneOffs')}</h3>
      {oneOffs.length === 0 ? (
        <p className="muted small">{t('scenario.noOneOffs')}</p>
      ) : (
        <ul className="plain-list scenario-blocks">
          {oneOffs.map((o) => (
            <li key={o.id}>
              <button type="button" className="row scenario-block-main one-off" aria-label={`${o.name}: ${formatMoney(o.amount, o.currency)} · ${t('scenario.editOneOff')}`} onClick={() => setOneOff(o)}>
                <span className="grow">
                  {o.name}
                  <span className="muted small"> · {formatDate(o.date)}</span>
                </span>
                <span className="num">{formatMoney(o.amount, o.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {oneOffs.length < MAX_ONE_OFFS && (
        <button type="button" className="btn" onClick={() => setOneOff('nieuw')}>
          <Icon icon={Plus} />
          {t('scenario.addOneOff')}
        </button>
      )}
      <p className="muted small">{horizon ? t('scenario.horizonLine', { date: formatDate(horizon) }) : ''}</p>
      <div className="row scenario-actions">
        <button type="button" className="btn link small" onClick={() => setNaming('nieuw')}>
          {t('scenario.new')}
        </button>
        <button type="button" className="btn link small danger" onClick={() => void remove()}>
          {t('scenario.delete')}
        </button>
      </div>
      {naming && <NameSheet store={store} notify={notify} mode={naming} scenario={naming === 'hernoemen' ? current : null} suggested={t('scenario.defaultName', { n: scenarios.length + 1 })} onClose={() => setNaming(null)} />}
      {editing && <BlockSheet store={store} notify={notify} scenario={current} block={editing === 'nieuw' ? null : editing} onClose={() => setEditing(null)} />}
      {starting && <StartSheet store={store} notify={notify} scenario={current} start={start} onClose={() => setStarting(false)} />}
      {assuming && <AssumptionsSheet store={store} notify={notify} scenario={current} onClose={() => setAssuming(false)} />}
      {oneOff && <OneOffSheet store={store} notify={notify} scenario={current} oneOff={oneOff === 'nieuw' ? null : oneOff} onClose={() => setOneOff(null)} />}
    </div>
  )
}

function ScenarioChooser({ store, scenarios, current }: { store: Store; scenarios: readonly Scenario[]; current: Scenario | null }) {
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

function NameSheet({ store, notify, mode, scenario, suggested, onClose }: { store: Store; notify: Notify; mode: 'nieuw' | 'hernoemen'; scenario: Scenario | null; suggested: string; onClose: () => void }) {
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

/** Een blok: aantal weken, inkomen per week (met de valuta) en optioneel kosten per week. */
function BlockSheet({ store, notify, scenario, block, onClose }: { store: Store; notify: Notify; scenario: Scenario; block: ScenarioBlock | null; onClose: () => void }) {
  const previous = scenario.blocks.at(-1)
  const lastCurrency = currentSettings(useCollection(store, 'settings.json.enc')).lastCurrency
  const [weeks, setWeeks] = useState(block ? String(block.weeks) : '')
  const [income, setIncome] = useState(block ? amountInput(block.incomePerWeek) : '')
  const [currency, setCurrency] = useState<Currency>(block?.currency ?? previous?.currency ?? lastCurrency ?? 'EUR')
  const [costs, setCosts] = useState(block?.costsPerWeek !== undefined ? amountInput(block.costsPerWeek) : '')
  const w = Number(weeks)
  const weeksOk = Number.isInteger(w) && w >= 1 && w <= MAX_WEEKS
  const incomeValue = parseAmount(income, getLang())
  const costsValue = costs.trim() === '' ? undefined : parseAmount(costs, getLang())
  const valid = weeksOk && incomeValue !== null && incomeValue >= 0 && costsValue !== null && (costsValue === undefined || costsValue >= 0)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const input: BlockInput = { weeks: w, incomePerWeek: incomeValue!, currency, ...(costsValue !== undefined && costsValue !== null ? { costsPerWeek: costsValue } : {}) }
    const { undo } = block ? await blokWijzigen(store, scenario.id, block.id, input) : await blokToevoegen(store, scenario.id, input)
    onClose()
    notify(t('scenario.blockSaved'), undo)
  }
  async function remove() {
    if (!block) return
    const { undo } = await blokVerwijderen(store, scenario.id, block.id)
    onClose()
    notify(t('scenario.blockDeleted'), undo)
  }
  return (
    <Sheet title={block ? t('scenario.edit') : t('scenario.addBlock')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('scenario.weeks')}
          <input type="number" inputMode="numeric" min={1} max={MAX_WEEKS} value={weeks} onChange={(e) => setWeeks(e.target.value)} autoFocus={!block} />
        </label>
        <div className="amount-currency">
          <label className="grow">
            {t('scenario.incomePerWeek')}
            <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={income} onChange={(e) => setIncome(e.target.value)} />
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
        <label>
          {t('scenario.costsPerWeek')}
          <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={costs} onChange={(e) => setCosts(e.target.value)} />
        </label>
        <p className="muted small">{t('scenario.costsHint')}</p>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!valid}>
            {t('common.save')}
          </button>
          {block && (
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

/** "Beleggingen 6% · bezittingen 2% · rente 2,5% · 20% van het inkomen belegd", of dat er niets is aangenomen. */
function assumptionsText(scenario: Scenario): string {
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
function AssumptionsSheet({ store, notify, scenario, onClose }: { store: Store; notify: Notify; scenario: Scenario; onClose: () => void }) {
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
function OneOffSheet({ store, notify, scenario, oneOff, onClose }: { store: Store; notify: Notify; scenario: Scenario; oneOff: ScenarioOneOff | null; onClose: () => void }) {
  const lastCurrency = currentSettings(useCollection(store, 'settings.json.enc')).lastCurrency
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

/** Begindatum en horizon: wanneer het eerste blok begint, en tot wanneer de vooruitblik kijkt. */
function StartSheet({ store, notify, scenario, start, onClose }: { store: Store; notify: Notify; scenario: Scenario; start: string; onClose: () => void }) {
  const [date, setDate] = useState(start)
  const [end, setEnd] = useState(scenario.endDate ?? '')
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && (end === '' || (/^\d{4}-\d{2}-\d{2}$/.test(end) && end > date))
  async function save(value: string | null) {
    const { undo } = await scenarioDatumsAanpassen(store, scenario.id, value, end || null)
    onClose()
    notify(t('scenario.saved'), undo)
  }
  return (
    <Sheet title={t('scenario.startTitle')} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) void save(date)
        }}
      >
        <label>
          {t('scenario.startLabel')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          {t('scenario.horizon')}
          <input type="date" value={end} min={date} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <p className="muted small">{t('scenario.horizonHint')}</p>
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
        {scenario.startDate && (
          <button type="button" className="btn" onClick={() => void save(null)}>
            {t('scenario.startReset')}
          </button>
        )}
      </form>
    </Sheet>
  )
}
