import { booked } from '../domain/geldmodel'
import { addDays, daysBetween, shiftMonth, todayIso } from '../basis/datum'
import { round2 } from '../basis/bedrag'
import type { CalendarIndex } from './calendar'
import { fixedAmount, type DayAverage } from './costs'
import { active } from './derive'
import { eurOf } from './money'
import { forecast, positionAt, type PositionInput } from './position'
import { toEur, type RatesFile } from './rates'
import { assumptionsOf, blockIncome, MAX_HORIZON_YEARS, validOneOffs, type BlockInput } from './scenario'
import type { CostDayType, Currency, FixedCost, Scenario, ScenarioBlock, Settings, Transaction } from './types'

// Het stappenplan van een scenario (Geld → Verwacht → Scenario, november 2026): een eigen berekening, week voor week,
// helemaal uit wat in het scenario staat. Stap 1 de start (datum, netto waarde, einddatum), stap 2 de blokken (weken met
// salaris, fooi en kosten per week), stap 3 beleggen en eenmalige uitgaven, stap 4 het doel. De planning en de eerdere
// weken zijn alleen een voorstel om een blok mee te vullen (`fromPlanning`, `fromHistory`): wat in het blok staat, telt.
// Alles in euro (een blok in een andere valuta met de laatst bekende koers; zonder koers apart per valuta). Pure functies.

/** Standaard kijkt een scenario anderhalf jaar vooruit. */
export const DEFAULT_MONTHS = 18
/** Het voorstel "eerdere weken" kijkt zoveel weken terug. */
export const HISTORY_WEEKS = 12

export interface SimInput {
  scenario: Scenario
  today: string
  /** De positie van vandaag (Mijn positie): de netto waarde en de delen die groeien (beleggingen, bezittingen, schulden). */
  position: { net: number; investments: number; assets: number; debts: number }
  /** Kosten per week als een blok er zelf geen heeft (en na het laatste blok): het gemiddelde van de eerdere weken. */
  defaultCostsPerWeek: number
  rates: RatesFile | null
  /** Een ouder scenario (blokken na de planning): de planning als eerste blok tot de oude begindatum (niet opgeslagen). */
  planningBlock?: ScenarioBlock | null
}

export interface SimWeek {
  /** Maandag (of de begindag) en de laatste dag van de week. */
  from: string
  to: string
  salary: number
  tips: number
  costs: number
  oneOffs: number
  growth: number
  /** De netto waarde aan het einde van de week. */
  value: number
  /** Het blok van deze week (nummer vanaf 1), null na het laatste blok. */
  block: number | null
}

export type GoalResult =
  | { kind: 'stand'; date: string; value: number }
  | {
      kind: 'doel'
      amount: number
      /** De eerste dag waarop het doel gehaald is (het laatste blok loopt door na zijn weken); null = niet binnen 40 jaar. */
      reachedOn: string | null
      by?: string
      /** De netto waarde op de doeldatum met dit plan. */
      valueOnBy?: number
      /** Winst per week (inkomen min kosten) die nodig is om het doel op de doeldatum te halen, en die het plan nu geeft. */
      neededPerWeek?: number
      plannedPerWeek?: number
    }

export interface SimResult {
  start: string
  end: string
  startValue: number
  /** Zelf gekozen startwaarde (anders de netto waarde van vandaag). */
  ownStart: boolean
  weeks: SimWeek[]
  totals: { salary: number; tips: number; costs: number; oneOffs: number; growth: number; invested: number }
  endValue: number
  /** Inkomen of eenmalige uitgaven zonder koers, per valuta (niet meegeteld). */
  unpriced: Partial<Record<Currency, number>>
  goal: GoalResult
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** De begindag: zelf gekozen (nooit vóór vandaag), anders vandaag. */
export function simStart(scenario: Pick<Scenario, 'startDate'>, today: string): string {
  return scenario.startDate && ISO.test(scenario.startDate) && scenario.startDate > today ? scenario.startDate : today
}

/** De einddatum: zelf gekozen, anders anderhalf jaar na de start; nooit verder dan 40 jaar na vandaag. */
export function simEnd(scenario: Pick<Scenario, 'endDate' | 'startDate'>, today: string): string {
  const start = simStart(scenario, today)
  const own = scenario.endDate && ISO.test(scenario.endDate) && scenario.endDate > start ? scenario.endDate : null
  const end = own ?? addDays(`${shiftMonth(start.slice(0, 7), DEFAULT_MONTHS)}${start.slice(7)}`.replace(/-(29|30|31)$/, '-28'), 0)
  const max = `${Number(today.slice(0, 4)) + MAX_HORIZON_YEARS}${today.slice(4)}`
  return end > max ? max : end
}

const weekly = (pct: number) => Math.pow(1 + pct / 100, 1 / 52) - 1

/**
 * Rekent het scenario week voor week door: per week het salaris, de fooi en de kosten van het blok van die week (een
 * blok zonder kosten: de gemiddelde kosten), de eenmalige uitgaven van die week, en de groei van beleggingen en
 * bezittingen en de rente op schulden (per week, zodat 52 weken precies het jaarpercentage geven). Het belegde deel van
 * het inkomen gaat van het geld naar de beleggingen. `extendTo`: verder rekenen (voor het doel), het laatste blok loopt door.
 */
function run(input: SimInput, until: string, extend: boolean): { weeks: SimWeek[]; unpriced: Partial<Record<Currency, number>>; invested: number } {
  const { scenario, today, rates } = input
  const start = simStart(scenario, today)
  const a = assumptionsOf(scenario)
  const blocks = [...(input.planningBlock ? [input.planningBlock] : []), ...scenario.blocks]
  const ownStart = typeof scenario.startValue === 'number' && Number.isFinite(scenario.startValue)
  let investments = input.position.investments
  let assets = input.position.assets
  let debts = input.position.debts
  // Een zelf gekozen startwaarde verandert alleen het geld; beleggingen, bezittingen en schulden blijven die van vandaag.
  let cash = (ownStart ? scenario.startValue! : input.position.net) - investments - assets - debts
  const oneOffs = validOneOffs(scenario)
  const unpriced: Partial<Record<Currency, number>> = {}
  const weeks: SimWeek[] = []
  let invested = 0
  let blockIndex = 0
  let weekInBlock = 0
  const eur = (amount: number, currency: Currency, date: string) => {
    if (amount === 0) return 0
    const hit = toEur(amount, currency, date, rates)
    if (!hit) {
      unpriced[currency] = round2((unpriced[currency] ?? 0) + amount)
      return 0
    }
    return hit.eur
  }
  for (let from = start; from <= until; from = addDays(from, 7)) {
    const to = addDays(from, 6) > until ? until : addDays(from, 6)
    // Het blok van deze week; na het laatste blok (bij doorrekenen voor het doel) loopt het laatste blok door.
    while (blockIndex < blocks.length && weekInBlock >= blocks[blockIndex]!.weeks) {
      blockIndex++
      weekInBlock = 0
    }
    const block = blocks[blockIndex] ?? (extend ? blocks.at(-1) : undefined)
    const share = (daysBetween(from, to) + 1) / 7
    const income = block ? blockIncome(block) : { salary: 0, tips: 0 }
    const salary = block ? eur(income.salary * share, block.currency, from) : 0
    const tips = block ? eur(income.tips * share, block.currency, from) : 0
    const costs = block?.costsPerWeek !== undefined ? eur(block.costsPerWeek * share, block.currency, from) : input.defaultCostsPerWeek * share
    const once = oneOffs.filter((o) => o.date >= from && o.date <= to && o.date > today).reduce((n, o) => n + eur(o.amount, o.currency, o.date), 0)
    const toInvest = ((salary + tips) * a.investPct) / 100
    const growth = (investments * weekly(a.investmentGrowthPct) + assets * weekly(a.assetGrowthPct) + debts * weekly(a.debtInterestPct)) * share
    investments += investments * weekly(a.investmentGrowthPct) * share + toInvest
    assets += assets * weekly(a.assetGrowthPct) * share
    debts += debts * weekly(a.debtInterestPct) * share
    cash += salary + tips - costs - once - toInvest
    invested += toInvest
    weekInBlock++
    weeks.push({
      from,
      to,
      salary: round2(salary),
      tips: round2(tips),
      costs: round2(costs),
      oneOffs: round2(once),
      growth: round2(growth),
      value: round2(cash + investments + assets + debts),
      block: blocks[blockIndex] ? blockIndex + 1 : null,
    })
  }
  return { weeks, unpriced, invested }
}

export function simulate(input: SimInput): SimResult {
  const { scenario, today } = input
  const start = simStart(scenario, today)
  const end = simEnd(scenario, today)
  const { weeks, unpriced, invested } = run(input, end, false)
  const sum = (key: 'salary' | 'tips' | 'costs' | 'oneOffs' | 'growth') => round2(weeks.reduce((n, w) => n + w[key], 0))
  const ownStart = typeof scenario.startValue === 'number' && Number.isFinite(scenario.startValue)
  const startValue = round2(ownStart ? scenario.startValue! : input.position.net)
  const endValue = weeks.at(-1)?.value ?? startValue
  const goal = scenario.goal?.kind === 'doel' ? goalFor(input, scenario.goal.amount, scenario.goal.by, startValue) : { kind: 'stand' as const, date: end, value: endValue }
  return {
    start,
    end,
    startValue,
    ownStart,
    weeks,
    totals: { salary: sum('salary'), tips: sum('tips'), costs: sum('costs'), oneOffs: sum('oneOffs'), growth: sum('growth'), invested: round2(invested) },
    endValue,
    unpriced,
    goal,
  }
}

/**
 * Een doelbedrag: wanneer het gehaald is (het laatste blok loopt door, hoogstens 40 jaar), en met een doeldatum de
 * winst per week die nodig is: wat het plan tot die datum per week geeft, plus het tekort gedeeld door de weken.
 */
function goalFor(input: SimInput, amount: number, by: string | undefined, startValue: number): GoalResult {
  const start = simStart(input.scenario, input.today)
  const max = `${Number(input.today.slice(0, 4)) + MAX_HORIZON_YEARS}${input.today.slice(4)}`
  const result: Extract<GoalResult, { kind: 'doel' }> = { kind: 'doel', amount, reachedOn: startValue >= amount ? start : null }
  if (result.reachedOn === null) {
    const long = run(input, max, true).weeks
    result.reachedOn = long.find((w) => w.value >= amount)?.to ?? null
  }
  if (by && ISO.test(by) && by > start) {
    result.by = by
    const toBy = run(input, by, true).weeks
    const weeks = Math.max(1, (daysBetween(start, by) + 1) / 7)
    const valueOnBy = toBy.at(-1)?.value ?? startValue
    const planned = toBy.reduce((n, w) => n + w.salary + w.tips - w.costs, 0) / weeks
    result.valueOnBy = round2(valueOnBy)
    result.plannedPerWeek = round2(planned)
    result.neededPerWeek = round2(planned + (amount - valueOnBy) / weeks)
  }
  return result
}

/** Per maand (jjjj-mm) het inkomen en de kosten, en de netto waarde aan het einde van de maand (voor de grafieken). */
export function simMonths(result: SimResult): { month: string; income: number; costs: number; value: number }[] {
  const out: { month: string; income: number; costs: number; value: number }[] = []
  for (const w of result.weeks) {
    const month = w.to.slice(0, 7)
    const last = out.at(-1)
    if (last && last.month === month) {
      last.income = round2(last.income + w.salary + w.tips)
      last.costs = round2(last.costs + w.costs + w.oneOffs)
      last.value = w.value
    } else out.push({ month, income: round2(w.salary + w.tips), costs: round2(w.costs + w.oneOffs), value: w.value })
  }
  return out
}

// ---------- Voorstellen om een blok mee te vullen ----------

/**
 * Wat de afgelopen weken per week opleverden en kostten (de voorspelling "gebaseerd op eerdere weken"): het salaris en
 * de fooi die echt binnenkwamen, de losse uitgaven (zonder declaraties en zonder geboekte vaste lasten) en de vaste
 * lasten van deze maand, in euro. `weeks`: het aantal weken terug tot en met gisteren.
 */
export function fromHistory(transactions: readonly Transaction[], fixed: readonly FixedCost[], today: string = todayIso(), weeks = HISTORY_WEEKS, rates: RatesFile | null = null): { salary: number; tips: number; costs: number } {
  const from = addDays(today, -7 * weeks)
  const to = addDays(today, -1)
  let salary = 0
  let tips = 0
  let costs = 0
  for (const tx of booked(transactions)) {
    if (tx.date < from || tx.date > to) continue
    const value = eurOf(tx)
    if (value === null) continue
    if (tx.kind === 'loon') salary += value
    else if (tx.kind === 'fooi') tips += value
    else if ((tx.kind === 'kosten' || tx.kind === 'investering') && !tx.claimId && !tx.fixedCostId) costs += value
  }
  const month = today.slice(0, 7)
  const fixedPerMonth = active(fixed).reduce((n, c) => n + (toEur(fixedAmount(c, month), c.currency, today, rates)?.eur ?? 0), 0)
  return { salary: round2(salary / weeks), tips: round2(tips / weeks), costs: round2(costs / weeks + (fixedPerMonth * 12) / 52) }
}

/**
 * Wat de planning (trips en periodes in de agenda) per week geeft van vandaag tot het einde van de planning: het
 * verwachte salaris, de geschatte fooi en de kosten (vaste lasten en het gemiddelde per dagsoort), zoals in Gepland.
 * Null zonder planning na vandaag. De weken zijn het aantal hele weken tot het einde van de planning.
 */
export function fromPlanning(input: PositionInput, settings: Settings, today: string, planningEnd: string | null, fixed: readonly FixedCost[], averages: Record<CostDayType, DayAverage>, index: CalendarIndex): (BlockInput & { weeks: number }) | null {
  if (!planningEnd || planningEnd <= today) return null
  const f = forecast(input, settings, today, planningEnd, 6, { fixed, averages, index }, { from: today, to: planningEnd })
  if (!f.lines) return null
  const weeks = Math.max(1, Math.ceil((daysBetween(today, planningEnd) + 1) / 7))
  const salary = round2(f.lines.salary / weeks)
  const tips = round2(f.lines.tips / weeks)
  return { weeks, incomePerWeek: round2(salary + tips), salaryPerWeek: salary, tipsPerWeek: tips, currency: 'EUR', costsPerWeek: round2(-f.lines.costs / weeks) }
}

/** De positie van vandaag als startpunt (de netto waarde en wat daarvan groeit), het eurodeel. */
export function startPosition(input: PositionInput, today: string): SimInput['position'] {
  const p = positionAt(input, today)
  return { net: p.totals.net.eur, investments: p.totals.investments.eur, assets: p.totals.assets.eur, debts: p.totals.debts.eur }
}
