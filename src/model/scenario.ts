import type { Tx } from '../domain/tx'
import { active } from './derive'
import { toEur, type RatesFile } from './rates'
import { newId, type Currency, type Scenario, type ScenarioAssumptions, type ScenarioBlock, type ScenarioOneOff } from './types'
import { round2 } from '../basis/bedrag'
import { addDays, dayCount, monthEnd } from '../basis/datum'

// Geld → Verwacht → Scenario: wat er ná de planning zou kunnen gebeuren. Een scenario is een naam en een rij blokken
// (aantal weken, inkomen per week, valuta, optioneel kosten per week). Het eerste blok begint op de dag na het einde van
// de planning (aan te passen), elk volgend blok direct na het vorige. Meerdere scenario's met een naam; één is actief
// (`settings.activeScenarioId`, gesynct). Geen bedragen of datums van een bepaalde gebruiker: alles komt uit de data.
// Scenario's synchroniseren zoals elk record (scenarios.json.enc: id, updatedAt, deletedAt).

/** Hoogstens zoveel blokken en weken: een tikfout maakt geen vooruitblik van honderd jaar. */
export const MAX_BLOCKS = 20
export const MAX_WEEKS = 260
/** Hoogstens zoveel eenmalige uitgaven, en zo ver vooruit (jaren) als horizon. */
export const MAX_ONE_OFFS = 50
export const MAX_HORIZON_YEARS = 40
/** Groei en rente tussen −50 en +100 procent per jaar; het belegde deel tussen 0 en 100 procent. */
export const MIN_PCT = -50
export const MAX_PCT = 100

export interface BlockRange {
  block: ScenarioBlock
  /** 1, 2, 3 … */
  number: number
  /** jjjj-mm-dd, beide inclusief. */
  from: string
  to: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** De dag waarop het eerste blok begint: de eigen begindatum, anders de dag na het einde van de planning (of na vandaag). */
export function scenarioStart(scenario: Pick<Scenario, 'startDate'>, planningEnd: string | null, today: string): string {
  if (scenario.startDate && ISO.test(scenario.startDate)) return scenario.startDate
  const end = planningEnd && planningEnd > today ? planningEnd : today
  return addDays(end, 1)
}

/** Een blok dat meetelt: een geheel aantal weken (1 tot en met MAX_WEEKS) en geldige bedragen. */
export function validBlock(block: ScenarioBlock): boolean {
  return (
    Number.isInteger(block.weeks) &&
    block.weeks >= 1 &&
    block.weeks <= MAX_WEEKS &&
    Number.isFinite(block.incomePerWeek) &&
    block.incomePerWeek >= 0 &&
    (block.costsPerWeek === undefined || (Number.isFinite(block.costsPerWeek) && block.costsPerWeek >= 0))
  )
}

/** De blokken met hun datums, het eerste op `start`, elk volgend direct na het vorige. */
export function blockRanges(scenario: Pick<Scenario, 'blocks'>, start: string): BlockRange[] {
  const out: BlockRange[] = []
  let from = start
  for (const block of scenario.blocks.slice(0, MAX_BLOCKS)) {
    if (!validBlock(block)) continue
    const to = addDays(from, block.weeks * 7 - 1)
    out.push({ block, number: out.length + 1, from, to })
    from = addDays(to, 1)
  }
  return out
}

/** De laatste dag van de blokken (null zonder blokken). */
export function scenarioEnd(ranges: readonly BlockRange[]): string | null {
  return ranges.at(-1)?.to ?? null
}

/** De aannames zoals ze gelden: ontbrekend of ongeldig is 0 (nooit verzonnen). */
export function assumptionsOf(scenario: Pick<Scenario, 'assumptions'>): Required<ScenarioAssumptions> {
  const a = scenario.assumptions ?? {}
  const pct = (v: number | undefined, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : 0)
  return {
    investmentGrowthPct: pct(a.investmentGrowthPct, MIN_PCT, MAX_PCT),
    assetGrowthPct: pct(a.assetGrowthPct, MIN_PCT, MAX_PCT),
    debtInterestPct: pct(a.debtInterestPct, MIN_PCT, MAX_PCT),
    investPct: pct(a.investPct, 0, 100),
  }
}

/** De eenmalige uitgaven die meetellen: een geldige datum en een bedrag boven nul, op datum. */
export function validOneOffs(scenario: Pick<Scenario, 'oneOffs'>): ScenarioOneOff[] {
  return (scenario.oneOffs ?? [])
    .filter((o) => ISO.test(o.date) && Number.isFinite(o.amount) && o.amount > 0)
    .slice(0, MAX_ONE_OFFS)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/**
 * De horizon van een scenario: de eigen einddatum ("kijk vooruit tot"), anders de laatste dag van de blokken of van de
 * laatste eenmalige uitgave (wat later is); null als er niets is. Nooit verder dan MAX_HORIZON_YEARS na vandaag.
 */
export function scenarioHorizon(scenario: Pick<Scenario, 'endDate' | 'oneOffs'>, ranges: readonly BlockRange[], today: string): string | null {
  const cap = `${Number(today.slice(0, 4)) + MAX_HORIZON_YEARS}${today.slice(4)}`
  const own = scenario.endDate && ISO.test(scenario.endDate) ? scenario.endDate : null
  const candidates = own ? [own] : [scenarioEnd(ranges), validOneOffs(scenario).at(-1)?.date ?? null].filter((d): d is string => !!d)
  if (candidates.length === 0) return null
  const last = candidates.sort().at(-1)!
  return last > cap ? cap : last
}

/** Alles wat de vooruitblik van een scenario nodig heeft, één keer uitgerekend. */
export interface ScenarioPlan {
  ranges: BlockRange[]
  assumptions: Required<ScenarioAssumptions>
  oneOffs: ScenarioOneOff[]
  /** De horizon: de laatste dag van de vooruitblik (null zonder blokken, uitgaven of einddatum). */
  end: string | null
}

export function scenarioPlan(scenario: Scenario, planningEnd: string | null, today: string): ScenarioPlan {
  const ranges = blockRanges(scenario, scenarioStart(scenario, planningEnd, today))
  return { ranges, assumptions: assumptionsOf(scenario), oneOffs: validOneOffs(scenario), end: scenarioHorizon(scenario, ranges, today) }
}

/** Maandrente uit een jaarpercentage: (1 + p)^(1/12) − 1, zodat twaalf maanden precies p geven. */
export function monthlyRate(pctPerYear: number): number {
  return Math.pow(1 + pctPerYear / 100, 1 / 12) - 1
}

export interface ScenarioPart {
  range: BlockRange
  /** jjjj-mm */
  month: string
  /** De laatste dag van dit deel (einde van de maand of van het blok). */
  date: string
  days: number
  /** Inkomen in deze dagen, in de valuta van het blok, en in euro (null zonder koers). */
  income: number
  incomeEur: number | null
  /** Kosten van het blok in deze dagen (alleen als het blok kosten per week heeft). */
  costs: number | null
  costsEur: number | null
  provisional: boolean
}

/**
 * Elk blok per maand: het inkomen (en de kosten, als het blok ze heeft) naar rato van de dagen, tot en met `until` (de
 * einddatum van de vooruitblik) en (met `today`) alleen na vandaag. Cumulatief afgerond, zodat de delen van een blok samen precies weken × bedrag per week
 * zijn. Euro met de koers van de laatste dag van het deel (na het koersbestand de laatst bekende, voorlopig); zonder
 * koers null, nooit een verzonnen koers.
 */
export function scenarioParts(ranges: readonly BlockRange[], until: string, rates: RatesFile | null, today?: string): ScenarioPart[] {
  const out: ScenarioPart[] = []
  // Alleen de dagen na vandaag: een blok dat al begonnen is (een begindatum in het verleden), telt vanaf morgen.
  const first = today ? addDays(today, 1) : null
  for (const range of ranges) {
    const total = range.block.weeks * 7
    const share = (amount: number, upTo: number) => Math.round((amount * range.block.weeks * 100 * upTo) / total) / 100
    const last = range.to < until ? range.to : until
    let from = first && first > range.from ? first : range.from
    let done = dayCount(range.from, from) - 1
    while (from <= last) {
      const month = from.slice(0, 7)
      const end = monthEnd(month) < last ? monthEnd(month) : last
      const days = dayCount(from, end)
      const income = round2(share(range.block.incomePerWeek, done + days) - share(range.block.incomePerWeek, done))
      const costs = range.block.costsPerWeek === undefined ? null : round2(share(range.block.costsPerWeek, done + days) - share(range.block.costsPerWeek, done))
      const inEur = toEur(income, range.block.currency, end, rates)
      const costEur = costs === null ? null : toEur(costs, range.block.currency, end, rates)
      out.push({
        range,
        month,
        date: end,
        days,
        income,
        incomeEur: inEur?.eur ?? null,
        costs,
        costsEur: costs === null ? null : (costEur?.eur ?? null),
        provisional: !!(inEur?.provisional || costEur?.provisional),
      })
      done += days
      from = addDays(end, 1)
    }
  }
  return out
}

/** Of een dag in een blok met eigen kosten valt (dan geldt niet het gemiddelde per dagsoort). */
export function ownCostsOn(ranges: readonly BlockRange[], date: string): boolean {
  return ranges.some((r) => r.block.costsPerWeek !== undefined && r.from <= date && date <= r.to)
}

export function liveScenarios(scenarios: readonly Scenario[]): Scenario[] {
  return active(scenarios).sort((a, b) => a.name.localeCompare(b.name))
}

/** Het actieve scenario: dat uit de instellingen, anders het enige; null als er geen is of het weg is. */
export function activeScenario(scenarios: readonly Scenario[], activeId: string | null | undefined): Scenario | null {
  const live = liveScenarios(scenarios)
  return live.find((s) => s.id === activeId) ?? (live.length === 1 ? live[0]! : null)
}

// ---------- Opslaan (via de opdrachten in src/domain/geld.ts) ----------

export interface BlockInput {
  weeks: number
  incomePerWeek: number
  currency: Currency
  costsPerWeek?: number
}

function cleanBlock(id: string, input: BlockInput): ScenarioBlock {
  return {
    id,
    weeks: Math.min(MAX_WEEKS, Math.max(1, Math.round(input.weeks))),
    incomePerWeek: round2(Math.max(0, input.incomePerWeek)),
    currency: input.currency,
    ...(input.costsPerWeek !== undefined && Number.isFinite(input.costsPerWeek) ? { costsPerWeek: round2(Math.max(0, input.costsPerWeek)) } : {}),
  }
}

function current(tx: Tx, id: string): Scenario {
  const found = tx.get('scenarios.json.enc').find((s) => s.id === id && s.deletedAt === null)
  if (!found) throw new Error('Scenario bestaat niet')
  return found
}

async function write(tx: Tx, scenario: Scenario): Promise<Scenario> {
  const next: Scenario = { ...scenario, updatedAt: tx.now }
  await tx.put('scenarios.json.enc', next)
  return next
}

/** Een nieuw scenario met een naam (en meteen actief). */
export async function createScenario(tx: Tx, name: string): Promise<Scenario> {
  const scenario: Scenario = { id: newId(), name: name.trim().slice(0, 60) || 'Scenario', blocks: [], updatedAt: tx.now, deletedAt: null }
  await tx.put('scenarios.json.enc', scenario)
  return scenario
}

export async function renameScenario(tx: Tx, id: string, name: string): Promise<Scenario> {
  return write(tx, { ...current(tx, id), name: name.trim().slice(0, 60) || current(tx, id).name })
}

/** Begindatum aanpassen; null = weer de dag na het einde van de planning. */
export async function setScenarioStart(tx: Tx, id: string, startDate: string | null): Promise<Scenario> {
  const next: Scenario = { ...current(tx, id) }
  if (startDate && ISO.test(startDate)) next.startDate = startDate
  else delete next.startDate
  return write(tx, next)
}

export async function addScenarioBlock(tx: Tx, id: string, input: BlockInput): Promise<Scenario> {
  const scenario = current(tx, id)
  if (scenario.blocks.length >= MAX_BLOCKS) return scenario
  return write(tx, { ...scenario, blocks: [...scenario.blocks, cleanBlock(newId(), input)] })
}

/** Een blok wijzigen: weken, inkomen, valuta en kosten zoals ingevuld (leeg = de gemiddelde kosten per dagsoort). */
export async function changeScenarioBlock(tx: Tx, id: string, blockId: string, input: BlockInput): Promise<Scenario> {
  const scenario = current(tx, id)
  return write(tx, { ...scenario, blocks: scenario.blocks.map((b) => (b.id === blockId ? cleanBlock(blockId, input) : b)) })
}

export async function removeScenarioBlock(tx: Tx, id: string, blockId: string): Promise<Scenario> {
  const scenario = current(tx, id)
  return write(tx, { ...scenario, blocks: scenario.blocks.filter((b) => b.id !== blockId) })
}

/** Een blok één plek omhoog (-1) of omlaag (+1). */
export async function moveScenarioBlock(tx: Tx, id: string, blockId: string, by: -1 | 1): Promise<Scenario> {
  const scenario = current(tx, id)
  const i = scenario.blocks.findIndex((b) => b.id === blockId)
  const j = i + by
  if (i < 0 || j < 0 || j >= scenario.blocks.length) return scenario
  const blocks = [...scenario.blocks]
  ;[blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!]
  return write(tx, { ...scenario, blocks })
}

/** Aannames opslaan (alleen geldige percentages; leeg = 0). */
export async function setAssumptions(tx: Tx, id: string, input: ScenarioAssumptions): Promise<Scenario> {
  const clean: ScenarioAssumptions = {}
  const keep = (key: keyof ScenarioAssumptions, min: number, max: number) => {
    const v = input[key]
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) clean[key] = Math.min(max, Math.max(min, Math.round(v * 100) / 100))
  }
  keep('investmentGrowthPct', MIN_PCT, MAX_PCT)
  keep('assetGrowthPct', MIN_PCT, MAX_PCT)
  keep('debtInterestPct', MIN_PCT, MAX_PCT)
  keep('investPct', 0, 100)
  const next: Scenario = { ...current(tx, id) }
  if (Object.keys(clean).length > 0) next.assumptions = clean
  else delete next.assumptions
  return write(tx, next)
}

/** Begindatum en horizon in één keer (één keer ongedaan maken). */
export async function setScenarioDates(tx: Tx, id: string, startDate: string | null, endDate: string | null): Promise<Scenario> {
  await setScenarioStart(tx, id, startDate)
  return setScenarioEnd(tx, id, endDate)
}

/** Horizon aanpassen; null = tot het einde van het laatste blok of de laatste eenmalige uitgave. */
export async function setScenarioEnd(tx: Tx, id: string, endDate: string | null): Promise<Scenario> {
  const next: Scenario = { ...current(tx, id) }
  if (endDate && ISO.test(endDate)) next.endDate = endDate
  else delete next.endDate
  return write(tx, next)
}

export interface OneOffInput {
  name: string
  date: string
  amount: number
  currency: Currency
}

function cleanOneOff(id: string, input: OneOffInput): ScenarioOneOff {
  return { id, name: input.name.trim().slice(0, 60), date: input.date, amount: round2(Math.max(0, input.amount)), currency: input.currency }
}

export async function addOneOff(tx: Tx, id: string, input: OneOffInput): Promise<Scenario> {
  const scenario = current(tx, id)
  if ((scenario.oneOffs ?? []).length >= MAX_ONE_OFFS || !ISO.test(input.date)) return scenario
  return write(tx, { ...scenario, oneOffs: [...(scenario.oneOffs ?? []), cleanOneOff(newId(), input)] })
}

export async function changeOneOff(tx: Tx, id: string, oneOffId: string, input: OneOffInput): Promise<Scenario> {
  const scenario = current(tx, id)
  if (!ISO.test(input.date)) return scenario
  return write(tx, { ...scenario, oneOffs: (scenario.oneOffs ?? []).map((o) => (o.id === oneOffId ? cleanOneOff(oneOffId, input) : o)) })
}

export async function removeOneOff(tx: Tx, id: string, oneOffId: string): Promise<Scenario> {
  const scenario = current(tx, id)
  return write(tx, { ...scenario, oneOffs: (scenario.oneOffs ?? []).filter((o) => o.id !== oneOffId) })
}

/** Tombstone zonder naam, bedragen of aannames. */
export async function deleteScenario(tx: Tx, id: string): Promise<void> {
  const scenario = current(tx, id)
  await tx.put('scenarios.json.enc', { id: scenario.id, name: '', blocks: [], updatedAt: tx.now, deletedAt: tx.now })
}
