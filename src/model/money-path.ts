import type { Tx } from '../domain/tx'
import { salaryOf, salaryStatus } from '../domain/geldmodel'
import { active } from './derive'
import { finalRateFields, rateFor, type RatesFile } from './rates'
import { saveSalary, tripEnd } from './salary'
import { newId, type Currency, type Leg, type Organisation, type PayoutRule, type Settings, type Transaction, type Trip } from './types'
import { round2 } from '../basis/bedrag'
import { sourceForOrganisation } from '../basis/organisatie'

// Uitbetalingen per organisatie: een uitbetaling ("SV betaalde € X op <datum>") vinkt de tochten die erbij horen in één
// keer af. Per tocht wordt zijn salaris (de ene loon-transactie, src/domain/geldmodel.ts) ontvangen, met het betaalde
// bedrag naar verhouding van het verwachte salaris, zodat het geld per tocht blijft kloppen. Een salaris dat al ontvangen
// is, gaat nooit nog eens mee.

/** Hoe de organisatie uitbetaalt; zonder (geldige) instelling na elke tocht. */
export function payoutRule(settings: Settings, org: Organisation | undefined): PayoutRule {
  const rule = org ? settings.payouts?.[org] : undefined
  if (rule?.kind === 'maandelijks' && Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 28) return rule
  return { kind: 'per-trip' }
}

const byEnd = (legs: readonly Leg[]) => (a: Trip, b: Trip) => tripEnd(a, legs).localeCompare(tripEnd(b, legs)) || a.id.localeCompare(b.id)

/** Het verwachte salaris van een tocht (verwacht, met een bedrag), of undefined. */
export function expectedSalary(trip: Trip, transactions: readonly Transaction[]): Transaction | undefined {
  const s = salaryOf(trip.id, transactions)
  return s && salaryStatus(s) === 'verwacht' && s.amount > 0 ? s : undefined
}

/**
 * Tochten van een organisatie met een verwacht salaris die op `date` voorbij zijn (een uitbetaling op de laatste dag van
 * de tocht telt mee), oudste eerst.
 */
export function openSalaryTrips(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], org: Organisation, date: string): Trip[] {
  return active(trips)
    .filter((x) => {
      const end = tripEnd(x, legs)
      return x.organisation === org && !!expectedSalary(x, transactions) && !!end && end <= date
    })
    .sort(byEnd(legs))
}

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function previousMonthStart(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}

/**
 * Welke tochten een uitbetaling op `date` waarschijnlijk afrekent: na elke tocht de oudste open tocht; maandelijks de
 * open tochten die vóór de maand van de uitbetaling eindigden (de tochten van de vorige maand, en wat daarvóór nog openstond).
 */
export function payoutSuggestion(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, org: Organisation, date: string, transactions: readonly Transaction[]): Trip[] {
  const open = openSalaryTrips(trips, legs, transactions, org, date)
  if (payoutRule(settings, org).kind === 'per-trip') return open.slice(0, 1)
  const before = open.filter((x) => tripEnd(x, legs) < firstOfMonth(date))
  return before.length > 0 ? before : open
}

/** Het verwachte salaris van een tocht in `currency` op `date`: direct bij dezelfde valuta, anders via de euro; null zonder koers. */
function expectedIn(trip: Trip, legs: readonly Leg[], transactions: readonly Transaction[], currency: Currency, date: string, rates: RatesFile | null): number | null {
  const s = expectedSalary(trip, transactions)
  if (!s) return null
  if (s.currency === currency) return s.amount
  const at = tripEnd(trip, legs) || date
  const own = s.currency === 'EUR' ? { rate: 1 } : rateFor(rates, s.currency, at)
  if (!own) return null
  const eur = round2(s.amount / own.rate)
  if (currency === 'EUR') return eur
  const hit = rateFor(rates, currency, date)
  return hit ? round2(eur * hit.rate) : null
}

/** Verwacht totaal van deze tochten in de valuta van de uitbetaling; null als een koers ontbreekt. */
export function expectedPayout(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], currency: Currency, date: string, rates: RatesFile | null): number | null {
  let total = 0
  for (const x of trips) {
    const v = expectedIn(x, legs, transactions, currency, date, rates)
    if (v === null) return null
    total += v
  }
  return round2(total)
}

/** De uitbetaling verdeeld over de tochten, naar verhouding van het verwachte salaris (zonder koers gelijk verdeeld). */
export function splitPayout(amount: number, trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], currency: Currency, date: string, rates: RatesFile | null): number[] {
  if (trips.length === 0) return []
  const weights = trips.map((x) => expectedIn(x, legs, transactions, currency, date, rates))
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

export interface Payout {
  org: Organisation
  amount: number
  currency: Currency
  /** jjjj-mm-dd */
  date: string
}

/**
 * Een uitbetaling opslaan: per tocht zijn salaris op ontvangen met zijn deel (hetzelfde payoutId). Zonder tochten één
 * inkomen van de organisatie. Ongedaan maken zet alles terug.
 */
export async function recordPayout(tx: Tx, payout: Payout, chosen: readonly Trip[], rates: RatesFile | null): Promise<void> {
  const legs = tx.list('legs.json.enc')
  // De tochten zoals ze nu op het apparaat staan; een tocht die intussen al ontvangen is (een tweede tik, een ander
  // apparaat), gaat niet nog eens mee. Is er dan niets meer over, dan wordt er niets geboekt.
  const latest = tx.list('trips.json.enc')
  const all = tx.list('transactions.json.enc')
  const trips = chosen.map((x) => latest.find((t) => t.id === x.id) ?? x).filter((x) => x.deletedAt === null && !!expectedSalary(x, all))
  if (chosen.length > 0 && trips.length === 0) return
  // Elke tocht krijgt minstens één cent: een kleiner bedrag is geen uitbetaling.
  if (round2(payout.amount) < minimumPayout(Math.max(1, trips.length))) throw new Error('Bedrag te klein voor deze trips')
  const payoutId = newId()
  const amount = round2(payout.amount)
  if (trips.length === 0) {
    const base = { date: payout.date, amount, currency: payout.currency }
    await tx.put('transactions.json.enc', {
      id: newId(),
      ...base,
      kind: 'loon',
      source: sourceForOrganisation(payout.org),
      status: 'ontvangen',
      // Zonder tochten hoort de uitbetaling bij het seizoen van die organisatie (per organisatie en jaaroverzicht).
      season: { org: payout.org, year: Number(payout.date.slice(0, 4)) },
      payoutId,
      ...(payout.currency === 'EUR' ? { amountEur: amount } : (finalRateFields(base, rates) ?? {})),
      updatedAt: tx.now,
      deletedAt: null,
    })
    return
  }
  const parts = splitPayout(amount, trips, legs, all, payout.currency, payout.date, rates)
  for (const [i, trip] of trips.entries()) await saveSalary(tx, trip.id, { amount: parts[i]!, currency: payout.currency, status: 'ontvangen', date: payout.date, payoutId, rates })
}

export interface PayoutQuestion {
  org: Organisation
  /** jjjj-mm van de maand waarvan de tochten zijn (de maand vóór de uitbetaling). */
  month: string
  trips: Trip[]
}

/**
 * Vandaag bij een maandelijkse uitbetaling: vanaf dag N van de maand "Uitbetaling van <organisatie> voor <maand>
 * ontvangen?" voor de open tochten die vóór deze maand eindigden (en wat daarvóór nog openstond). Zonder bedragen.
 */
export function payoutQuestions(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, today: string, transactions: readonly Transaction[]): PayoutQuestion[] {
  const out: PayoutQuestion[] = []
  for (const org of new Set(active(trips).map((x) => x.organisation).filter((o): o is Organisation => !!o))) {
    const rule = payoutRule(settings, org)
    if (rule.kind !== 'maandelijks') continue
    const day = Number(today.slice(8, 10))
    const cutoff = day >= rule.day ? firstOfMonth(today) : previousMonthStart(today)
    const due = openSalaryTrips(trips, legs, transactions, org, today).filter((x) => {
      const ask = expectedSalary(x, transactions)?.askAfter
      return tripEnd(x, legs) < cutoff && (!ask || ask <= today)
    })
    if (due.length > 0) out.push({ org, month: previousMonthStart(cutoff).slice(0, 7), trips: due })
  }
  return out
}

/** Een organisatie met een maandelijkse uitbetaling: geen vraag per tocht, wel één per uitbetaling. */
export function asksPerTrip(settings: Settings, trip: Trip): boolean {
  return payoutRule(settings, trip.organisation).kind === 'per-trip'
}

/** Bedrag in euro en wat zonder koers per valuta blijft. */
export interface MoneySum {
  eur: number
  other: Partial<Record<Currency, number>>
}

export const emptySum = (): MoneySum => ({ eur: 0, other: {} })

export function addTo(sum: MoneySum, amount: number, currency: Currency, eur: number | null, sign = 1): void {
  if (eur === null) sum.other[currency] = round2((sum.other[currency] ?? 0) + sign * amount)
  else sum.eur = round2(sum.eur + sign * eur)
}

export function addSums(into: MoneySum, from: MoneySum, sign = 1): void {
  into.eur = round2(into.eur + sign * from.eur)
  for (const [c, v] of Object.entries(from.other) as [Currency, number][]) into.other[c] = round2((into.other[c] ?? 0) + sign * v)
}
