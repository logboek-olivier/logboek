import { incomePerWorkday, type CalendarIndex, type WorkdayIncome } from '../model/calendar'
import { active } from '../model/derive'
import { tipsPerCountry, tipsPerGuest, tipsPerTrip, tipsPerTripType } from '../model/guests'
import { eurOf, totals, type MoneyTotals } from '../model/money'
import { addSums, addTo, emptySum, type MoneySum } from '../model/money-path'
import type { RatesFile } from '../model/rates'
import { groupOf, taxYear, type TaxGroup, type TaxYear } from '../model/tax-year'
import { tripsById } from '../basis/organisatie'
import type { Leg, Transaction, Trip } from '../model/types'
import { booked, salariesOf, salaryStatus } from './geldmodel'

// Rapporten over geld, allemaal uit dezelfde transacties en met dezelfde regels (src/domain/geldmodel.ts): het resultaat
// per tocht, de transactielijst, per organisatie, per werkdag, het jaaroverzicht, de fooi per gast en Te controleren.
// Elk geldscherm rekent via deze functies. Bedragen in euro (de koers van de transactiedatum zoals overal,
// src/model/rates.ts); zonder koers apart per valuta, nooit omgerekend.

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

/** Een periode (jjjj-mm-dd, beide inclusief); zonder: alles. */
export interface ReportPeriod {
  from: string
  to: string
}

const inPeriod = (date: string, period?: ReportPeriod) => !period || (date >= period.from && date <= period.to)

/** De transactielijst: echt geld in de periode, nieuwste eerst (een verwacht salaris of "geen salaris" staat er niet in). */
export function transactionList(transactions: readonly Transaction[], period?: ReportPeriod): Transaction[] {
  return booked(transactions)
    .filter((tx) => inPeriod(tx.date, period))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1))
}

export interface OrganisationTotals extends MoneyTotals {
  group: TaxGroup
}

/**
 * Per organisatie (de organisatie van de tocht, ook uit de naam; van het seizoen; anders de oude bron), uit dezelfde
 * transacties als de transactielijst en het jaaroverzicht. Grootste inkomsten eerst.
 */
export function perOrganisation(transactions: readonly Transaction[], trips: readonly Trip[], period?: ReportPeriod): OrganisationTotals[] {
  // Ook verwijderde trips: geld van een trip in de prullenbak blijft bij zijn organisatie.
  const byId = tripsById(trips)
  const map = new Map<TaxGroup, Transaction[]>()
  for (const tx of transactionList(transactions, period)) {
    const group = groupOf(tx, byId)
    map.set(group, [...(map.get(group) ?? []), tx])
  }
  return [...map.entries()].map(([group, txs]) => ({ group, ...totals(txs) })).sort((a, b) => b.incomeEur - a.incomeEur)
}

/** Per werkdag: per maand het verdiende geld (op de datum van elke transactie, ook van een seizoen) en de werkdagen. */
export function perWorkday(index: CalendarIndex, transactions: readonly Transaction[], today: string, count = 12): WorkdayIncome[] {
  return incomePerWorkday(index, booked(transactions), today, count)
}

/** Het jaaroverzicht voor de belasting (zelfde transacties en organisaties als per organisatie). */
export function yearOverview(transactions: readonly Transaction[], trips: readonly Trip[], year: number, rates: RatesFile | null): TaxYear {
  return taxYear(booked(transactions), trips, year, rates)
}

/** Fooi per tocht, per gast, per soort en per land: alleen fooien bij een tocht (niet van een eerder seizoen). */
export function tipReports(trips: readonly Trip[], transactions: readonly Transaction[], legs: readonly Leg[]) {
  const real = booked(transactions)
  const perTrip = tipsPerTrip(trips, real, legs)
  return { perTrip, perGuest: tipsPerGuest(trips, real), perType: tipsPerTripType(perTrip), perCountry: tipsPerCountry(trips, real) }
}

/** Te controleren (alleen signaleren, nooit zelf aanpassen): salaris ontvangen zonder bedrag, tocht met meer dan één salaris. */
export type CheckItem = { kind: 'zonder-bedrag'; trip: Trip; salary: Transaction } | { kind: 'meerdere'; trip: Trip; count: number }

export function toCheck(transactions: readonly Transaction[], trips: readonly Trip[]): CheckItem[] {
  const out: CheckItem[] = []
  for (const trip of active(trips)) {
    const salaries = salariesOf(trip.id, transactions)
    if (salaries.length > 1) out.push({ kind: 'meerdere', trip, count: salaries.length })
    else if (salaries[0] && salaryStatus(salaries[0]) === 'ontvangen' && !(salaries[0].amount > 0)) out.push({ kind: 'zonder-bedrag', trip, salary: salaries[0] })
  }
  return out
}
