import { isBooked } from '../domain/geldmodel'
import { eurValue } from './rates'
import type { Transaction } from './types'

// Vandaag → Uitgaven vandaag (src/components/TodayExpenses.tsx): de uitgaven van één dag en hun totaal.

/** De uitgaven met deze datum, laatst ingevoerd eerst. */
export function expensesOn(transactions: readonly Transaction[], date: string): Transaction[] {
  return transactions
    .filter((tx) => isBooked(tx) && (tx.kind === 'kosten' || tx.kind === 'investering') && tx.date === date && !tx.fixedCostId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/** Het totaal in euro, plus wat zonder koers apart per valuta blijft. */
export function expenseTotal(list: readonly Transaction[]): { eur: number; other: Record<string, number> } {
  let eur = 0
  const other: Record<string, number> = {}
  for (const tx of list) {
    const value = eurValue(tx)
    if (value) eur += value.eur
    else other[tx.currency] = (other[tx.currency] ?? 0) + tx.amount
  }
  return { eur: Math.round(eur * 100) / 100, other }
}

