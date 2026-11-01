import type { Tx } from '../domain/tx'
import { active } from './derive'
import { eurOf } from './money'
import { finalRateFields, rateFor, type RatesFile } from './rates'
import { countedSalary, salaryEur, salaryIncomeId, tripEnd } from './salary'
import { newId, type Currency, type Leg, type Organisation, type PayoutRule, type Settings, type Transaction, type TransactionSource, type Trip } from './types'
import { endedFor } from './trip-dates'
import { round2 } from '../basis/bedrag'
import { todayIso } from '../basis/datum'
import { sourceForPeriod } from '../basis/organisatie'

// Geldpad per trip: per soort geld een status. Salaris: verwacht (de trip is nog niet voorbij), te ontvangen (voorbij,
// nog niet betaald) of ontvangen. Fooi: contant of op de bank; contant staat in "Contant" tot hij gestort is, zodat
// niets dubbel telt (gestort geld staat op de bank). Een uitbetaling van een organisatie ("SV betaalde € X op <datum>")
// vinkt de trips die erbij horen in één keer af; per trip komt er een eigen inkomen, naar verhouding van het verwachte
// salaris, zodat inkomsten per trip blijven kloppen. Een eigen of ontvangen salaris wordt nooit vanzelf overschreven.

export type SalaryState = 'verwacht' | 'te-ontvangen' | 'ontvangen'

/** Status van het salaris van een trip op een datum; null als de trip geen salaris heeft. */
export function salaryState(trip: Trip, legs: readonly Leg[], today: string): SalaryState | null {
  const s = countedSalary(trip)
  if (!s) return null
  if (s.status === 'ontvangen') return 'ontvangen'
  const end = tripEnd(trip, legs)
  // Een trip die de dagen volgt, is pas drie dagen na de laatste dag voorbij (zoals overal).
  return end && endedFor(trip, end) < today ? 'te-ontvangen' : 'verwacht'
}

/** Hoe de organisatie uitbetaalt; zonder (geldige) instelling na elke trip. */
export function payoutRule(settings: Settings, org: Organisation | undefined): PayoutRule {
  const rule = org ? settings.payouts?.[org] : undefined
  if (rule?.kind === 'maandelijks' && Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 28) return rule
  return { kind: 'per-trip' }
}

const byEnd = (legs: readonly Leg[]) => (a: Trip, b: Trip) => tripEnd(a, legs).localeCompare(tripEnd(b, legs)) || a.id.localeCompare(b.id)

/**
 * Trips van een organisatie met een salaris dat nog niet ontvangen is en op `date` voorbij is (een uitbetaling op de
 * laatste dag van de trip telt mee), oudste eerst.
 */
export function openSalaryTrips(trips: readonly Trip[], legs: readonly Leg[], org: Organisation, date: string): Trip[] {
  return active(trips)
    .filter((x) => {
      const end = tripEnd(x, legs)
      return x.organisation === org && countedSalary(x)?.status === 'verwacht' && !!end && end <= date
    })
    .sort(byEnd(legs))
}

/** Staat er al een inkomen van soort loon bij deze trip (met de hand ingevoerd)? Dan niet vanzelf nog eens voorstellen. */
export function hasSalaryIncome(trip: Trip, transactions: readonly Transaction[]): boolean {
  return transactions.some((tx) => tx.deletedAt === null && tx.kind === 'loon' && tx.tripId === trip.id)
}

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function previousMonthStart(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}

/**
 * Welke trips een uitbetaling op `date` waarschijnlijk afrekent: na elke trip de oudste open trip; maandelijks de open
 * trips die vóór de maand van de uitbetaling eindigden (de trips van de vorige maand, en wat daarvóór nog openstond).
 */
export function payoutSuggestion(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, org: Organisation, date: string, transactions: readonly Transaction[] = []): Trip[] {
  const open = openSalaryTrips(trips, legs, org, date).filter((x) => !hasSalaryIncome(x, transactions))
  if (payoutRule(settings, org).kind === 'per-trip') return open.slice(0, 1)
  const before = open.filter((x) => tripEnd(x, legs) < firstOfMonth(date))
  return before.length > 0 ? before : open
}

/** Het verwachte salaris van een trip in `currency` op `date`: direct bij dezelfde valuta, anders via de euro; null zonder koers. */
function expectedIn(trip: Trip, legs: readonly Leg[], currency: Currency, date: string, rates: RatesFile | null): number | null {
  const s = trip.salary
  if (!s) return null
  if (s.currency === currency) return s.amount
  const eur = salaryEur(s, tripEnd(trip, legs) || date, rates)
  if (eur === null) return null
  if (currency === 'EUR') return eur
  const hit = rateFor(rates, currency, date)
  return hit ? round2(eur * hit.rate) : null
}

/** Verwacht totaal van deze trips in de valuta van de uitbetaling; null als een koers ontbreekt. */
export function expectedPayout(trips: readonly Trip[], legs: readonly Leg[], currency: Currency, date: string, rates: RatesFile | null): number | null {
  let total = 0
  for (const x of trips) {
    const v = expectedIn(x, legs, currency, date, rates)
    if (v === null) return null
    total += v
  }
  return round2(total)
}

/** De uitbetaling verdeeld over de trips, naar verhouding van het verwachte salaris (zonder koers gelijk verdeeld). */
export function splitPayout(amount: number, trips: readonly Trip[], legs: readonly Leg[], currency: Currency, date: string, rates: RatesFile | null): number[] {
  if (trips.length === 0) return []
  const weights = trips.map((x) => expectedIn(x, legs, currency, date, rates))
  const usable = weights.every((w): w is number => w !== null && w > 0)
  const w = usable ? (weights as number[]) : trips.map(() => 1)
  const sum = w.reduce((n, x) => n + x, 0)
  // In centen, naar de grootste rest: de delen zijn samen precies het betaalde bedrag en nooit negatief.
  const cents = Math.round(amount * 100)
  const exact = w.map((x) => (cents * x) / sum)
  const parts = exact.map((x) => Math.floor(x))
  let left = cents - parts.reduce((n, x) => n + x, 0)
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    parts[i]!++
    left--
  }
  return parts.map((c) => c / 100)
}

/** Het kleinste bedrag dat over deze trips te verdelen is (elke trip minstens één cent). */
export function minimumPayout(trips: number): number {
  return trips * 0.01
}

function orgSource(org: Organisation): TransactionSource {
  return org === 'sailing-virgins' || org === 'yacht-week' ? org : 'overig'
}

export interface Payout {
  org: Organisation
  amount: number
  currency: Currency
  /** jjjj-mm-dd */
  date: string
}

/**
 * Een uitbetaling opslaan: per trip een inkomen (loon) met hetzelfde payoutId, en elke trip op ontvangen. Zonder trips
 * één inkomen van de organisatie. Ongedaan maken haalt de inkomens weg en zet de trips terug.
 */
export async function recordPayout(store: Tx, payout: Payout, chosen: readonly Trip[], rates: RatesFile | null): Promise<void> {
  const legs = store.list('legs.json.enc')
  // De trips zoals ze nu op het apparaat staan; een trip die intussen al ontvangen is (een tweede tik, een ander
  // apparaat), gaat niet nog eens mee. Is er dan niets meer over, dan wordt er niets geboekt.
  // Een trip met al een salarisinkomen (ook als zijn status nog op verwacht staat) gaat evenmin mee.
  const latest = store.list('trips.json.enc')
  const booked = store.list('transactions.json.enc')
  const trips = chosen
    .map((x) => latest.find((t) => t.id === x.id) ?? x)
    .filter((x) => x.deletedAt === null && countedSalary(x)?.status === 'verwacht' && !hasSalaryIncome(x, booked))
  if (chosen.length > 0 && trips.length === 0) return
  // Elke trip krijgt minstens één cent: een kleiner bedrag is geen uitbetaling.
  if (round2(payout.amount) < minimumPayout(Math.max(1, trips.length))) throw new Error('Bedrag te klein voor deze trips')
  const now = new Date().toISOString()
  const payoutId = newId()
  const amount = round2(payout.amount)
  const parts = trips.length > 0 ? splitPayout(amount, trips, legs, payout.currency, payout.date, rates) : [amount]
  const txs: Transaction[] = parts.map((part, i) => {
    const trip = trips[i]
    const base = { date: payout.date, amount: part, currency: payout.currency }
    return {
      // Per trip het vaste id van zijn salarisinkomen: een tweede tik of een ander apparaat boekt hetzelfde record.
      id: trip ? salaryIncomeId(trip.id) : newId(),
      ...base,
      kind: 'loon',
      source: trip ? sourceForPeriod(trip) : orgSource(payout.org),
      ...(trip ? { tripId: trip.id } : {}),
      payoutId,
      ...(payout.currency === 'EUR' ? { amountEur: part } : (finalRateFields(base, rates) ?? {})),
      updatedAt: now,
      deletedAt: null,
    }
  })
  const updated: Trip[] = trips.map((trip, i) => {
    const { askAfter: _a, ...salary } = trip.salary!
    void _a
    return { ...trip, salary: { ...salary, status: 'ontvangen', transactionId: txs[i]!.id }, updatedAt: now }
  })
  await store.putMany('transactions.json.enc', txs)
  if (updated.length > 0) await store.putMany('trips.json.enc', updated)
}

export interface PayoutQuestion {
  org: Organisation
  /** jjjj-mm van de maand waarvan de trips zijn (de maand vóór de uitbetaling). */
  month: string
  trips: Trip[]
}

/**
 * Vandaag bij een maandelijkse uitbetaling: vanaf dag N van de maand "Uitbetaling van <organisatie> voor <maand>
 * ontvangen?" voor de open trips die vóór deze maand eindigden (en wat daarvóór nog openstond). Zonder bedragen.
 */
export function payoutQuestions(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, today: string, transactions: readonly Transaction[] = []): PayoutQuestion[] {
  const out: PayoutQuestion[] = []
  for (const org of new Set(active(trips).map((x) => x.organisation).filter((o): o is Organisation => !!o))) {
    const rule = payoutRule(settings, org)
    if (rule.kind !== 'maandelijks') continue
    const day = Number(today.slice(8, 10))
    const cutoff = day >= rule.day ? firstOfMonth(today) : previousMonthStart(today)
    const due = openSalaryTrips(trips, legs, org, today).filter((x) => tripEnd(x, legs) < cutoff && (!x.salary!.askAfter || x.salary!.askAfter <= today) && !hasSalaryIncome(x, transactions))
    if (due.length > 0) out.push({ org, month: previousMonthStart(cutoff).slice(0, 7), trips: due })
  }
  return out
}

/** Een organisatie met een maandelijkse uitbetaling: geen vraag per trip, wel één per uitbetaling. */
export function asksPerTrip(settings: Settings, trip: Trip): boolean {
  return payoutRule(settings, trip.organisation).kind === 'per-trip'
}

/** Het werkelijk ontvangen salaris (het inkomen dat bij "ontvangen" hoort), of null zonder levend inkomen. */
export function receivedSalary(trip: Trip, transactions: readonly Transaction[]): { amount: number; currency: Currency } | null {
  const id = trip.salary?.status === 'ontvangen' ? trip.salary.transactionId : undefined
  const tx = id ? transactions.find((x) => x.id === id && x.deletedAt === null) : undefined
  return tx ? { amount: tx.amount, currency: tx.currency } : null
}

/** Contante fooien die nog niet gestort zijn. */
export function cashTips(transactions: readonly Transaction[]): Transaction[] {
  return active(transactions).filter((tx) => tx.kind === 'fooi' && tx.tipVia === 'contant' && !tx.depositedAt)
}

/** Contant per valuta: contante fooien die nog niet gestort zijn. */
export function cashOnHand(transactions: readonly Transaction[]): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {}
  for (const tx of cashTips(transactions)) out[tx.currency] = round2((out[tx.currency] ?? 0) + tx.amount)
  return out
}

/** "Gestort op …": alle contante fooien in deze valuta uit Contant (ze staan nu op de bank). Met ongedaan maken. */
export async function depositCash(store: Tx, currency: Currency, date: string): Promise<void> {
  // Alleen fooien van vóór of op de stortdatum: een latere fooi kan er niet bij zitten.
  const tips = cashTips(store.list('transactions.json.enc')).filter((tx) => tx.currency === currency && tx.date <= date)
  const now = new Date().toISOString()
  await store.putMany('transactions.json.enc', tips.map((tx) => ({ ...tx, depositedAt: date, updatedAt: now })))
}

/** Bedrag in euro en wat zonder koers per valuta blijft. */
export interface MoneySum {
  eur: number
  other: Partial<Record<Currency, number>>
}

export interface TripMoney {
  salary: { state: SalaryState; amount: number; currency: Currency } | null
  tips: Record<'contant' | 'bank' | 'onbekend', MoneySum>
}

const emptySum = (): MoneySum => ({ eur: 0, other: {} })

function addTo(sum: MoneySum, amount: number, currency: Currency, eur: number | null, sign = 1): void {
  if (eur === null) sum.other[currency] = round2((sum.other[currency] ?? 0) + sign * amount)
  else sum.eur = round2(sum.eur + sign * eur)
}

function addSums(into: MoneySum, from: MoneySum, sign = 1): void {
  into.eur = round2(into.eur + sign * from.eur)
  for (const [c, v] of Object.entries(from.other) as [Currency, number][]) into.other[c] = round2((into.other[c] ?? 0) + sign * v)
}

export interface TripResult {
  /** Ontvangen salaris (inkomen van soort loon), anders het verwachte salaris (`salaryExpected`). */
  salary: MoneySum
  salaryExpected: boolean
  tips: MoneySum
  /** Bonus, overige inkomsten en terugbetaalde onkosten. */
  otherIncome: MoneySum
  /** Uitgaven bij de trip, zonder de uitgave van een declaratie die nog niet terugbetaald is. */
  costs: MoneySum
  /** Declaraties van de trip die nog niet terugbetaald zijn: apart, niet in het resultaat (dat geld komt terug). */
  openClaims: MoneySum
  /** Salaris + fooi + overige inkomsten − uitgaven; kan negatief zijn. */
  result: MoneySum
}

/**
 * Resultaat van één trip: salaris (ontvangen, anders verwacht) plus fooi plus overige inkomsten min de uitgaven. De
 * uitgave van een declaratie die nog niet terugbetaald is, staat apart (dat geld komt terug); is hij terugbetaald, dan
 * tellen uitgave en terugbetaling allebei mee en heffen ze elkaar op. Alles in euro; zonder koers apart per valuta.
 */
export function tripResult(trip: Trip, legs: readonly Leg[], transactions: readonly Transaction[], rates: RatesFile | null): TripResult {
  const out: TripResult = { salary: emptySum(), salaryExpected: false, tips: emptySum(), otherIncome: emptySum(), costs: emptySum(), openClaims: emptySum(), result: emptySum() }
  const live = active(transactions)
  const own = live.filter((tx) => tx.tripId === trip.id)
  const repaid = new Set(live.filter((tx) => tx.kind === 'terugbetaling' && tx.claimId).map((tx) => tx.claimId!))
  let paid = false
  for (const tx of own) {
    const eur = eurOf(tx)
    if (tx.kind === 'loon') {
      paid = true
      addTo(out.salary, tx.amount, tx.currency, eur)
    } else if (tx.kind === 'fooi') addTo(out.tips, tx.amount, tx.currency, eur)
    else if (tx.kind === 'bonus' || tx.kind === 'overig-inkomen' || tx.kind === 'terugbetaling') addTo(out.otherIncome, tx.amount, tx.currency, eur)
    else if (tx.claimId && !repaid.has(tx.claimId)) addTo(out.openClaims, tx.amount, tx.currency, eur)
    else addTo(out.costs, tx.amount, tx.currency, eur)
  }
  const s = countedSalary(trip)
  if (!paid && s && s.status === 'verwacht') {
    out.salaryExpected = true
    addTo(out.salary, s.amount, s.currency, salaryEur(s, tripEnd(trip, legs) || todayIso(), rates))
  }
  addSums(out.result, out.salary)
  addSums(out.result, out.tips)
  addSums(out.result, out.otherIncome)
  addSums(out.result, out.costs, -1)
  return out
}

/** Het geldpad van één trip: salaris met status, en de fooien naar contant, bank en onbekend. */
export function tripMoney(trip: Trip, legs: readonly Leg[], transactions: readonly Transaction[], today: string): TripMoney {
  const state = salaryState(trip, legs, today)
  const tips: TripMoney['tips'] = { contant: emptySum(), bank: emptySum(), onbekend: emptySum() }
  for (const tx of active(transactions)) {
    if (tx.kind !== 'fooi' || tx.tripId !== trip.id) continue
    // Een onbekende waarde (van een nieuwere versie) telt als onbekend.
    const sum = tips[tx.tipVia === 'contant' || tx.tipVia === 'bank' ? tx.tipVia : 'onbekend']
    const eur = eurOf(tx)
    if (eur === null) sum.other[tx.currency] = round2((sum.other[tx.currency] ?? 0) + tx.amount)
    else sum.eur = round2(sum.eur + eur)
  }
  return { salary: state && trip.salary ? { state, amount: trip.salary.amount, currency: trip.salary.currency } : null, tips }
}
