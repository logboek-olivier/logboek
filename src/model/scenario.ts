import type { Tx } from '../domain/tx'
import { toEur } from './accounts'
import { active } from './derive'
import type { RatesFile } from './rates'
import { newId, type Currency, type Scenario, type ScenarioBlock } from './types'
import { round2 } from '../basis/bedrag'
import { addDays, monthEnd } from '../basis/datum'

// Geld → Verwacht → Scenario: wat er ná de planning zou kunnen gebeuren. Een scenario is een naam en een rij blokken
// (aantal weken, inkomen per week, valuta, optioneel kosten per week). Het eerste blok begint op de dag na het einde van
// de planning (aan te passen), elk volgend blok direct na het vorige. Meerdere scenario's met een naam; één is actief
// (`settings.activeScenarioId`, gesynct). Geen bedragen of datums van een bepaalde gebruiker: alles komt uit de data.
// Scenario's synchroniseren zoals elk record (scenarios.json.enc: id, updatedAt, deletedAt).

/** Hoogstens zoveel blokken en weken: een tikfout maakt geen vooruitblik van honderd jaar. */
export const MAX_BLOCKS = 20
export const MAX_WEEKS = 260

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

/** De laatste dag van het scenario (null zonder blokken). */
export function scenarioEnd(ranges: readonly BlockRange[]): string | null {
  return ranges.at(-1)?.to ?? null
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

/** Dagen van `from` tot en met `to`. */
function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
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

/** Tombstone zonder naam of bedragen. */
export async function deleteScenario(tx: Tx, id: string): Promise<void> {
  const scenario = current(tx, id)
  await tx.put('scenarios.json.enc', { id: scenario.id, name: '', blocks: [], updatedAt: tx.now, deletedAt: tx.now })
}
