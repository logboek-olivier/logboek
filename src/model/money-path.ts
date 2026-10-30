import type { Store } from '../storage/store'
import { active } from './derive'
import type { Undo } from './edit'
import { eurOf, round2 } from './money'
import { finalRateFields, rateFor, type RatesFile } from './rates'
import { salaryEur, salarySource, tripEnd } from './salary'
import { newId, type Currency, type Leg, type Organisation, type PayoutRule, type Settings, type Transaction, type TransactionSource, type Trip } from './types'

// Geldpad per trip: per soort geld een status. Salaris: verwacht (de trip is nog niet voorbij), te ontvangen (voorbij,
// nog niet betaald) of ontvangen. Fooi: contant of op de bank; contant staat in "Contant" tot hij gestort is, zodat
// niets dubbel telt (gestort geld staat op de bank). Een uitbetaling van een organisatie ("SV betaalde € X op <datum>")
// vinkt de trips die erbij horen in één keer af; per trip komt er een eigen inkomen, naar verhouding van het verwachte
// salaris, zodat inkomsten per trip blijven kloppen. Een eigen of ontvangen salaris wordt nooit vanzelf overschreven.

export type SalaryState = 'verwacht' | 'te-ontvangen' | 'ontvangen'

/** Status van het salaris van een trip op een datum; null als de trip geen salaris heeft. */
export function salaryState(trip: Trip, legs: readonly Leg[], today: string): SalaryState | null {
  const s = trip.salary
  if (!s) return null
  if (s.status === 'ontvangen') return 'ontvangen'
  const end = tripEnd(trip, legs)
  return end && end < today ? 'te-ontvangen' : 'verwacht'
}

/** Hoe de organisatie uitbetaalt; zonder (geldige) instelling na elke trip. */
export function payoutRule(settings: Settings, org: Organisation | undefined): PayoutRule {
  const rule = org ? settings.payouts?.[org] : undefined
  if (rule?.kind === 'maandelijks' && Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 28) return rule
  return { kind: 'per-trip' }
}

const byEnd = (legs: readonly Leg[]) => (a: Trip, b: Trip) => tripEnd(a, legs).localeCompare(tripEnd(b, legs)) || a.id.localeCompare(b.id)

/** Trips van een organisatie met een salaris dat op `date` te ontvangen is, oudste eerst. */
export function openSalaryTrips(trips: readonly Trip[], legs: readonly Leg[], org: Organisation, date: string): Trip[] {
  return active(trips)
    .filter((x) => x.organisation === org && salaryState(x, legs, date) === 'te-ontvangen')
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
 * Welke trips een uitbetaling op `date` waarschijnlijk afrekent: na elke trip de oudste open trip; maandelijks de open
 * trips die vóór de maand van de uitbetaling eindigden (de trips van de vorige maand, en wat daarvóór nog openstond).
 */
export function payoutSuggestion(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, org: Organisation, date: string): Trip[] {
  const open = openSalaryTrips(trips, legs, org, date)
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
  const parts = w.map((x) => round2((amount * x) / sum))
  // Afronding: het laatste deel krijgt het verschil, zodat de delen samen precies het betaalde bedrag zijn.
  parts[parts.length - 1] = round2(amount - parts.slice(0, -1).reduce((n, x) => n + x, 0))
  return parts
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
export async function recordPayout(store: Store, payout: Payout, trips: readonly Trip[], rates: RatesFile | null): Promise<Undo> {
  const legs = store.list('legs.json.enc')
  const now = new Date().toISOString()
  const payoutId = newId()
  const amount = round2(payout.amount)
  const parts = trips.length > 0 ? splitPayout(amount, trips, legs, payout.currency, payout.date, rates) : [amount]
  const txs: Transaction[] = parts.map((part, i) => {
    const trip = trips[i]
    const base = { date: payout.date, amount: part, currency: payout.currency }
    return {
      id: newId(),
      ...base,
      kind: 'loon',
      source: trip ? salarySource(trip) : orgSource(payout.org),
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
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.putMany('transactions.json.enc', txs.map((tx) => ({ ...tx, deletedAt: later, updatedAt: later })))
    if (trips.length > 0) await store.putMany('trips.json.enc', trips.map((trip) => ({ ...trip, updatedAt: later })))
    void store.sync()
  }
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
export function payoutQuestions(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, today: string): PayoutQuestion[] {
  const out: PayoutQuestion[] = []
  for (const org of new Set(active(trips).map((x) => x.organisation).filter((o): o is Organisation => !!o))) {
    const rule = payoutRule(settings, org)
    if (rule.kind !== 'maandelijks') continue
    const day = Number(today.slice(8, 10))
    const cutoff = day >= rule.day ? firstOfMonth(today) : previousMonthStart(today)
    const due = openSalaryTrips(trips, legs, org, today).filter((x) => tripEnd(x, legs) < cutoff && (!x.salary!.askAfter || x.salary!.askAfter <= today))
    if (due.length > 0) out.push({ org, month: previousMonthStart(cutoff).slice(0, 7), trips: due })
  }
  return out
}

/** Een organisatie met een maandelijkse uitbetaling: geen vraag per trip, wel één per uitbetaling. */
export function asksPerTrip(settings: Settings, trip: Trip): boolean {
  return payoutRule(settings, trip.organisation).kind === 'per-trip'
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
export async function depositCash(store: Store, currency: Currency, date: string): Promise<Undo> {
  const tips = cashTips(store.list('transactions.json.enc')).filter((tx) => tx.currency === currency)
  const now = new Date().toISOString()
  await store.putMany('transactions.json.enc', tips.map((tx) => ({ ...tx, depositedAt: date, updatedAt: now })))
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.putMany('transactions.json.enc', tips.map((tx) => ({ ...tx, updatedAt: later })))
    void store.sync()
  }
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

/** Het geldpad van één trip: salaris met status, en de fooien naar contant, bank en onbekend. */
export function tripMoney(trip: Trip, legs: readonly Leg[], transactions: readonly Transaction[], today: string): TripMoney {
  const state = salaryState(trip, legs, today)
  const tips: TripMoney['tips'] = { contant: emptySum(), bank: emptySum(), onbekend: emptySum() }
  for (const tx of active(transactions)) {
    if (tx.kind !== 'fooi' || tx.tripId !== trip.id) continue
    const sum = tips[tx.tipVia ?? 'onbekend']
    const eur = eurOf(tx)
    if (eur === null) sum.other[tx.currency] = round2((sum.other[tx.currency] ?? 0) + tx.amount)
    else sum.eur = round2(sum.eur + eur)
  }
  return { salary: state && trip.salary ? { state, amount: trip.salary.amount, currency: trip.salary.currency } : null, tips }
}
