import { describe, expect, it } from 'vitest'
import { expenseTotal, expensesOn } from '../src/model/today-expenses'
import type { Transaction } from '../src/model/types'

// Vandaag → Uitgaven vandaag (src/components/TodayExpenses.tsx): alleen echte uitgaven van die dag, laatst ingevoerd
// eerst, zonder geboekte vaste lasten; het totaal in euro en apart per valuta zonder koers. Verzonnen bedragen.

const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ id, date: '2026-11-04', kind: 'kosten', amount: 10, currency: 'EUR', amountEur: 10, rate: 1, source: 'overig', updatedAt: '2026-11-04T08:00:00.000Z', deletedAt: null, ...extra })

describe('uitgaven vandaag', () => {
  const list = [
    tx('ontbijt', { amount: 8, amountEur: 8, updatedAt: '2026-11-04T08:00:00.000Z' }),
    tx('taxi', { amount: 25, amountEur: 25, category: 'vervoer', updatedAt: '2026-11-04T12:00:00.000Z' }),
    tx('cursus', { kind: 'investering', category: 'opleiding', amount: 100, amountEur: 100, updatedAt: '2026-11-04T10:00:00.000Z' }),
    tx('gisteren', { date: '2026-11-03' }),
    tx('fooi', { kind: 'fooi' }),
    tx('weg', { deletedAt: '2026-11-04T13:00:00.000Z' }),
    tx('huur', { fixedCostId: 'h' }),
    tx('dollars', { amount: 5, currency: 'USD', amountEur: undefined, rate: undefined, updatedAt: '2026-11-04T09:00:00.000Z' }),
  ]
  it('alleen uitgaven van vandaag, laatst ingevoerd eerst; geen inkomsten, verwijderde of vaste lasten', () => {
    expect(expensesOn(list, '2026-11-04').map((t) => t.id)).toEqual(['taxi', 'cursus', 'dollars', 'ontbijt'])
  })
  it('totaal in euro, zonder koers apart per valuta', () => {
    expect(expenseTotal(expensesOn(list, '2026-11-04'))).toEqual({ eur: 133, other: { USD: 5 } })
  })
})
