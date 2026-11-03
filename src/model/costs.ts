import type { Tx } from '../domain/tx'
import { dayInfo, type CalendarIndex } from './calendar'
import { active } from './derive'
import { eurOf } from './money'
import { toEur, type RatesFile } from './rates'
import { COST_DAY_TYPES, newId, type CostDayType, type Currency, type DayType, type FixedCost, type Settings, type Transaction } from './types'
import { round2 } from '../basis/bedrag'
import { addDays, daysInMonth, mondayOf, shiftMonth } from '../basis/datum'
import { allPeriods, periodAt } from './periods'

// Kosten, met zo weinig werk mogelijk. Vaste lasten: een lijst met per last het bedrag per maand, waarbij een wijziging
// geldt vanaf een maand (oude maanden blijven kloppen). Variabele kosten: losse uitgaven (Toevoegen → Uitgave, ook
// zonder trip, met een soort) en de schatting "ongeveer los uitgegeven deze week" bij de weekafsluiting. De vooruitblik
// gebruikt per dagsoort (thuis, reis, werk, rust) het eigen gemiddelde per dag, geleerd uit die gegevens; zolang er te
// weinig is, het standaardbedrag per dagsoort uit Instellingen (en zonder standaard: nog onbekend, nooit verzonnen).

const month = (date: string) => date.slice(0, 7)

/** Het bedrag van een vaste last in een maand: het laatste bedrag vanaf die maand of eerder (0 vóór het begin). */
export function fixedAmount(cost: FixedCost, m: string): number {
  let amount = 0
  for (const a of [...cost.amounts].sort((x, y) => x.from.localeCompare(y.from))) if (a.from <= m) amount = a.amount
  return amount
}

/** Vaste lasten van een maand in euro; zonder koers per valuta apart. */
export function fixedInMonth(costs: readonly FixedCost[], m: string, rates: RatesFile | null): { eur: number; other: Partial<Record<Currency, number>> } {
  const out = { eur: 0, other: {} as Partial<Record<Currency, number>> }
  for (const c of active(costs)) {
    const amount = fixedAmount(c, m)
    if (amount <= 0) continue
    const v = toEur(amount, c.currency, `${m}-01`, rates)
    if (v === null) out.other[c.currency] = round2((out.other[c.currency] ?? 0) + amount)
    else out.eur = round2(out.eur + v.eur)
  }
  return out
}

/** Een nieuwe vaste last vanaf een maand. */
export async function addFixedCost(store: Tx, input: { name: string; amount: number; currency: Currency; from: string }): Promise<FixedCost> {
  const record: FixedCost = {
    id: newId(),
    name: input.name.trim().slice(0, 80),
    currency: input.currency,
    amounts: [{ from: input.from, amount: round2(input.amount) }],
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }
  await store.put('fixedcosts.json.enc', record)
  return record
}

/**
 * Een vaste last wijzigen vanaf een maand (0 = stoppen): het nieuwe bedrag geldt vanaf die maand; een eerdere wijziging
 * voor die maand of later vervalt. Oude maanden blijven zoals ze waren. Met ongedaan maken.
 */
export async function changeFixedCost(store: Tx, cost: FixedCost, change: { name?: string; amount: number; from: string }): Promise<void> {
  const before = store.list('fixedcosts.json.enc').find((c) => c.id === cost.id) ?? cost
  const amounts = [...before.amounts.filter((a) => a.from < change.from), { from: change.from, amount: round2(Math.max(0, change.amount)) }]
  const next: FixedCost = { ...before, ...(change.name !== undefined ? { name: change.name.trim().slice(0, 80) || before.name } : {}), amounts, updatedAt: new Date().toISOString() }
  await store.put('fixedcosts.json.enc', next)
}

/** De geboekte maanden van een vaste last (uitgaven met `fixedCostId`), nieuwste eerst. */
export function bookingsOf(transactions: readonly Transaction[], costId: string): Transaction[] {
  return active(transactions)
    .filter((tx) => tx.fixedCostId === costId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Een vaste last verwijderen (tombstone zonder naam of bedragen), met dezelfde keuze als bij een periode voor de maanden
 * die al als uitgave geboekt zijn: `behouden` laat ze staan als gewone uitgaven (zonder `fixedCostId`, zodat ze niet meer
 * als "vast" tellen), `alles` zet ook de boekingen in de prullenbak. Niets verdwijnt stil; ongedaan maken zet alles terug.
 */
export async function deleteFixedCost(store: Tx, cost: FixedCost, mode: 'behouden' | 'alles' = 'behouden'): Promise<void> {
  const now = store.now
  const bookings = bookingsOf(store.list('transactions.json.enc'), cost.id)
  if (bookings.length > 0) {
    // Een gewone uitgave hoort bij een periode: die van haar dag (de laatste van de maand); zonder periode staat ze in Nakijken.
    const periods = allPeriods(store.list('trips.json.enc'), store.list('legs.json.enc'), store.list('periods.json.enc'))
    await store.putMany(
      'transactions.json.enc',
      bookings.map((tx) => {
        if (mode === 'alles') return { ...tx, updatedAt: now, deletedAt: now }
        const { fixedCostId: _vast, ...rest } = tx
        void _vast
        const period = periodAt(periods, tx.date)
        return { ...rest, ...(period ? { tripId: period.id } : {}), updatedAt: now }
      }),
    )
  }
  await store.put('fixedcosts.json.enc', { id: cost.id, name: '', currency: cost.currency, amounts: [], updatedAt: now, deletedAt: now })
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
 * Variabele kosten per dag per dagsoort, uit de laatste twaalf weken tot en met gisteren. Alleen weken met minstens één
 * uitgave tellen: daarin telt elke uitgave (soort kosten, geen investering) op de dagsoort van haar datum. Met minder
 * dan 14 dagen van een soort: het standaardbedrag, anders onbekend.
 */
export function dayAverages(transactions: readonly Transaction[], index: CalendarIndex, today: string, settings: Settings): Record<CostDayType, DayAverage> {
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
  /** Vaste lasten zonder koers, per valuta (naar rato), apart van het bedrag in euro. */
  fixedOther?: Partial<Record<Currency, number>>
  variableEur: number
  /** Een dagsoort zonder gemiddelde of standaard kwam voor: de variabele kosten zijn dan te laag. */
  unknown: boolean
}

/**
 * Verwachte kosten per maand van morgen tot en met de maand `until` (of tot en met `endDate`): de vaste lasten naar rato
 * van de dagen die nog komen, en per dag het gemiddelde van zijn dagsoort. `skip`: dagen met eigen kosten (een
 * scenarioblok met kosten per week) tellen niet mee in de variabele kosten.
 */
export function expectedCosts(
  fixed: readonly FixedCost[],
  averages: Record<CostDayType, DayAverage>,
  index: CalendarIndex,
  today: string,
  until: string,
  rates: RatesFile | null,
  endDate?: string,
  skip?: (date: string) => boolean,
): CostMonth[] {
  const out: CostMonth[] = []
  const first = month(today)
  const last = endDate && month(endDate) < until ? month(endDate) : until
  for (let m = first; m <= last; m = shiftMonth(m, 1)) {
    const total = daysInMonth(m)
    const startDay = m === first ? Number(today.slice(8, 10)) + 1 : 1
    const endDay = endDate && m === month(endDate) ? Number(endDate.slice(8, 10)) : total
    const counted = Math.max(0, endDay - startDay + 1)
    const fixedMonth = fixedInMonth(fixed, m, rates)
    const f = fixedMonth.eur
    const fixedOther: Partial<Record<Currency, number>> = {}
    for (const [c, v] of Object.entries(fixedMonth.other) as [Currency, number][]) fixedOther[c] = round2((v * counted) / total)
    let variable = 0
    let unknown = false
    for (let day = startDay; day <= endDay; day++) {
      const date = `${m}-${String(day).padStart(2, '0')}`
      if (skip?.(date)) continue
      const avg = averages[costDayType(dayInfo(index, date, today).type)]
      variable += avg.perDay
      if (avg.source === 'onbekend') unknown = true
    }
    out.push({ month: m, fixedEur: round2((f * counted) / total), ...(Object.keys(fixedOther).length > 0 ? { fixedOther } : {}), variableEur: round2(variable), unknown })
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
