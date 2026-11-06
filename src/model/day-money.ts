import { transactionList } from '../domain/geldrapport'
import { totals, type MoneyTotals } from './money'
import type { Transaction } from './types'

// Geld per dag in de agenda (alleen na "Toon bedragen"): per dag het netto bedrag, inkomsten min uitgaven, van het
// echte geld op zijn eigen datum: een ontvangen salaris op de dag van ontvangst, fooien, kosten, investeringen en
// terugbetalingen. Geen verwacht salaris en geen scenario. Een grote uitgave wordt bewust niet over meerdere dagen
// verdeeld: een vliegticket maakt één dag rood. Rekenen gebeurt met dezelfde functies als Geld (`transactionList`,
// `totals`, de omrekening in src/model/rates.ts), zodat de som van de dagen precies de maandsom is en die precies
// "Zeilgeld: resultaat" in Geld voor dezelfde maand. Interne overboekingen bestaan niet in het geld (standen van
// rekeningen zijn geen transacties) en tellen dus nooit mee.

/** Netto per dag in een maand (jjjj-mm): alleen dagen met echt geld. */
export function dayNets(transactions: readonly Transaction[], month: string): Map<string, MoneyTotals> {
  const byDay = new Map<string, Transaction[]>()
  for (const tx of transactionList(transactions, monthPeriod(month))) {
    const list = byDay.get(tx.date)
    if (list) list.push(tx)
    else byDay.set(tx.date, [tx])
  }
  return new Map([...byDay].map(([date, list]) => [date, totals(list)]))
}

/** Netto van één dag, met de transacties (nieuwste eerst, zoals de transactielijst in Geld). */
export function dayMoney(transactions: readonly Transaction[], date: string): { list: Transaction[]; totals: MoneyTotals } {
  const list = transactionList(transactions, { from: date, to: date })
  return { list, totals: totals(list) }
}

/** Netto van de maand: hetzelfde getal als "Zeilgeld: resultaat" in Geld voor die maand. */
export function monthNet(transactions: readonly Transaction[], month: string): MoneyTotals {
  return totals(transactionList(transactions, monthPeriod(month)))
}

export function monthPeriod(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/**
 * Kort voor een dagtegel (360 px): +120, −85, +1,2k, −12k. Afgerond op hele euro's; vanaf 1.000 in duizenden met één
 * decimaal (vanaf 10.000 zonder). Nul (ook afgerond) = leeg.
 */
export function compactEur(eur: number, lang: 'nl' | 'en'): string {
  const abs = Math.abs(eur)
  if (Math.round(abs) === 0) return ''
  const sign = eur < 0 ? '−' : '+'
  if (abs < 1000) return `${sign}${Math.round(abs)}`
  const k = abs / 1000
  const text = k < 10 ? (Math.round(k * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.round(k))
  return `${sign}${lang === 'nl' ? text.replace('.', ',') : text}k`
}
