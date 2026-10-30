import type { Store } from '../storage/store'
import { applyChanges } from './changes'
import { fixedAmount } from './costs'
import { active } from './derive'
import { finalRateFields } from './rates'
import type { FixedCost, Transaction } from './types'

// Vaste lasten in Werkelijk (Geld): elke voorbije maand staat als echte uitgave geboekt, één per vaste last per maand, op
// de laatste dag van die maand. Vast id `vast:<vaste last>:<jjjj-mm>`, zodat twee apparaten hetzelfde boeken; een
// geboekte maand die Olivier aanpaste of verwijderde (tombstone) boekt de app nooit opnieuw. Komende maanden staan alleen
// in Verwacht. Vaste lasten hangen aan de maand, niet aan een periode (docs/PERIODEMODEL.md).

export function bookingId(costId: string, month: string): string {
  return `vast:${costId}:${month}`
}

function shiftMonth(m: string, n: number): string {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, mm - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Hoogstens zoveel maanden terug boeken (een vaste last met een begin ver in het verleden). */
const MAX_MONTHS_BACK = 24

/** De boekingen die nog ontbreken: per vaste last elke voorbije maand met een bedrag, zonder bestaande boeking (ook geen tombstone). */
export function missingBookings(costs: readonly FixedCost[], existing: readonly Transaction[], today: string, now: string): Transaction[] {
  const known = new Set(existing.map((tx) => tx.id))
  const current = today.slice(0, 7)
  const out: Transaction[] = []
  for (const cost of active(costs)) {
    const first = [...cost.amounts].map((a) => a.from).sort()[0]
    if (!first) continue
    let month = first < shiftMonth(current, -MAX_MONTHS_BACK) ? shiftMonth(current, -MAX_MONTHS_BACK) : first
    for (; month < current; month = shiftMonth(month, 1)) {
      const amount = fixedAmount(cost, month)
      const id = bookingId(cost.id, month)
      if (amount <= 0 || known.has(id)) continue
      const tx: Transaction = {
        id,
        date: lastDay(month),
        kind: 'kosten',
        amount,
        currency: cost.currency,
        source: 'overig',
        category: 'overig',
        note: cost.name,
        fixedCostId: cost.id,
        updatedAt: now,
        deletedAt: null,
      }
      if (tx.currency === 'EUR') tx.amountEur = tx.amount
      else Object.assign(tx, finalRateFields(tx) ?? {})
      out.push(tx)
    }
  }
  return out
}

/** Ontbrekende maanden van vaste lasten boeken (na een geslaagde sync, zodat dit apparaat weet wat er al staat). */
export async function bookFixedCosts(store: Store, today: string): Promise<number> {
  if (!store.hasSynced()) return 0
  const missing = missingBookings(store.list('fixedcosts.json.enc'), store.get('transactions.json.enc'), today, new Date().toISOString())
  if (missing.length === 0) return 0
  await applyChanges(store, missing.map((after) => ({ path: 'transactions.json.enc' as const, before: null, after })))
  return missing.length
}
