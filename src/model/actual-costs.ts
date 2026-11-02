import { active } from './derive'
import { eurOf } from './money'
import type { Transaction } from './types'
import { round2 } from '../basis/bedrag'
import { shiftMonth } from '../basis/datum'

// Geld → Werkelijk: wat er per maand echt uitgegeven is. Vaste lasten (geboekt per voorbije maand, src/model/fixed-
// bookings.ts) en losse kosten (ingevoerde uitgaven van soort kosten, zonder declaraties). Investeringen staan apart
// (Investering in mijn zeilcarrière). De verwachte kosten staan in Verwacht (src/model/costs.ts).

export interface ActualMonth {
  /** jjjj-mm */
  month: string
  fixedEur: number
  looseEur: number
  totalEur: number
  /** Bedragen zonder koers, per valuta. */
  other: Record<string, number>
}

/**
 * De laatste `count` maanden tot en met deze maand, nieuwste eerst; maanden zonder iets vallen weg. Met `period` (de
 * periode bovenaan Geld): de maanden van die periode tot en met deze maand, en alleen kosten binnen de periode.
 */
export function actualCosts(transactions: readonly Transaction[], today: string, count = 6, period?: { from: string; to: string }): ActualMonth[] {
  const current = today.slice(0, 7)
  const last = period ? (period.to < today ? period.to : today).slice(0, 7) : current
  const first = period ? period.from.slice(0, 7) : shiftMonth(current, -(count - 1))
  const months: string[] = []
  for (let m = last; m >= first && months.length < 600; m = shiftMonth(m, -1)) months.push(m)
  const byMonth = new Map(months.map((m) => [m, { month: m, fixedEur: 0, looseEur: 0, totalEur: 0, other: {} as Record<string, number> }]))
  for (const tx of active(transactions)) {
    if (tx.kind !== 'kosten' || tx.claimId) continue
    if (period && (tx.date < period.from || tx.date > period.to)) continue
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
  return months
    .map((m) => byMonth.get(m)!)
    .map((r) => ({ ...r, fixedEur: round2(r.fixedEur), looseEur: round2(r.looseEur), totalEur: round2(r.fixedEur + r.looseEur) }))
    .filter((r) => r.totalEur > 0 || Object.keys(r.other).length > 0)
}
