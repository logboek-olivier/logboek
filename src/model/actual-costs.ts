import { active } from './derive'
import { eurOf } from './money'
import { rateFor, type RatesFile } from './rates'
import type { Transaction, WeekClosing } from './types'
import { round2 } from '../basis/bedrag'
import { addDays, shiftMonth } from '../basis/datum'

// Geld → Werkelijk: wat er per maand echt uitgegeven is. Vaste lasten (geboekt per voorbije maand, src/model/fixed-
// bookings.ts), losse kosten (ingevoerde uitgaven van soort kosten, zonder declaraties) en de weekschatting "ongeveer los
// uitgegeven" (gelijk verdeeld over de zeven dagen van die week). Investeringen staan apart (Investering in mijn
// zeilcarrière). De verwachte kosten staan in Verwacht (src/model/costs.ts).

export interface ActualMonth {
  /** jjjj-mm */
  month: string
  fixedEur: number
  looseEur: number
  weekEur: number
  totalEur: number
  /** Bedragen zonder koers, per valuta. */
  other: Record<string, number>
}

/** De laatste `count` maanden tot en met deze maand, nieuwste eerst; maanden zonder iets vallen weg. */
export function actualCosts(transactions: readonly Transaction[], closings: readonly WeekClosing[], today: string, rates: RatesFile | null, count = 6): ActualMonth[] {
  const current = today.slice(0, 7)
  const months = Array.from({ length: count }, (_, i) => shiftMonth(current, -i))
  const byMonth = new Map(months.map((m) => [m, { month: m, fixedEur: 0, looseEur: 0, weekEur: 0, totalEur: 0, other: {} as Record<string, number> }]))
  for (const tx of active(transactions)) {
    if (tx.kind !== 'kosten' || tx.claimId) continue
    const row = byMonth.get(tx.date.slice(0, 7))
    if (!row) continue
    const v = eurOf(tx)
    if (v === null) {
      row.other[tx.currency] = round2((row.other[tx.currency] ?? 0) + tx.amount)
      continue
    }
    if (tx.fixedCostId) row.fixedEur += v
    else row.looseEur += v
  }
  for (const c of active(closings)) {
    if (!c.spent || c.spent.amount <= 0) continue
    const hit = c.spent.currency === 'EUR' ? null : rateFor(rates, c.spent.currency, c.start)
    const v = c.spent.currency === 'EUR' ? c.spent.amount : hit ? c.spent.amount / hit.rate : null
    for (let i = 0; i < 7; i++) {
      const row = byMonth.get(addDays(c.start, i).slice(0, 7))
      if (!row) continue
      if (v === null) row.other[c.spent.currency] = round2((row.other[c.spent.currency] ?? 0) + c.spent.amount / 7)
      else row.weekEur += v / 7
    }
  }
  return months
    .map((m) => byMonth.get(m)!)
    .map((r) => ({ ...r, fixedEur: round2(r.fixedEur), looseEur: round2(r.looseEur), weekEur: round2(r.weekEur), totalEur: round2(r.fixedEur + r.looseEur + r.weekEur) }))
    .filter((r) => r.totalEur > 0 || Object.keys(r.other).length > 0)
}
