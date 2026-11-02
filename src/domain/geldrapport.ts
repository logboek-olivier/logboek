import { active } from '../model/derive'
import { eurOf } from '../model/money'
import { addSums, addTo, emptySum, type MoneySum } from '../model/money-path'
import type { Transaction, Trip } from '../model/types'
import { salaryStatus } from './geldmodel'

// Rapporten over geld, allemaal uit dezelfde transacties (src/domain/geldmodel.ts). Bedragen in euro (de koers van de
// transactiedatum zoals overal, src/model/rates.ts); zonder koers apart per valuta, nooit omgerekend.

export interface TripResult {
  /** Het salaris van de tocht: ontvangen, anders verwacht (`salaryExpected`); bij "geen salaris" 0. */
  salary: MoneySum
  salaryExpected: boolean
  tips: MoneySum
  /** Bonus, overige inkomsten en terugbetaalde onkosten. */
  otherIncome: MoneySum
  /** Alle uitgaven bij de tocht (kosten en investeringen, ook die van een declaratie). */
  costs: MoneySum
  /** Waarvan declaraties die nog niet terugbetaald zijn (dat geld komt terug); alleen ter informatie. */
  openClaims: MoneySum
  /** Salaris + fooi + overige inkomsten − uitgaven: de som van de transacties van de tocht; kan negatief zijn. */
  result: MoneySum
}

/**
 * Resultaat van één tocht: de som van zijn transacties (inkomsten plus, minus uitgaven). Een verwacht salaris telt mee
 * zolang het niet ontvangen is (het is de transactie van die tocht); "geen salaris" is 0.
 */
export function tripResult(trip: Pick<Trip, 'id'>, transactions: readonly Transaction[]): TripResult {
  const out: TripResult = { salary: emptySum(), salaryExpected: false, tips: emptySum(), otherIncome: emptySum(), costs: emptySum(), openClaims: emptySum(), result: emptySum() }
  const live = active(transactions)
  const repaid = new Set(live.filter((tx) => tx.kind === 'terugbetaling' && tx.claimId).map((tx) => tx.claimId!))
  for (const tx of live) {
    if (tx.tripId !== trip.id) continue
    const eur = eurOf(tx)
    if (tx.kind === 'loon') {
      const status = salaryStatus(tx)
      if (status === 'geen') continue
      if (status === 'verwacht') out.salaryExpected = true
      addTo(out.salary, tx.amount, tx.currency, eur)
    } else if (tx.kind === 'fooi') addTo(out.tips, tx.amount, tx.currency, eur)
    else if (tx.kind === 'bonus' || tx.kind === 'overig-inkomen' || tx.kind === 'terugbetaling') addTo(out.otherIncome, tx.amount, tx.currency, eur)
    else {
      addTo(out.costs, tx.amount, tx.currency, eur)
      if (tx.claimId && !repaid.has(tx.claimId)) addTo(out.openClaims, tx.amount, tx.currency, eur)
    }
  }
  addSums(out.result, out.salary)
  addSums(out.result, out.tips)
  addSums(out.result, out.otherIncome)
  addSums(out.result, out.costs, -1)
  return out
}
