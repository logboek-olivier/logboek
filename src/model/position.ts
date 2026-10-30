import { balanceOn, toEur, type EurAmount } from './accounts'
import { active } from './derive'
import { eurOf, round2 } from './money'
import { payoutRule } from './money-path'
import { rateFor, type RatesFile } from './rates'
import { salaryEur, tipAverages, tripEnd } from './salary'
import type { Account, AccountKind, Balance, Currency, Leg, Organisation, Settings, Transaction, Trip } from './types'

// Geld → Mijn positie: wat Olivier nu heeft, en waar zijn planning naartoe gaat. Op de bank (betaal- en
// spaarrekeningen), contant (contante fooien die nog niet gestort zijn, plus de stand van een kasrekening), te ontvangen
// (salaris van voorbije trips dat nog niet betaald is), beleggingen en studieschuld, en de netto waarde: alles bij
// elkaar. Twee totalen: alles, en wat er sinds het begin van de zeilcarrière bijkwam. De vooruitblik telt bij de netto
// waarde van nu het verwachte salaris van komende trips op (per uitbetaalmoment) en een geschatte fooi (eigen gemiddelde
// per organisatie, als schatting gemarkeerd). Alles in euro met de koers van de dag; zonder koers apart per valuta.

/** Standaard begin van de zeilcarrière (Instellingen → Start zeilcarrière). */
export const DEFAULT_CAREER_START = '2026-09-11'

export function careerStart(settings: Settings): string {
  const d = settings.careerStart
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : DEFAULT_CAREER_START
}

/** Een bedrag in euro plus wat zonder koers per valuta blijft. */
export interface Sum {
  eur: number
  provisional: boolean
  other: Partial<Record<Currency, number>>
}

const emptySum = (): Sum => ({ eur: 0, provisional: false, other: {} })

function add(sum: Sum, amount: number, currency: Currency, date: string, rates: RatesFile | null): void {
  const eur = toEur(amount, currency, date, rates)
  if (eur) {
    sum.eur = round2(sum.eur + eur.eur)
    sum.provisional ||= eur.provisional
  } else sum.other[currency] = round2((sum.other[currency] ?? 0) + amount)
}

function addSum(into: Sum, from: Sum): void {
  into.eur = round2(into.eur + from.eur)
  into.provisional ||= from.provisional
  for (const [c, v] of Object.entries(from.other) as [Currency, number][]) into.other[c] = round2((into.other[c] ?? 0) + v)
}

export interface AccountRow {
  account: Account
  balance: Balance | null
  eur: EurAmount | null
}

export interface ReceivableRow {
  trip: Trip
  amount: number
  currency: Currency
}

export interface Position {
  date: string
  bank: AccountRow[]
  /** Contant: de kasrekeningen en de contante fooien die nog niet gestort zijn. */
  cashAccounts: AccountRow[]
  cashTips: Partial<Record<Currency, number>>
  receivable: ReceivableRow[]
  investments: AccountRow[]
  debts: AccountRow[]
  totals: Record<'bank' | 'cash' | 'receivable' | 'investments' | 'debts' | 'net', Sum>
  /** Rekeningen met een stand. */
  counted: number
}

const GROUP: Record<AccountKind, 'bank' | 'cash' | 'investments' | 'debts'> = {
  betaal: 'bank',
  spaar: 'bank',
  contant: 'cash',
  beleggen: 'investments',
  schuld: 'debts',
}

/** Is het salaris van deze trip op `date` al betaald (het inkomen van "ontvangen" staat op of vóór die dag)? */
function paidBy(trip: Trip, transactions: readonly Transaction[], date: string): boolean {
  const s = trip.salary
  if (!s || s.status !== 'ontvangen') return false
  const tx = s.transactionId ? transactions.find((x) => x.id === s.transactionId) : undefined
  // Zonder bekend inkomen (een oudere of handmatige ontvangst): betaald.
  return !tx || tx.deletedAt !== null || tx.date <= date
}

export interface PositionInput {
  accounts: readonly Account[]
  balances: readonly Balance[]
  trips: readonly Trip[]
  legs: readonly Leg[]
  transactions: readonly Transaction[]
  rates: RatesFile | null
}

/**
 * De positie op `date`. `firstBalance`: zonder stand op of vóór die dag telt de eerste stand daarna (voor het begin
 * van de zeilcarrière, als de eerste stand pas later is ingevoerd).
 */
export function positionAt(input: PositionInput, date: string, firstBalance = false): Position {
  const { accounts, balances, trips, legs, transactions, rates } = input
  const out: Position = {
    date,
    bank: [],
    cashAccounts: [],
    cashTips: {},
    receivable: [],
    investments: [],
    debts: [],
    totals: { bank: emptySum(), cash: emptySum(), receivable: emptySum(), investments: emptySum(), debts: emptySum(), net: emptySum() },
    counted: 0,
  }
  const cashStandDate = new Map<Currency, string>()
  for (const account of accounts) {
    if (account.deletedAt !== null || (account.closedAt && account.closedAt <= date)) continue
    let balance = balanceOn(balances, account.id, date)
    if (!balance && firstBalance) {
      balance =
        balances
          .filter((b) => b.deletedAt === null && b.accountId === account.id && b.date > date)
          .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
    }
    const row: AccountRow = { account, balance, eur: balance ? toEur(balance.amount, account.currency, date, rates) : null }
    const group = GROUP[account.kind] ?? 'bank'
    if (group === 'bank') out.bank.push(row)
    else if (group === 'cash') out.cashAccounts.push(row)
    else if (group === 'investments') out.investments.push(row)
    else out.debts.push(row)
    if (!balance) continue
    out.counted++
    add(out.totals[group], balance.amount, account.currency, date, rates)
    if (group === 'cash') {
      const prev = cashStandDate.get(account.currency)
      if (!prev || balance.date > prev) cashStandDate.set(account.currency, balance.date)
    }
  }
  // Contante fooien op die dag nog niet gestort. Een kasrekening in dezelfde valuta met een stand telt de fooien tot en
  // met die stand al mee; alleen latere fooien komen erbij.
  for (const tx of active(transactions)) {
    if (tx.kind !== 'fooi' || tx.tipVia !== 'contant' || tx.date > date) continue
    if (tx.depositedAt && tx.depositedAt <= date) continue
    const stand = cashStandDate.get(tx.currency)
    if (stand && tx.date <= stand) continue
    out.cashTips[tx.currency] = round2((out.cashTips[tx.currency] ?? 0) + tx.amount)
    add(out.totals.cash, tx.amount, tx.currency, date, rates)
  }
  // Te ontvangen: salaris van trips die op die dag voorbij waren en nog niet betaald.
  for (const trip of active(trips)) {
    const s = trip.salary
    const end = tripEnd(trip, legs)
    if (!s || !end || end >= date || paidBy(trip, transactions, date)) continue
    out.receivable.push({ trip, amount: s.amount, currency: s.currency })
    add(out.totals.receivable, s.amount, s.currency, date, rates)
  }
  out.receivable.sort((a, b) => tripEnd(a.trip, legs).localeCompare(tripEnd(b.trip, legs)))
  for (const key of ['bank', 'cash', 'receivable', 'investments', 'debts'] as const) addSum(out.totals.net, out.totals[key])
  return out
}

/** Verschil van twee bedragen; null als een van beide iets zonder koers bevat (dan is het niet te zeggen). */
export function difference(now: Sum, then: Sum): number | null {
  if (Object.keys(now.other).length > 0 || Object.keys(then.other).length > 0) return null
  return round2(now.eur - then.eur)
}

/** Wanneer het salaris van een trip waarschijnlijk binnenkomt: na de trip, of maandelijks rond dag N in de maand erna. */
export function payoutMoment(trip: Trip, legs: readonly Leg[], settings: Settings): string | null {
  const end = tripEnd(trip, legs)
  if (!end) return null
  const rule = payoutRule(settings, trip.organisation)
  if (rule.kind === 'per-trip') return end
  const [y, m] = end.split('-').map(Number) as [number, number]
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return `${next}-${String(rule.day).padStart(2, '0')}`
}

export interface ForecastItem {
  /** jjjj-mm-dd: het uitbetaalmoment (salaris) of het einde van de trip (fooi). */
  date: string
  kind: 'salaris' | 'fooi'
  org?: Organisation
  trips: Trip[]
  eur: number
}

export interface ForecastMonth {
  /** jjjj-mm */
  month: string
  /** Netto waarde aan het einde van de maand (de lopende maand: vandaag); verleden gemeten, toekomst verwacht. */
  eur: number | null
  future: boolean
}

export interface Forecast {
  now: Sum
  /** Verwacht salaris per uitbetaalmoment en de geschatte fooi per trip, in de tijd. */
  items: ForecastItem[]
  /** jjjj-mm van de laatste maand van de planning. */
  until: string
  /** Netto waarde aan het einde van de planning (null zonder koers voor alles van nu). */
  endEur: number | null
  /** Wat de planning toevoegt: salaris plus geschatte fooi. */
  addsEur: number
  /** Daarvan geschatte fooi. */
  tipEstimateEur: number
  /** Verwacht salaris zonder koers, per valuta (niet meegeteld). */
  other: Partial<Record<Currency, number>>
  months: ForecastMonth[]
}

function monthOf(date: string): string {
  return date.slice(0, 7)
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLast(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/**
 * Vooruitblik tot het einde van de planning (de laatste trip, of `planningEnd` uit de agenda): de netto waarde van nu,
 * plus het verwachte salaris van trips die nog niet voorbij zijn (op het uitbetaalmoment) en een geschatte fooi per
 * komende trip (eigen gemiddelde van de organisatie, min wat er die trip al binnenkwam). Salaris van voorbije trips staat
 * al in "te ontvangen" en telt dus niet nog eens. De laatste zes maanden gemeten, daarna verwacht.
 */
export function forecast(input: PositionInput, settings: Settings, today: string, planningEnd: string | null = null, history = 6): Forecast {
  const { trips, legs, transactions, rates } = input
  const now = positionAt(input, today).totals.net
  const items: ForecastItem[] = []
  const other: Partial<Record<Currency, number>> = {}
  let until = monthOf(today)
  if (planningEnd && monthOf(planningEnd) > until) until = monthOf(planningEnd)
  const averages = tipAverages(trips, legs, transactions, today)
  for (const trip of active(trips)) {
    const end = tripEnd(trip, legs)
    if (!end || end < today) continue
    if (monthOf(end) > until) until = monthOf(end)
    const s = trip.salary
    if (s && s.status === 'verwacht') {
      const moment = payoutMoment(trip, legs, settings) ?? end
      if (monthOf(moment) > until) until = monthOf(moment)
      const eur = salaryEur(s, end, rates) ?? (s.currency === 'EUR' ? s.amount : null)
      if (eur === null) other[s.currency] = round2((other[s.currency] ?? 0) + s.amount)
      else {
        const same = items.find((i) => i.kind === 'salaris' && i.date === moment && i.org === trip.organisation)
        if (same) {
          same.trips.push(trip)
          same.eur = round2(same.eur + eur)
        } else items.push({ date: moment, kind: 'salaris', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], eur })
      }
    }
    const avg = trip.organisation ? averages[trip.organisation] : undefined
    if (avg !== undefined) {
      const already = active(transactions)
        .filter((tx) => tx.kind === 'fooi' && tx.tripId === trip.id)
        .reduce((n, tx) => n + (eurOf(tx) ?? 0), 0)
      const estimate = round2(Math.max(0, avg - already))
      if (estimate > 0) items.push({ date: end, kind: 'fooi', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], eur: estimate })
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'salaris' ? -1 : 1))
  const addsEur = round2(items.reduce((n, i) => n + i.eur, 0))
  const tipEstimateEur = round2(items.filter((i) => i.kind === 'fooi').reduce((n, i) => n + i.eur, 0))
  const nowKnown = Object.keys(now.other).length === 0
  const months: ForecastMonth[] = []
  const current = monthOf(today)
  for (let i = history - 1; i >= 1; i--) {
    const month = shiftMonth(current, -i)
    const p = positionAt(input, monthLast(month))
    const known = p.counted > 0 || p.receivable.length > 0 || Object.keys(p.cashTips).length > 0
    months.push({ month, eur: known && Object.keys(p.totals.net.other).length === 0 ? p.totals.net.eur : null, future: false })
  }
  months.push({ month: current, eur: nowKnown ? now.eur : null, future: false })
  for (let month = shiftMonth(current, 1); month <= until; month = shiftMonth(month, 1)) {
    const by = monthLast(month)
    const added = items.filter((i) => i.date <= by).reduce((n, i) => n + i.eur, 0)
    months.push({ month, eur: nowKnown ? round2(now.eur + added) : null, future: true })
  }
  // De lopende maand: wat er nog deze maand binnenkomt, telt pas in de verwachte lijn; het punt van nu is gemeten.
  return { now, items, until, endEur: nowKnown ? round2(now.eur + addsEur) : null, addsEur, tipEstimateEur, other, months }
}

/** Een stand in euro met de koers van vandaag, voor de snelle invoer (null zonder koers). */
export function eurToday(amount: number, currency: Currency, today: string, rates: RatesFile | null): number | null {
  if (currency === 'EUR') return amount
  const hit = rateFor(rates, currency, today)
  return hit ? round2(amount / hit.rate) : null
}
