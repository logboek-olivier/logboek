import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { formatDate, formatDateShort, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { t } from '../i18n'
import { buildIndex, planningEnd } from '../model/calendar'
import { dayAverages } from '../model/costs'
import { getRates, subscribeRates } from '../model/rates'
import { assumptionsOf, blockIncome, liveScenarios, MAX_BLOCKS, MAX_ONE_OFFS, MAX_PCT, MAX_TRIPS, MAX_WEEKS, MIN_PCT, validOneOffs, type BlockInput, type BlockPatch } from '../model/scenario'
import { fromHistory, fromPlanning, simEnd, simMonths, simStart, simulate, startPosition, type SimResult } from '../model/scenario-sim'
import { currentSettings, defaultCurrency } from '../model/settings'
import { CURRENCIES, type Currency, type Scenario, type ScenarioBlock, type ScenarioOneOff } from '../model/types'
import type { Store } from '../storage/store'
import { aannameWijzigen, blokToevoegen, blokVeldWijzigen, blokVerplaatsen, blokVerwijderen, scenarioDoelWijzigen, scenarioOmzetten, scenarioStartZetten, scenarioVerwijderen } from '../domain/geld'
import { amountInput } from '../basis/bedrag'
import { addDays, shiftMonth } from '../basis/datum'
import { BarChart } from './BarChart'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { LineChart } from './LineChart'
import { usePositionInput } from './Position'
import { assumptionsText, NameSheet, OneOffSheet, ScenarioChooser, useActiveScenario } from './Scenario'
import { DateCell, NumberCell } from './ScenarioCells'
import { useCollection } from './useCollection'

// Geld → Verwacht → Scenario als stappenplan (src/model/scenario-sim.ts): stap 1 de start, stap 2 inkomen en kosten in
// blokken, stap 3 beleggen en eenmalige uitgaven, stap 4 het doel; daaronder het rapport (kerncijfers, de som, de
// netto waarde per maand met de doellijn, inkomen en kosten per maand). Alles is zelf aan te passen; de planning en de
// eerdere weken zijn alleen een voorstel om een blok mee te vullen.

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
  async function addBlock(form: BlockForm) {
    const { undo } = await blokToevoegen(store, scenario.id, formInput(form, defaultCurrency(data.settings, 'scenario')))
    notify(t('scenario.blockSaved'), undo)
  }
  async function convert() {
    const { undo } = await scenarioOmzetten(store, scenario.id, data.planning)
    notify(t('scenarioPlan.converted'), undo)
  }
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
          <Step n={1} title={t('scenarioPlan.step1')}>
            {data.legacy ? (
              <p>{t('scenarioPlan.startLine', { date: formatDate(result.start), end: formatDate(result.end) })}</p>
            ) : (
              <StartFields store={store} notify={notify} scenario={scenario} today={today} todayValue={data.position.net} />
            )}
          </Step>
          <Step n={2} title={t('scenarioPlan.step2')}>
            {blockRows.length === 0 && <p className="muted">{t('scenario.noBlocks')}</p>}
            {blockRows.length > 0 && (
              <ol className="plain-list scenario-blocks">
                {blockRows.map((r) =>
                  r.block && !data.legacy ? (
                    <BlockEditor key={r.key} store={store} notify={notify} scenario={scenario} row={r} averageCosts={data.history.costs} />
                  ) : (
                    <li key={r.key} className="scenario-block static">
                      <span>
                        {t('scenarioPlan.blockTitle', { n: r.number, weeks: r.weeks })}
                        {!r.block && <span className="muted small"> · {t('scenarioPlan.fromPlanning')}</span>}
                      </span>
                      <span className="muted small">{blockDetail(r.salary, r.tips, r.costs, r.currency, data.history.costs)}</span>
                    </li>
                  ),
                )}
              </ol>
            )}
            {lastBlockEnd && lastBlockEnd < result.end && <p className="muted small">{t('scenarioPlan.afterBlocks', { date: formatDate(lastBlockEnd), costs: formatMoney(data.history.costs, 'EUR') })}</p>}
            {!data.legacy &&
              (scenario.blocks.length < MAX_BLOCKS ? (
                <div className="type-buttons">
                  <button type="button" className="btn small" onClick={() => void addBlock({ weeks: 4, trips: 4, salaryPerTrip: 0, tipsPerTrip: 0 })}>
                    <Icon icon={Plus} />
                    {t('scenario.addBlock')}
                  </button>
                  {data.planning && (
                    <button type="button" className="btn small" onClick={() => void addBlock(planningForm(data.planning!))}>
                      {t('scenarioPlan.fromPlanning')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void addBlock({ weeks: 12, trips: Math.round(data.history.tripsPerWeek * 12), salaryPerTrip: data.history.salaryPerTrip, tipsPerTrip: data.history.tipsPerTrip, costsPerWeek: data.history.costs })}
                  >
                    {t('scenarioPlan.fromHistory')}
                  </button>
                </div>
              ) : (
                <p className="muted small">{t('scenario.max', { n: MAX_BLOCKS })}</p>
              ))}
          </Step>
          <Step n={3} title={t('scenarioPlan.step3')}>
            {data.legacy ? <p>{assumptionsText(scenario)}</p> : <AssumptionFields store={store} notify={notify} scenario={scenario} />}
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
              <button type="button" className="btn small" onClick={() => setOneOff('nieuw')}>
                <Icon icon={Plus} />
                {t('scenario.addOneOff')}
              </button>
            )}
          </Step>
          <Step n={4} title={t('scenarioPlan.step4')}>
            {data.legacy ? (
              <p>{t('scenarioPlan.goalStand', { date: formatDate(result.end) })}</p>
            ) : (
              <GoalFields store={store} notify={notify} scenario={scenario} start={result.start} end={result.end} />
            )}
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
      {oneOff && <OneOffSheet store={store} notify={notify} scenario={scenario} oneOff={oneOff === 'nieuw' ? null : oneOff} onClose={() => setOneOff(null)} />}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
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
  // De doellijn op de grafiek van wat het doel meet: de netto waarde, of het verdiende bedrag (opgeteld vanaf de start).
  const netGoal = goal.kind === 'doel' && goal.measure === 'netto' ? goal.amount : null
  const earnedGoal = goal.kind === 'doel' && goal.measure === 'verdiend' ? goal.amount : null
  const earnedPoints = [{ ...startPoint, value: 0 }, ...months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), value: m.earned, future: true }))]
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
            label={t(goal.measure === 'verdiend' ? 'scenarioPlan.earnedLabel' : 'scenarioPlan.reachedLabel', { amount: formatMoney(goal.amount, 'EUR') })}
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
        label={`${t('scenarioPlan.chartValue')}: ${points.map((p) => `${p.label} ${formatMoney(p.value, 'EUR')}`).join(', ')}${netGoal ? `; ${t('scenarioPlan.goalLine')} ${formatMoney(netGoal, 'EUR')}` : ''}`}
        format={(n) => formatMoneyShort(n)}
        labelEvery={every(points.length)}
        goal={netGoal !== null ? { value: netGoal, label: `${t('scenarioPlan.goalLine')} ${formatMoneyShort(netGoal)}` } : undefined}
      />
      {earnedGoal !== null && (
        <>
          <h3>{t('scenarioPlan.chartEarned')}</h3>
          <LineChart
            points={earnedPoints}
            label={`${t('scenarioPlan.chartEarned')}: ${earnedPoints.map((p) => `${p.label} ${formatMoney(p.value, 'EUR')}`).join(', ')}; ${t('scenarioPlan.goalLine')} ${formatMoney(earnedGoal, 'EUR')}`}
            format={(n) => formatMoneyShort(n)}
            labelEvery={every(earnedPoints.length)}
            goal={{ value: earnedGoal, label: `${t('scenarioPlan.goalLine')} ${formatMoneyShort(earnedGoal)}` }}
          />
        </>
      )}
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

/** `months` maanden na `date` (de laatste dag van de maand als die dag niet bestaat). */
function monthsAfter(date: string, months: number): string {
  const target = `${shiftMonth(date.slice(0, 7), months)}-${date.slice(8)}`
  return !Number.isNaN(Date.parse(target)) && new Date(`${target}T12:00:00Z`).toISOString().slice(0, 10) === target ? target : `${shiftMonth(date.slice(0, 7), months)}-28`
}

/** Stap 1: begindatum (vanaf vandaag), de netto waarde bij de start (leeg = die van vandaag) en tot wanneer. */
function StartFields({ store, notify, scenario, today, todayValue }: { store: Store; notify: Notify; scenario: Scenario; today: string; todayValue: number }) {
  const start = simStart(scenario, today)
  const end = simEnd(scenario, today)
  // Alleen het gewijzigde veld gaat mee: twee snelle wijzigingen na elkaar overschrijven elkaar zo nooit.
  async function save(patch: { startDate?: string; startValue?: number | null; endDate?: string }) {
    const { undo } = await scenarioStartZetten(store, scenario.id, {
      ...(patch.startDate !== undefined ? { startDate: patch.startDate > today ? patch.startDate : null } : {}),
      ...(patch.startValue !== undefined ? { startValue: patch.startValue } : {}),
      ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
    })
    notify(t('scenario.saved'), undo)
  }
  return (
    <div className="scenario-fields">
      <label>
        {t('scenarioPlan.startDate')}
        <DateCell label={t('scenarioPlan.startDate')} value={start} min={today} onCommit={(v) => void save({ startDate: v })} />
      </label>
      <label>
        {t('scenarioPlan.startValue')}
        <NumberCell label={t('scenarioPlan.startValue')} value={scenario.startValue ?? null} allowNegative placeholder={amountInput(todayValue)} onCommit={(v) => void save({ startValue: v })} />
      </label>
      <label className="wide">
        {t('scenarioPlan.endDate')}
        <DateCell label={t('scenarioPlan.endDate')} value={end} min={addDays(start, 1)} onCommit={(v) => void save({ endDate: v })} />
      </label>
      <div className="type-buttons wide">
        {LOOK_AHEAD.map((m) => (
          <button key={m} type="button" aria-pressed={end === monthsAfter(start, m)} className={`chip${end === monthsAfter(start, m) ? ' active' : ''}`} onClick={() => void save({ endDate: monthsAfter(start, m) })}>
            {t('scenarioPlan.months', { n: m })}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Een blok om in te typen: weken, trips, salaris en fooi per trip, kosten per week. */
interface BlockForm {
  weeks: number
  trips: number
  salaryPerTrip: number
  tipsPerTrip: number
  costsPerWeek?: number
  currency?: Currency
}

/** Een blok als formulier; een ouder blok (bedragen per week) als één trip per week. */
function blockForm(b: ScenarioBlock): BlockForm & { currency: Currency } {
  if (b.trips !== undefined) return { weeks: b.weeks, trips: b.trips, salaryPerTrip: b.salaryPerTrip ?? 0, tipsPerTrip: b.tipsPerTrip ?? 0, ...(b.costsPerWeek !== undefined ? { costsPerWeek: b.costsPerWeek } : {}), currency: b.currency }
  const income = blockIncome(b)
  return { weeks: b.weeks, trips: b.weeks, salaryPerTrip: income.salary, tipsPerTrip: income.tips, ...(b.costsPerWeek !== undefined ? { costsPerWeek: b.costsPerWeek } : {}), currency: b.currency }
}

function formInput(f: BlockForm, fallback: Currency): BlockInput {
  return {
    weeks: f.weeks,
    incomePerWeek: 0,
    trips: f.trips,
    salaryPerTrip: f.salaryPerTrip,
    tipsPerTrip: f.tipsPerTrip,
    currency: f.currency ?? fallback,
    ...(f.costsPerWeek !== undefined ? { costsPerWeek: f.costsPerWeek } : {}),
  }
}

/** De planning als blok: de trips van de planning met het verwachte salaris en de fooi per trip. */
function planningForm(p: BlockInput & { weeks: number }): BlockForm {
  if (p.trips !== undefined) return { weeks: p.weeks, trips: p.trips, salaryPerTrip: p.salaryPerTrip ?? 0, tipsPerTrip: p.tipsPerTrip ?? 0, ...(p.costsPerWeek !== undefined ? { costsPerWeek: p.costsPerWeek } : {}), currency: p.currency }
  return { weeks: p.weeks, trips: p.weeks, salaryPerTrip: p.salaryPerWeek ?? p.incomePerWeek, tipsPerTrip: p.tipsPerWeek ?? 0, ...(p.costsPerWeek !== undefined ? { costsPerWeek: p.costsPerWeek } : {}), currency: p.currency }
}

function BlockEditor({ store, notify, scenario, row, averageCosts }: { store: Store; notify: Notify; scenario: Scenario; row: BlockRow; averageCosts: number }) {
  const block = row.block!
  const form = blockForm(block)
  const own = scenario.blocks.findIndex((b) => b.id === block.id)
  const name = t('scenario.blockN', { n: row.number })
  // Alleen het gewijzigde veld gaat mee; de rest leest de opdracht uit het blok zoals het dan is.
  async function save(patch: BlockPatch) {
    const { undo } = await blokVeldWijzigen(store, scenario.id, block.id, patch)
    notify(t('scenario.blockSaved'), undo)
  }
  async function move(by: -1 | 1) {
    const { undo } = await blokVerplaatsen(store, scenario.id, block.id, by)
    notify(t('scenario.blockMoved'), undo)
  }
  async function remove() {
    const { undo } = await blokVerwijderen(store, scenario.id, block.id)
    notify(t('scenario.blockDeleted'), undo)
  }
  const perWeek = (form.trips * (form.salaryPerTrip + form.tipsPerTrip)) / form.weeks
  return (
    <li className="scenario-block-edit">
      <div className="row scenario-block-head">
        <strong className="grow">
          {t('scenarioPlan.blockTitle', { n: row.number, weeks: row.weeks })}
          <span className="muted small">
            {' '}
            · {formatDateShort(row.from)} – {formatDateShort(row.to)}
          </span>
        </strong>
        <div className="scenario-move">
          <button type="button" className="btn icon" aria-label={`${t('scenario.up')}: ${name}`} disabled={own <= 0} onClick={() => void move(-1)}>
            <Icon icon={ArrowUp} />
          </button>
          <button type="button" className="btn icon" aria-label={`${t('scenario.down')}: ${name}`} disabled={own === scenario.blocks.length - 1} onClick={() => void move(1)}>
            <Icon icon={ArrowDown} />
          </button>
          <button type="button" className="btn icon" aria-label={`${t('common.delete')}: ${name}`} onClick={() => void remove()}>
            <Icon icon={Trash2} />
          </button>
        </div>
      </div>
      <div className="scenario-fields">
        <label>
          {t('scenario.weeks')}
          <NumberCell label={`${t('scenario.weeks')}: ${name}`} value={form.weeks} integer min={1} max={MAX_WEEKS} onCommit={(v) => v !== null && void save({ weeks: v })} />
        </label>
        <label>
          {t('scenarioPlan.trips')}
          <NumberCell label={`${t('scenarioPlan.trips')}: ${name}`} value={form.trips} integer min={0} max={MAX_TRIPS} onCommit={(v) => void save({ trips: v ?? 0 })} />
        </label>
        <label>
          {t('scenarioPlan.salaryPerTrip')}
          <NumberCell label={`${t('scenarioPlan.salaryPerTrip')}: ${name}`} value={form.salaryPerTrip} onCommit={(v) => void save({ salaryPerTrip: v ?? 0 })} />
        </label>
        <label>
          {t('scenarioPlan.tipsPerTrip')}
          <NumberCell label={`${t('scenarioPlan.tipsPerTrip')}: ${name}`} value={form.tipsPerTrip} onCommit={(v) => void save({ tipsPerTrip: v ?? 0 })} />
        </label>
        <label>
          {t('scenarioPlan.costsPerWeek')}
          <NumberCell label={`${t('scenarioPlan.costsPerWeek')}: ${name}`} value={form.costsPerWeek ?? null} placeholder={amountInput(averageCosts)} onCommit={(v) => void save({ costsPerWeek: v })} />
        </label>
        <label>
          {t('scenario.currency')}
          <select className="cell" aria-label={`${t('scenario.currency')}: ${name}`} value={form.currency} onChange={(e) => void save({ currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{t('scenarioPlan.blockPerWeek', { amount: formatMoney(perWeek, form.currency) })}</p>
    </li>
  )
}

/** Stap 3: de aannames om in te typen (procent per jaar; leeg is 0). */
function AssumptionFields({ store, notify, scenario }: { store: Store; notify: Notify; scenario: Scenario }) {
  const a = assumptionsOf(scenario)
  async function save(patch: Partial<typeof a>) {
    const { undo } = await aannameWijzigen(store, scenario.id, patch)
    notify(t('scenario.saved'), undo)
  }
  const field = (key: keyof typeof a, label: string, min: number, max: number) => (
    <label>
      {label}
      <NumberCell label={label} value={a[key] === 0 ? null : a[key]} allowNegative={min < 0} min={min} max={max} placeholder="0" onCommit={(v) => void save({ [key]: v ?? 0 })} />
    </label>
  )
  return (
    <div className="scenario-fields">
      {field('investmentGrowthPct', t('scenario.investmentGrowth'), MIN_PCT, MAX_PCT)}
      {field('assetGrowthPct', t('scenario.assetGrowth'), MIN_PCT, MAX_PCT)}
      {field('debtInterestPct', t('scenario.debtInterest'), MIN_PCT, MAX_PCT)}
      {field('investPct', t('scenario.investPct'), 0, 100)}
    </div>
  )
}

type GoalKind = 'stand' | 'netto' | 'verdiend'

/** Stap 4: waar sta ik op de einddatum, een netto waarde halen, of een bedrag verdienen; eventueel vóór een datum. */
function GoalFields({ store, notify, scenario, start, end }: { store: Store; notify: Notify; scenario: Scenario; start: string; end: string }) {
  const goal = scenario.goal
  const kind: GoalKind = goal?.kind === 'doel' ? (goal.measure === 'verdiend' ? 'verdiend' : 'netto') : 'stand'
  const amount = goal?.kind === 'doel' ? goal.amount : null
  const by = goal?.kind === 'doel' ? (goal.by ?? '') : ''
  // Alleen het gewijzigde veld gaat mee; zonder bedrag (ook net opgeslagen) is het doel "waar sta ik".
  async function save(patch: { kind?: GoalKind; amount?: number | null; by?: string | null }) {
    const { undo } = await scenarioDoelWijzigen(store, scenario.id, patch)
    notify(t('scenario.saved'), undo)
  }
  const [pending, setPending] = useState<GoalKind | null>(null)
  const shownKind = pending ?? kind
  return (
    <div className="stack-sm">
      <div className="type-buttons" role="radiogroup" aria-label={t('scenarioPlan.step4')}>
        {(['stand', 'netto', 'verdiend'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={shownKind === k}
            className={`chip${shownKind === k ? ' active' : ''}`}
            onClick={() => {
              if (k === 'stand') {
                setPending(null)
                void save({ kind: 'stand' })
              } else if (amount !== null) {
                setPending(null)
                void save({ kind: k })
              } else setPending(k)
            }}
          >
            {k === 'stand' ? t('scenarioPlan.goalStand', { date: formatDate(end) }) : t(`scenarioPlan.goalKind.${k}`)}
          </button>
        ))}
      </div>
      {shownKind !== 'stand' && (
        <div className="scenario-fields">
          <label>
            {t(shownKind === 'verdiend' ? 'scenarioPlan.goalEarned' : 'scenarioPlan.goalValue')}
            <NumberCell
              label={t(shownKind === 'verdiend' ? 'scenarioPlan.goalEarned' : 'scenarioPlan.goalValue')}
              value={amount}
              allowNegative={shownKind === 'netto'}
              onCommit={(v) => {
                setPending(null)
                void save({ kind: v === null ? 'stand' : shownKind, amount: v })
              }}
            />
          </label>
          <label>
            {t('scenarioPlan.goalBy')}
            <DateCell label={t('scenarioPlan.goalBy')} value={by} min={addDays(start, 1)} allowEmpty onCommit={(v) => void save({ kind: shownKind, by: v || null })} />
          </label>
        </div>
      )}
    </div>
  )
}
