import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { formatDate, formatDateShort, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { getLang, t } from '../i18n'
import { buildIndex, planningEnd } from '../model/calendar'
import { dayAverages } from '../model/costs'
import { getRates, subscribeRates } from '../model/rates'
import { blockIncome, liveScenarios, MAX_BLOCKS, MAX_ONE_OFFS, MAX_WEEKS, validOneOffs, type BlockInput } from '../model/scenario'
import { fromHistory, fromPlanning, simEnd, simMonths, simStart, simulate, startPosition, type SimResult } from '../model/scenario-sim'
import { currentSettings, defaultCurrency } from '../model/settings'
import { CURRENCIES, type Currency, type Scenario, type ScenarioBlock, type ScenarioOneOff } from '../model/types'
import type { Store } from '../storage/store'
import { blokToevoegen, blokVerplaatsen, blokVerwijderen, blokWijzigen, scenarioDoelZetten, scenarioOmzetten, scenarioStartZetten, scenarioVerwijderen } from '../domain/geld'
import { amountInput, parseAmount, parseStand } from '../basis/bedrag'
import { addDays, shiftMonth } from '../basis/datum'
import { BarChart } from './BarChart'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { LineChart } from './LineChart'
import { usePositionInput } from './Position'
import { AssumptionsSheet, assumptionsText, NameSheet, OneOffSheet, ScenarioChooser, useActiveScenario } from './Scenario'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Geld → Verwacht → Scenario als stappenplan (src/model/scenario-sim.ts): stap 1 de start, stap 2 inkomen en kosten in
// blokken, stap 3 beleggen en eenmalige uitgaven, stap 4 het doel; daaronder het rapport (kerncijfers, de som, de
// netto waarde per maand met de doellijn, inkomen en kosten per maand). Alles is zelf aan te passen; de planning en de
// eerdere weken zijn alleen een voorstel om een blok mee te vullen.

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Alles wat het stappenplan nodig heeft, één keer uitgerekend. */
function usePlannerData(store: Store, scenario: Scenario | null, today: string) {
  const input = usePositionInput(store)
  const settingsRecords = useCollection(store, 'settings.json.enc')
  const settings = useMemo(() => currentSettings(settingsRecords), [settingsRecords])
  const calendar = useCollection(store, 'calendar.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const fixed = useCollection(store, 'fixedcosts.json.enc')
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const index = useMemo(() => buildIndex(calendar, input.trips, input.legs, [], stays), [calendar, input.trips, input.legs, stays])
  const position = useMemo(() => startPosition(input, today), [input, today])
  const history = useMemo(() => fromHistory(input.transactions, fixed, today, undefined, rates), [input.transactions, fixed, today, rates])
  const planning = useMemo(() => {
    const averages = dayAverages(input.transactions, index, today, settings)
    return fromPlanning(input, settings, today, planningEnd(index), fixed, averages, index)
  }, [input, settings, today, fixed, index])
  const legacy = !!scenario && scenario.version !== 2
  const result = useMemo(() => {
    if (!scenario) return null
    // Een ouder scenario: de planning als eerste blok (zoals het vroeger rekende), vanaf vandaag; pas na een tik opgeslagen.
    const s = legacy ? { ...scenario, startDate: undefined } : scenario
    const planningBlock = legacy && planning ? { id: 'planning', ...planning } : null
    return simulate({ scenario: s, today, position, defaultCostsPerWeek: history.costs, rates, planningBlock })
  }, [scenario, legacy, today, position, history.costs, rates, planning])
  return { settings, position, history, planning, legacy, result }
}

export function ScenarioPlanner({ store, notify, today }: { store: Store; notify: Notify; today: string }) {
  const scenarios = liveScenarios(useCollection(store, 'scenarios.json.enc'))
  const current = useActiveScenario(store)
  const data = usePlannerData(store, current, today)
  const [naming, setNaming] = useState<'nieuw' | 'hernoemen' | null>(null)
  const [step, setStep] = useState<'start' | 'doel' | 'aannames' | null>(null)
  const [editing, setEditing] = useState<ScenarioBlock | 'nieuw' | null>(null)
  const [oneOff, setOneOff] = useState<ScenarioOneOff | 'nieuw' | null>(null)
  const suggested = t('scenario.defaultName', { n: scenarios.length + 1 })
  if (!current || !data.result) {
    return (
      <div className="section card card-body stack-sm scenario">
        <h2>{t('scenario.title')}</h2>
        <p className="muted">{t('scenario.none')}</p>
        {scenarios.length > 1 && <ScenarioChooser store={store} scenarios={scenarios} current={null} />}
        <button type="button" className="btn primary" onClick={() => setNaming('nieuw')}>
          <Icon icon={Plus} />
          {t('scenario.create')}
        </button>
        {naming && <NameSheet store={store} notify={notify} mode={naming} scenario={null} suggested={suggested} onClose={() => setNaming(null)} />}
      </div>
    )
  }
  const scenario = current
  const result = data.result
  const oneOffs = validOneOffs(scenario)
  const blockRows = blockDates(scenario, result.start, data.legacy ? data.planning : null)
  const lastBlockEnd = blockRows.at(-1)?.to ?? null
  async function remove() {
    const undo = await scenarioVerwijderen(store, scenario.id)
    notify(t('scenario.deleted'), undo)
  }
  async function move(block: ScenarioBlock, by: -1 | 1) {
    const { undo } = await blokVerplaatsen(store, scenario.id, block.id, by)
    notify(t('scenario.blockMoved'), undo)
  }
  async function convert() {
    const { undo } = await scenarioOmzetten(store, scenario.id, data.planning)
    notify(t('scenarioPlan.converted'), undo)
  }
  const goal = scenario.goal
  return (
    <div className="section stack scenario scenario-planner">
      <div className="card card-body stack-sm">
        <div className="section-head">
          <h2>{scenario.name}</h2>
          <button type="button" className="btn icon" aria-label={t('scenario.rename')} onClick={() => setNaming('hernoemen')}>
            <Icon icon={Pencil} />
          </button>
        </div>
        {scenarios.length > 1 && <ScenarioChooser store={store} scenarios={scenarios} current={scenario} />}
        {data.legacy && (
          <div className="notice stack-sm">
            <p>{t('scenarioPlan.legacy')}</p>
            <button type="button" className="btn" onClick={() => void convert()}>
              {t('scenarioPlan.convert')}
            </button>
          </div>
        )}
        <ol className="plain-list scenario-steps">
          <Step n={1} title={t('scenarioPlan.step1')} action={data.legacy ? undefined : () => setStep('start')}>
            <p>{t('scenarioPlan.startLine', { date: formatDate(result.start), end: formatDate(result.end) })}</p>
            <p className="muted">{result.ownStart ? formatMoney(result.startValue, 'EUR') : t('scenarioPlan.startValueToday', { amount: formatMoney(result.startValue, 'EUR') })}</p>
          </Step>
          <Step n={2} title={t('scenarioPlan.step2')}>
            {blockRows.length === 0 && <p className="muted">{t('scenario.noBlocks')}</p>}
            {blockRows.length > 0 && (
              <ol className="plain-list scenario-blocks">
                {blockRows.map((r, i) => {
                  const own = r.block ? scenario.blocks.findIndex((b) => b.id === r.block!.id) : -1
                  const line = t('scenarioPlan.blockTitle', { n: r.number, weeks: r.weeks })
                  const detail = blockDetail(r.salary, r.tips, r.costs, r.currency, data.history.costs)
                  return (
                    <li key={r.key} className="row scenario-block">
                      {r.block && !data.legacy ? (
                        <button type="button" className="grow scenario-block-main" aria-label={`${line} · ${t('scenario.edit')}`} onClick={() => setEditing(r.block!)}>
                          <span>{line}</span>
                          <span className="muted small">{detail}</span>
                          <span className="muted small">
                            {formatDate(r.from)} – {formatDate(r.to)}
                          </span>
                        </button>
                      ) : (
                        <div className="grow scenario-block-main static">
                          <span>
                            {line}
                            {!r.block && <span className="muted small"> · {t('scenarioPlan.fromPlanning')}</span>}
                          </span>
                          <span className="muted small">{detail}</span>
                          <span className="muted small">
                            {formatDate(r.from)} – {formatDate(r.to)}
                          </span>
                        </div>
                      )}
                      {r.block && !data.legacy && scenario.blocks.length > 1 && (
                        <div className="scenario-move">
                          <button type="button" className="btn icon" aria-label={`${t('scenario.up')}: ${t('scenario.blockN', { n: r.number })}`} disabled={own <= 0} onClick={() => void move(r.block!, -1)}>
                            <Icon icon={ArrowUp} />
                          </button>
                          <button type="button" className="btn icon" aria-label={`${t('scenario.down')}: ${t('scenario.blockN', { n: r.number })}`} disabled={own === scenario.blocks.length - 1 || i === blockRows.length - 1} onClick={() => void move(r.block!, 1)}>
                            <Icon icon={ArrowDown} />
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
            {lastBlockEnd && lastBlockEnd < result.end && <p className="muted small">{t('scenarioPlan.afterBlocks', { date: formatDate(lastBlockEnd), costs: formatMoney(data.history.costs, 'EUR') })}</p>}
            {!data.legacy &&
              (scenario.blocks.length < MAX_BLOCKS ? (
                <button type="button" className="btn" onClick={() => setEditing('nieuw')}>
                  <Icon icon={Plus} />
                  {t('scenario.addBlock')}
                </button>
              ) : (
                <p className="muted small">{t('scenario.max', { n: MAX_BLOCKS })}</p>
              ))}
          </Step>
          <Step n={3} title={t('scenarioPlan.step3')} action={data.legacy ? undefined : () => setStep('aannames')}>
            <p>{assumptionsText(scenario)}</p>
            {oneOffs.length > 0 && (
              <ul className="plain-list scenario-blocks">
                {oneOffs.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="row scenario-block-main one-off" disabled={data.legacy} aria-label={`${o.name}: ${formatMoney(o.amount, o.currency)} · ${t('scenario.editOneOff')}`} onClick={() => setOneOff(o)}>
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
            {!data.legacy && oneOffs.length < MAX_ONE_OFFS && (
              <button type="button" className="btn" onClick={() => setOneOff('nieuw')}>
                <Icon icon={Plus} />
                {t('scenario.addOneOff')}
              </button>
            )}
          </Step>
          <Step n={4} title={t('scenarioPlan.step4')} action={data.legacy ? undefined : () => setStep('doel')}>
            <p>
              {goal?.kind === 'doel'
                ? goal.by
                  ? t('scenarioPlan.goalAmountBy', { amount: formatMoney(goal.amount, 'EUR'), date: formatDate(goal.by) })
                  : t('scenarioPlan.goalAmount', { amount: formatMoney(goal.amount, 'EUR') })
                : t('scenarioPlan.goalStand', { date: formatDate(result.end) })}
            </p>
          </Step>
        </ol>
      </div>
      <Report result={result} />
      <div className="row scenario-actions">
        <button type="button" className="btn link small" onClick={() => setNaming('nieuw')}>
          {t('scenario.new')}
        </button>
        <button type="button" className="btn link small danger" onClick={() => void remove()}>
          {t('scenario.delete')}
        </button>
      </div>
      {naming && <NameSheet store={store} notify={notify} mode={naming} scenario={naming === 'hernoemen' ? scenario : null} suggested={suggested} onClose={() => setNaming(null)} />}
      {step === 'start' && <StartStepSheet store={store} notify={notify} scenario={scenario} today={today} todayValue={data.position.net} onClose={() => setStep(null)} />}
      {step === 'aannames' && <AssumptionsSheet store={store} notify={notify} scenario={scenario} onClose={() => setStep(null)} />}
      {step === 'doel' && <GoalSheet store={store} notify={notify} scenario={scenario} start={result.start} onClose={() => setStep(null)} />}
      {editing && <PlanBlockSheet store={store} notify={notify} scenario={scenario} block={editing === 'nieuw' ? null : editing} planning={data.planning} history={data.history} onClose={() => setEditing(null)} />}
      {oneOff && <OneOffSheet store={store} notify={notify} scenario={scenario} oneOff={oneOff === 'nieuw' ? null : oneOff} onClose={() => setOneOff(null)} />}
    </div>
  )
}

function Step({ n, title, action, children }: { n: number; title: string; action?: () => void; children: ReactNode }) {
  return (
    <li className="scenario-step">
      <div className="scenario-step-head">
        <span className="scenario-step-n" aria-hidden="true">
          {n}
        </span>
        <h3 className="grow">
          <span className="sr-only">{t('scenarioPlan.step', { n })}: </span>
          {title}
        </h3>
        {action && (
          <button type="button" className="btn link small" aria-label={`${t('scenario.changeStart')}: ${title}`} onClick={action}>
            {t('scenario.changeStart')}
          </button>
        )}
      </div>
      <div className="scenario-step-body stack-sm">{children}</div>
    </li>
  )
}

interface BlockRow {
  key: string
  number: number
  block: ScenarioBlock | null
  weeks: number
  from: string
  to: string
  salary: number
  tips: number
  costs: number | undefined
  currency: Currency
}

/** De blokken op een rij met hun datums (een ouder scenario: de planning als eerste blok, niet opgeslagen). */
function blockDates(scenario: Scenario, start: string, planning: (BlockInput & { weeks: number }) | null): BlockRow[] {
  const rows: BlockRow[] = []
  let from = start
  const push = (key: string, block: ScenarioBlock | null, weeks: number, salary: number, tips: number, costs: number | undefined, currency: Currency) => {
    const to = addDays(from, weeks * 7 - 1)
    rows.push({ key, number: rows.length + 1, block, weeks, from, to, salary, tips, costs, currency })
    from = addDays(to, 1)
  }
  if (planning) push('planning', null, planning.weeks, planning.salaryPerWeek ?? planning.incomePerWeek, planning.tipsPerWeek ?? 0, planning.costsPerWeek, planning.currency)
  for (const b of scenario.blocks) {
    const income = blockIncome(b)
    push(b.id, b, b.weeks, income.salary, income.tips, b.costsPerWeek, b.currency)
  }
  return rows
}

function blockDetail(salary: number, tips: number, costs: number | undefined, currency: Currency, average: number): string {
  return t('scenarioPlan.blockDetail', {
    salary: formatMoney(salary, currency),
    tips: formatMoney(tips, currency),
    costs: costs === undefined ? t('scenarioPlan.costsAverage', { amount: formatMoney(average, 'EUR') }) : formatMoney(costs, currency),
  })
}

/** Het rapport: kerncijfers, de som die sluit, de netto waarde per maand met de doellijn, inkomen en kosten per maand. */
function Report({ result }: { result: SimResult }) {
  const months = simMonths(result)
  const change = result.endValue - result.startValue
  const weeks = Math.max(1, result.weeks.length)
  const perWeek = (result.totals.salary + result.totals.tips - result.totals.costs) / weeks
  const goal = result.goal
  const signed = (n: number) => (Math.round(n * 100) === 0 ? formatMoney(0, 'EUR') : `${n > 0 ? '+' : '−'}${formatMoney(Math.abs(n), 'EUR')}`)
  const lines: [string, number][] = [
    [t('scenarioPlan.lineSalary'), result.totals.salary],
    [t('scenarioPlan.lineTips'), result.totals.tips],
    [t('scenarioPlan.lineCosts'), -result.totals.costs],
    ...(result.totals.oneOffs ? ([[t('scenarioPlan.lineOneOffs'), -result.totals.oneOffs]] as [string, number][]) : []),
    ...(result.totals.growth ? ([[t('scenarioPlan.lineGrowth'), result.totals.growth]] as [string, number][]) : []),
  ]
  const unpriced = Object.entries(result.unpriced)
  const startPoint = { key: 'start', label: formatMonthShort(result.start.slice(0, 7)), value: result.startValue, future: false }
  const points = [startPoint, ...months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), value: m.value, future: true }))]
  const every = (n: number) => (n > 8 ? Math.ceil(n / 6) : 1)
  return (
    <div className="card card-body stack scenario-report">
      <h2>{t('scenarioPlan.report')}</h2>
      <dl className="stats-hero scenario-kpis">
        <Kpi label={t('scenarioPlan.endValue', { date: formatDateShort(result.end) })} value={formatMoney(result.endValue, 'EUR')} />
        <Kpi label={t('scenarioPlan.change')} value={signed(change)} />
        <Kpi label={t('scenarioPlan.perWeek')} value={signed(perWeek)} />
        {goal.kind === 'doel' && (
          <Kpi
            label={t('scenarioPlan.reachedLabel', { amount: formatMoney(goal.amount, 'EUR') })}
            value={goal.reachedOn === null ? t('scenarioPlan.notReached') : goal.reachedOn === result.start ? t('scenarioPlan.alreadyReached') : formatDateShort(goal.reachedOn)}
          />
        )}
        {goal.kind === 'doel' && goal.by && goal.neededPerWeek !== undefined && (
          <Kpi label={t('scenarioPlan.neededLabel', { date: formatDateShort(goal.by) })} value={signed(goal.neededPerWeek)} detail={t('scenarioPlan.neededDetail', { amount: signed(goal.plannedPerWeek ?? 0) })} />
        )}
      </dl>
      <ul className="plain-list forecast-sum">
        <li className="row">
          <span className="grow">{result.ownStart ? t('scenarioPlan.lineStartOwn', { date: formatDateShort(result.start) }) : t('scenarioPlan.lineStart', { date: formatDateShort(result.start) })}</span>
          <span className="num">{formatMoney(result.startValue, 'EUR')}</span>
        </li>
        {lines.map(([label, value]) => (
          <li key={label} className="row">
            <span className="grow">{label}</span>
            <span className="num">{signed(value)}</span>
          </li>
        ))}
        <li className="row forecast-total">
          <strong className="grow">{t('scenarioPlan.endValue', { date: formatDateShort(result.end) })}</strong>
          <strong className="num">{formatMoney(result.endValue, 'EUR')}</strong>
        </li>
      </ul>
      {result.totals.invested > 0 && <p className="muted small">{t('scenarioPlan.invested', { amount: formatMoney(result.totals.invested, 'EUR') })}</p>}
      {unpriced.length > 0 && <p className="muted small">{t('scenarioPlan.unpriced', { amounts: unpriced.map(([c, v]) => formatMoney(v ?? 0, c)).join(', ') })}</p>}
      <h3>{t('scenarioPlan.chartValue')}</h3>
      <LineChart
        points={points}
        label={`${t('scenarioPlan.chartValue')}: ${points.map((p) => `${p.label} ${formatMoney(p.value, 'EUR')}`).join(', ')}${goal.kind === 'doel' ? `; ${t('scenarioPlan.goalLine')} ${formatMoney(goal.amount, 'EUR')}` : ''}`}
        format={(n) => formatMoneyShort(n)}
        labelEvery={every(points.length)}
        goal={goal.kind === 'doel' ? { value: goal.amount, label: `${t('scenarioPlan.goalLine')} ${formatMoneyShort(goal.amount)}` } : undefined}
      />
      <h3>{t('scenarioPlan.chartFlow')}</h3>
      <BarChart
        label={`${t('scenarioPlan.chartFlow')}: ${months.map((m) => `${formatMonth(m.month)} +${formatMoney(m.income, 'EUR')}, −${formatMoney(m.costs, 'EUR')}`).join('; ')}`}
        groups={months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), values: [m.income, m.costs] }))}
        format={(n) => formatMoneyShort(n)}
        labelEvery={every(months.length)}
      />
      <ul className="legend">
        <li>
          <span className="swatch" /> {t('money.income')}
        </li>
        <li>
          <span className="swatch s2" /> {t('money.costs')}
        </li>
      </ul>
      <details className="scenario-table">
        <summary>{t('scenarioPlan.table')}</summary>
        <table className="table">
          <thead>
            <tr>
              <th>{t('money.month')}</th>
              <th className="num">{t('money.in')}</th>
              <th className="num">{t('money.out')}</th>
              <th className="num">{t('scenarioPlan.value')}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>
                  {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                </td>
                <td className="num">{formatMoney(m.income, 'EUR')}</td>
                <td className="num">{formatMoney(m.costs, 'EUR')}</td>
                <td className="num">{formatMoney(m.value, 'EUR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stats-hero-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail && <dd className="kpi-detail">{detail}</dd>}
    </div>
  )
}

const LOOK_AHEAD = [12, 18, 24, 60] as const

/** Stap 1: begindatum (vanaf vandaag), de netto waarde bij de start (leeg = die van vandaag) en tot wanneer. */
function StartStepSheet({ store, notify, scenario, today, todayValue, onClose }: { store: Store; notify: Notify; scenario: Scenario; today: string; todayValue: number; onClose: () => void }) {
  const [date, setDate] = useState(simStart(scenario, today))
  const [value, setValue] = useState(scenario.startValue !== undefined ? amountInput(scenario.startValue) : '')
  const [end, setEnd] = useState(simEnd(scenario, today))
  const startValue = value.trim() === '' ? null : parseStand(value, getLang())
  const valueOk = value.trim() === '' || startValue !== null
  const ok = ISO.test(date) && date >= today && ISO.test(end) && end > date && valueOk
  const ahead = (months: number) => {
    const target = `${shiftMonth(date.slice(0, 7), months)}-${date.slice(8)}`
    return ISO.test(target) && !Number.isNaN(Date.parse(target)) ? target : `${shiftMonth(date.slice(0, 7), months)}-28`
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    const { undo } = await scenarioStartZetten(store, scenario.id, { startDate: date > today ? date : null, startValue, endDate: end })
    onClose()
    notify(t('scenario.saved'), undo)
  }
  return (
    <Sheet title={`${t('scenarioPlan.step', { n: 1 })}: ${t('scenarioPlan.step1')}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('scenarioPlan.startDate')}
          <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          {t('scenarioPlan.startValue')}
          <input className="amount" type="text" inputMode="decimal" autoComplete="off" placeholder={formatMoney(todayValue, 'EUR')} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <p className="muted small">{t('scenarioPlan.startValueHint', { amount: formatMoney(todayValue, 'EUR') })}</p>
        <label>
          {t('scenarioPlan.endDate')}
          <input type="date" value={end} min={addDays(date, 1)} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <div className="type-buttons">
          {LOOK_AHEAD.map((m) => (
            <button key={m} type="button" aria-pressed={end === ahead(m)} className={`chip${end === ahead(m) ? ' active' : ''}`} onClick={() => setEnd(ahead(m))}>
              {t('scenarioPlan.months', { n: m })}
            </button>
          ))}
        </div>
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

/** Stap 2: een blok met weken, salaris, fooi en kosten per week; in te vullen uit de planning of de eerdere weken. */
function PlanBlockSheet({ store, notify, scenario, block, planning, history, onClose }: { store: Store; notify: Notify; scenario: Scenario; block: ScenarioBlock | null; planning: (BlockInput & { weeks: number }) | null; history: { salary: number; tips: number; costs: number }; onClose: () => void }) {
  const previous = scenario.blocks.at(-1)
  const lastCurrency = defaultCurrency(currentSettings(useCollection(store, 'settings.json.enc')), 'scenario')
  const income = block ? blockIncome(block) : null
  const [weeks, setWeeks] = useState(block ? String(block.weeks) : '')
  const [salary, setSalary] = useState(income ? amountInput(income.salary) : '')
  const [tips, setTips] = useState(income ? amountInput(income.tips) : '')
  const [currency, setCurrency] = useState<Currency>(block?.currency ?? previous?.currency ?? lastCurrency ?? 'EUR')
  const [costs, setCosts] = useState(block?.costsPerWeek !== undefined ? amountInput(block.costsPerWeek) : '')
  const w = Number(weeks)
  const weeksOk = Number.isInteger(w) && w >= 1 && w <= MAX_WEEKS
  // Nul mag (geen fooi, geen kosten); leeg is 0, bij de kosten het gemiddelde.
  const nonNegative = (text: string) => {
    const n = parseStand(text, getLang())
    return n !== null && n >= 0 ? n : null
  }
  const read = (text: string) => (text.trim() === '' ? 0 : nonNegative(text))
  const salaryValue = read(salary)
  const tipsValue = read(tips)
  const costsValue = costs.trim() === '' ? undefined : nonNegative(costs)
  const valid = weeksOk && salaryValue !== null && salaryValue >= 0 && tipsValue !== null && tipsValue >= 0 && costsValue !== null && (costsValue === undefined || costsValue >= 0)
  function fill(from: { weeks?: number; salary: number; tips: number; costs: number }) {
    if (from.weeks !== undefined) setWeeks(String(Math.min(MAX_WEEKS, from.weeks)))
    setSalary(amountInput(from.salary))
    setTips(amountInput(from.tips))
    setCosts(amountInput(from.costs))
    setCurrency('EUR')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const input: BlockInput = { weeks: w, incomePerWeek: salaryValue! + tipsValue!, salaryPerWeek: salaryValue!, tipsPerWeek: tipsValue!, currency, ...(costsValue !== undefined && costsValue !== null ? { costsPerWeek: costsValue } : {}) }
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
  const money = (label: string, value: string, set: (v: string) => void) => (
    <label className="grow">
      {label}
      <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  )
  return (
    <Sheet title={block ? t('scenario.edit') : t('scenario.addBlock')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="stack-sm">
          <span className="small">{t('scenarioPlan.fillFrom')}</span>
          <div className="type-buttons">
            {planning && (
              <button type="button" className="chip" onClick={() => fill({ weeks: planning.weeks, salary: planning.salaryPerWeek ?? planning.incomePerWeek, tips: planning.tipsPerWeek ?? 0, costs: planning.costsPerWeek ?? 0 })}>
                {t('scenarioPlan.fromPlanning')}
              </button>
            )}
            <button type="button" className="chip" onClick={() => fill(history)}>
              {t('scenarioPlan.fromHistory')}
            </button>
          </div>
        </div>
        <label>
          {t('scenario.weeks')}
          <input type="number" inputMode="numeric" min={1} max={MAX_WEEKS} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
        </label>
        <div className="amount-currency">
          {money(t('scenarioPlan.salaryPerWeek'), salary, setSalary)}
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
        {money(t('scenarioPlan.tipsPerWeek'), tips, setTips)}
        {money(t('scenario.costsPerWeek'), costs, setCosts)}
        <p className="muted small">{t('scenarioPlan.costsEmpty', { amount: formatMoney(history.costs, 'EUR') })}</p>
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

/** Stap 4: waar sta ik op de einddatum, of een bedrag halen (eventueel vóór een datum). */
function GoalSheet({ store, notify, scenario, start, onClose }: { store: Store; notify: Notify; scenario: Scenario; start: string; onClose: () => void }) {
  const goal = scenario.goal
  const [kind, setKind] = useState<'stand' | 'doel'>(goal?.kind ?? 'stand')
  const [amount, setAmount] = useState(goal?.kind === 'doel' ? amountInput(goal.amount) : '')
  const [by, setBy] = useState(goal?.kind === 'doel' ? (goal.by ?? '') : '')
  const value = parseAmount(amount, getLang())
  const ok = kind === 'stand' || (value !== null && (by === '' || (ISO.test(by) && by > start)))
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    const { undo } = await scenarioDoelZetten(store, scenario.id, kind === 'doel' ? { kind: 'doel', amount: value!, ...(by ? { by } : {}) } : { kind: 'stand' })
    onClose()
    notify(t('scenario.saved'), undo)
  }
  return (
    <Sheet title={`${t('scenarioPlan.step', { n: 4 })}: ${t('scenarioPlan.step4')}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="type-buttons" role="radiogroup" aria-label={t('scenarioPlan.step4')}>
          {(['stand', 'doel'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {t(k === 'stand' ? 'scenarioPlan.goalKindStand' : 'scenarioPlan.goalKindAmount')}
            </button>
          ))}
        </div>
        {kind === 'doel' && (
          <>
            <label>
              {t('scenarioPlan.goalValue')}
              <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              {t('scenarioPlan.goalBy')}
              <input type="date" value={by} min={addDays(start, 1)} onChange={(e) => setBy(e.target.value)} />
            </label>
          </>
        )}
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
