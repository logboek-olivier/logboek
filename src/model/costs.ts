import type { Store } from '../storage/store'
import { dayInfo, type CalendarIndex } from './calendar'
import { active } from './derive'
import type { Undo } from './edit'
import { addDays, eurOf, mondayOf, round2 } from './money'
import { rateFor, type RatesFile } from './rates'
import { COST_DAY_TYPES, newId, type CostDayType, type Currency, type DayType, type FixedCost, type Settings, type Transaction, type WeekClosing } from './types'

// Kosten, met zo weinig werk mogelijk. Vaste lasten: een lijst met per last het bedrag per maand, waarbij een wijziging
// geldt vanaf een maand (oude maanden blijven kloppen). Variabele kosten: losse uitgaven (Toevoegen → Uitgave, ook
// zonder trip, met een soort) en de schatting "ongeveer los uitgegeven deze week" bij de weekafsluiting. De vooruitblik
// gebruikt per dagsoort (thuis, reis, werk, rust) het eigen gemiddelde per dag, geleerd uit die gegevens; zolang er te
// weinig is, het standaardbedrag per dagsoort uit Instellingen (en zonder standaard: nog onbekend, nooit verzonnen).

const month = (date: string) => date.slice(0, 7)

function shiftMonth(m: string, n: number): string {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, mm - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function daysInMonth(m: string): number {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, mm, 0)).getUTCDate()
}

/** Het bedrag van een vaste last in een maand: het laatste bedrag vanaf die maand of eerder (0 vóór het begin). */
export function fixedAmount(cost: FixedCost, m: string): number {
  let amount = 0
  for (const a of [...cost.amounts].sort((x, y) => x.from.localeCompare(y.from))) if (a.from <= m) amount = a.amount
  return amount
}

function eur(amount: number, currency: Currency, date: string, rates: RatesFile | null): number | null {
  if (currency === 'EUR') return amount
  const hit = rateFor(rates, currency, date)
  return hit ? round2(amount / hit.rate) : null
}

/** Vaste lasten van een maand in euro; zonder koers per valuta apart. */
export function fixedInMonth(costs: readonly FixedCost[], m: string, rates: RatesFile | null): { eur: number; other: Partial<Record<Currency, number>> } {
  const out = { eur: 0, other: {} as Partial<Record<Currency, number>> }
  for (const c of active(costs)) {
    const amount = fixedAmount(c, m)
    if (amount <= 0) continue
    const v = eur(amount, c.currency, `${m}-01`, rates)
    if (v === null) out.other[c.currency] = round2((out.other[c.currency] ?? 0) + amount)
    else out.eur = round2(out.eur + v)
  }
  return out
}

/** Een nieuwe vaste last vanaf een maand. */
export async function addFixedCost(store: Store, input: { name: string; amount: number; currency: Currency; from: string }): Promise<FixedCost> {
  const record: FixedCost = {
    id: newId(),
    name: input.name.trim().slice(0, 80),
    currency: input.currency,
    amounts: [{ from: input.from, amount: round2(input.amount) }],
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }
  await store.put('fixedcosts.json.enc', record)
  void store.sync()
  return record
}

/**
 * Een vaste last wijzigen vanaf een maand (0 = stoppen): het nieuwe bedrag geldt vanaf die maand; een eerdere wijziging
 * voor die maand of later vervalt. Oude maanden blijven zoals ze waren. Met ongedaan maken.
 */
export async function changeFixedCost(store: Store, cost: FixedCost, change: { name?: string; amount: number; from: string }): Promise<Undo> {
  const before = store.list('fixedcosts.json.enc').find((c) => c.id === cost.id) ?? cost
  const amounts = [...before.amounts.filter((a) => a.from < change.from), { from: change.from, amount: round2(Math.max(0, change.amount)) }]
  const next: FixedCost = { ...before, ...(change.name !== undefined ? { name: change.name.trim().slice(0, 80) || before.name } : {}), amounts, updatedAt: new Date().toISOString() }
  await store.put('fixedcosts.json.enc', next)
  void store.sync()
  return async () => {
    await store.put('fixedcosts.json.enc', { ...before, updatedAt: new Date().toISOString() })
    void store.sync()
  }
}

/** Een vaste last verwijderen (tombstone zonder naam of bedragen); ongedaan maken zet hem uit het geheugen terug. */
export async function deleteFixedCost(store: Store, cost: FixedCost): Promise<Undo> {
  const original = { ...cost }
  const now = new Date().toISOString()
  await store.put('fixedcosts.json.enc', { id: cost.id, name: '', currency: cost.currency, amounts: [], updatedAt: now, deletedAt: now })
  void store.sync()
  return async () => {
    await store.put('fixedcosts.json.enc', { ...original, updatedAt: new Date().toISOString(), deletedAt: null })
    void store.sync()
  }
}

/** Dagsoort voor de kosten: werk, rust en reis zoals in de agenda; al het andere (thuis, onbeschikbaar, beschikbaar, optie, leeg) thuis. */
export function costDayType(type: DayType | null): CostDayType {
  return type === 'werk' || type === 'rust' || type === 'reis' ? type : 'thuis'
}

/** Zoveel dagen van een dagsoort met gegevens zijn nodig voor een eigen gemiddelde. */
export const MIN_LEARNED_DAYS = 14
/** Zo ver kijkt het gemiddelde terug (de laatste twaalf weken). */
const WINDOW_DAYS = 84

export interface DayAverage {
  perDay: number
  /** geleerd: uit eigen gegevens; standaard: het standaardbedrag; onbekend: nog niets (telt als 0, zo gemeld). */
  source: 'geleerd' | 'standaard' | 'onbekend'
  /** Dagen van deze soort met gegevens in de laatste twaalf weken. */
  days: number
}

/**
 * Variabele kosten per dag per dagsoort, uit de laatste twaalf weken tot en met gisteren. Alleen weken met gegevens
 * tellen (een week met de schatting "los uitgegeven" of minstens één uitgave): daarin telt elke uitgave (soort kosten,
 * geen investering) op de dagsoort van haar datum, en de weekschatting gelijk verdeeld over de zeven dagen. Met minder
 * dan 14 dagen van een soort: het standaardbedrag, anders onbekend.
 */
export function dayAverages(transactions: readonly Transaction[], closings: readonly WeekClosing[], index: CalendarIndex, today: string, settings: Settings, rates: RatesFile | null): Record<CostDayType, DayAverage> {
  const end = addDays(today, -1)
  const start = addDays(today, -WINDOW_DAYS)
  const spend = new Map<string, number>()
  const observed = new Set<string>()
  for (const tx of active(transactions)) {
    // Een uitgave die gedeclareerd wordt (claimId), komt terug: geen losse kosten van het leven.
    // Een geboekte vaste last is geen losse uitgave (die staat al bij de vaste lasten).
    if (tx.kind !== 'kosten' || tx.claimId || tx.fixedCostId || tx.date < start || tx.date > end) continue
    const v = eurOf(tx)
    if (v === null) continue
    spend.set(tx.date, (spend.get(tx.date) ?? 0) + v)
    observed.add(mondayOf(tx.date))
  }
  for (const c of active(closings)) {
    if (!c.spent || c.spent.amount <= 0) continue
    const v = eur(c.spent.amount, c.spent.currency, c.start, rates)
    if (v === null) continue
    observed.add(c.start)
    for (let i = 0; i < 7; i++) {
      const d = addDays(c.start, i)
      if (d < start || d > end) continue
      spend.set(d, (spend.get(d) ?? 0) + v / 7)
    }
  }
  const totals: Record<CostDayType, { spend: number; days: number }> = { thuis: { spend: 0, days: 0 }, reis: { spend: 0, days: 0 }, werk: { spend: 0, days: 0 }, rust: { spend: 0, days: 0 } }
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!observed.has(mondayOf(d))) continue
    const type = costDayType(dayInfo(index, d, today).type)
    totals[type].days++
    totals[type].spend += spend.get(d) ?? 0
  }
  const out = {} as Record<CostDayType, DayAverage>
  for (const type of COST_DAY_TYPES) {
    const { spend: s, days } = totals[type]
    const fallback = settings.costDefaults?.[type]
    if (days >= MIN_LEARNED_DAYS) out[type] = { perDay: round2(s / days), source: 'geleerd', days }
    else if (typeof fallback === 'number' && fallback > 0) out[type] = { perDay: fallback, source: 'standaard', days }
    else out[type] = { perDay: 0, source: 'onbekend', days }
  }
  return out
}

export interface CostMonth {
  /** jjjj-mm */
  month: string
  fixedEur: number
  variableEur: number
  /** Een dagsoort zonder gemiddelde of standaard kwam voor: de variabele kosten zijn dan te laag. */
  unknown: boolean
}

/**
 * Verwachte kosten van morgen tot en met het einde van `until` (jjjj-mm), per maand: vaste lasten (de lopende maand naar
 * rato van de dagen die nog komen) en variabele kosten (per dag het gemiddelde van de dagsoort uit de agenda).
 */
export function expectedCosts(fixed: readonly FixedCost[], averages: Record<CostDayType, DayAverage>, index: CalendarIndex, today: string, until: string, rates: RatesFile | null): CostMonth[] {
  const out: CostMonth[] = []
  const first = month(today)
  for (let m = first; m <= until; m = shiftMonth(m, 1)) {
    const total = daysInMonth(m)
    const startDay = m === first ? Number(today.slice(8, 10)) + 1 : 1
    const remaining = Math.max(0, total - startDay + 1)
    const f = fixedInMonth(fixed, m, rates).eur
    let variable = 0
    let unknown = false
    for (let day = startDay; day <= total; day++) {
      const date = `${m}-${String(day).padStart(2, '0')}`
      const avg = averages[costDayType(dayInfo(index, date, today).type)]
      variable += avg.perDay
      if (avg.source === 'onbekend') unknown = true
    }
    out.push({ month: m, fixedEur: round2((f * remaining) / total), variableEur: round2(variable), unknown })
  }
  return out
}

/** Standaardbedragen per dagsoort uit het invoerblad: alleen positieve bedragen op twee decimalen. */
export function cleanDefaults(input: Partial<Record<CostDayType, number | null>>): Partial<Record<CostDayType, number>> {
  const out: Partial<Record<CostDayType, number>> = {}
  for (const type of COST_DAY_TYPES) {
    const v = input[type]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[type] = round2(v)
  }
  return out
}
