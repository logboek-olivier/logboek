import { balanceOn, toEur, type EurAmount } from './accounts'
import type { CalendarIndex } from './calendar'
import { expectedCosts, type DayAverage } from './costs'
import { active } from './derive'
import { eurOf } from './money'
import { payoutRule } from './money-path'
import { type RatesFile } from './rates'
import { countedSalary, salaryEur, tipAverages, tripEnd } from './salary'
import type { Account, AccountKind, Balance, Claim, CostDayType, Currency, FixedCost, Leg, Organisation, Settings, Transaction, Trip } from './types'
import { endedFor } from './trip-dates'
import { round2 } from '../basis/bedrag'
import { monthOf, shiftMonth } from '../basis/datum'

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

/** Periode voor Mijn positie en de vooruitblik (Geld): een snelkeuze of zelf gekozen van en tot. */
export type PeriodPreset = 'carriere' | 'jaar' | 'planning' | 'alles' | 'eigen'
export interface PeriodChoice {
  preset: PeriodPreset
  /** jjjj-mm-dd, alleen bij `eigen`. */
  from?: string
  to?: string
}
export interface Period {
  from: string
  to: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * De periode bij een keuze: sinds de start van de zeilcarrière (tot het einde van de planning), dit kalenderjaar, van
 * vandaag tot het einde van de planning, alles (vanaf de eerste gegevens tot het einde van de planning), of zelf gekozen.
 * Zonder planning is het einde vandaag. Een ongeldige eigen keuze valt terug op sinds de start van de zeilcarrière.
 */
export function resolvePeriod(choice: PeriodChoice, settings: Settings, today: string, planningEnd: string | null, earliest: string | null): Period {
  const end = planningEnd && planningEnd > today ? planningEnd : today
  const start = careerStart(settings)
  switch (choice.preset) {
    case 'jaar':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
    case 'planning':
      return { from: today, to: end }
    case 'alles':
      return { from: earliest && earliest < start ? earliest : start, to: end }
    case 'eigen':
      if (choice.from && choice.to && ISO.test(choice.from) && ISO.test(choice.to) && choice.from <= choice.to) return { from: choice.from, to: choice.to }
      return { from: start, to: end }
    default:
      return { from: start, to: end }
  }
}

/** De vroegste datum met gegevens (stand, transactie of trip), voor "alles". */
export function earliestDate(input: PositionInput): string | null {
  let min: string | null = null
  const see = (d: string | undefined) => {
    if (d && ISO.test(d) && (min === null || d < min)) min = d
  }
  for (const b of input.balances) if (b.deletedAt === null) see(b.date)
  for (const tx of input.transactions) if (tx.deletedAt === null) see(tx.date)
  for (const trip of input.trips) if (trip.deletedAt === null) see(trip.startDate)
  return min
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
  /** Declaraties met een bedrag die op die dag nog niet terugbetaald waren (open of ingediend). */
  claims: Claim[]
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

/**
 * Is het salaris van deze trip op `date` al betaald (het inkomen van "ontvangen" staat op of vóór die dag)? Een
 * salarisinkomen bij de trip telt ook als de status nog op verwacht staat (die viel bijvoorbeeld op een ander apparaat
 * terug): wat binnen is, is niet meer te ontvangen.
 */
function paidBy(trip: Trip, transactions: readonly Transaction[], date: string): boolean {
  const s = trip.salary
  if (!s) return false
  if (transactions.some((x) => x.deletedAt === null && x.kind === 'loon' && x.tripId === trip.id && x.date <= date)) return true
  if (s.status !== 'ontvangen') return false
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
  /** Declaraties (open of ingediend met een bedrag tellen als te ontvangen). */
  claims?: readonly Claim[]
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
    claims: [],
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
    const s = countedSalary(trip)
    const end = tripEnd(trip, legs)
    if (!s || !end || endedFor(trip, end) >= date || paidBy(trip, transactions, date)) continue
    out.receivable.push({ trip, amount: s.amount, currency: s.currency })
    add(out.totals.receivable, s.amount, s.currency, date, rates)
  }
  out.receivable.sort((a, b) => tripEnd(a.trip, legs).localeCompare(tripEnd(b.trip, legs)))
  // Declaraties: met een bedrag, op die dag al gedaan en nog niet terugbetaald.
  for (const c of active(input.claims ?? [])) {
    if (c.status === 'terugbetaald' && !c.repaid) continue
    if (c.amount === undefined || c.currency === undefined || c.amount <= 0 || c.date > date) continue
    if (c.repaid && c.repaid.date <= date) continue
    // De terugbetaling staat er al (ook als de declaratie zelf nog niet op terugbetaald staat): niet meer te ontvangen.
    if (transactions.some((tx) => tx.deletedAt === null && tx.kind === 'terugbetaling' && tx.claimId === c.id && tx.date <= date)) continue
    out.claims.push(c)
    add(out.totals.receivable, c.amount, c.currency, date, rates)
  }
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
  /** jjjj-mm-dd: het uitbetaalmoment (salaris), het einde van de trip (fooi) of het einde van de maand (kosten). */
  date: string
  /** Kosten (vaste lasten, variabele kosten) staan als negatief bedrag. */
  kind: 'salaris' | 'fooi' | 'vaste-lasten' | 'kosten'
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
  /** Daarvan kosten (vaste lasten en variabele kosten, negatief). */
  costsEur: number
  /** Een dagsoort zonder eigen gemiddelde of standaardbedrag: de variabele kosten zijn dan te laag. */
  costsUnknown: boolean
  /** Verwacht salaris zonder koers, per valuta (niet meegeteld). */
  other: Partial<Record<Currency, number>>
  months: ForecastMonth[]
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return Math.max(0, (ty - fy) * 12 + (tm - fm))
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
export interface CostInput {
  fixed: readonly FixedCost[]
  averages: Record<CostDayType, DayAverage>
  index: CalendarIndex
}

/**
 * `range` (zelf gekozen periode): de grafiek van de maand van `from` tot de maand van `to`, en alleen salaris, fooi en
 * kosten tot en met `to`. Zonder `range` de laatste `history` maanden tot het einde van de planning.
 */
export function forecast(input: PositionInput, settings: Settings, today: string, planningEnd: string | null = null, history = 6, costs: CostInput | null = null, range: Period | null = null): Forecast {
  const { trips, legs, transactions, rates } = input
  const now = positionAt(input, today).totals.net
  const items: ForecastItem[] = []
  const other: Partial<Record<Currency, number>> = {}
  let until = monthOf(today)
  if (range) {
    if (monthOf(range.to) > until) until = monthOf(range.to)
  } else if (planningEnd && monthOf(planningEnd) > until) until = monthOf(planningEnd)
  // Binnen de gekozen periode: alleen wat er tot en met `to` binnenkomt of afgaat.
  const inRange = (date: string) => !range || date <= range.to
  const averages = tipAverages(trips, legs, transactions, today)
  for (const trip of active(trips)) {
    const end = tripEnd(trip, legs)
    if (!end || end < today) continue
    if (!range && monthOf(end) > until) until = monthOf(end)
    const s = countedSalary(trip)
    const moment = s && s.status === 'verwacht' ? (payoutMoment(trip, legs, settings) ?? end) : end
    if (s && s.status === 'verwacht' && inRange(moment)) {
      if (!range && monthOf(moment) > until) until = monthOf(moment)
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
    if (avg !== undefined && inRange(end)) {
      const already = active(transactions)
        .filter((tx) => tx.kind === 'fooi' && tx.tripId === trip.id)
        .reduce((n, tx) => n + (eurOf(tx) ?? 0), 0)
      const estimate = round2(Math.max(0, avg - already))
      if (estimate > 0) items.push({ date: end, kind: 'fooi', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], eur: estimate })
    }
  }
  // Kosten tot het einde van de planning: per maand de vaste lasten en de variabele kosten (negatief).
  let costsUnknown = false
  if (costs) {
    for (const m of expectedCosts(costs.fixed, costs.averages, costs.index, today, until, rates)) {
      const last = range && monthLast(m.month) > range.to ? range.to : monthLast(m.month)
      if (m.fixedEur > 0) items.push({ date: last, kind: 'vaste-lasten', trips: [], eur: -m.fixedEur })
      if (m.variableEur > 0) items.push({ date: last, kind: 'kosten', trips: [], eur: -m.variableEur })
      costsUnknown ||= m.unknown
    }
  }
  const order = { salaris: 0, fooi: 1, 'vaste-lasten': 2, kosten: 3 }
  items.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind])
  const addsEur = round2(items.reduce((n, i) => n + i.eur, 0))
  const tipEstimateEur = round2(items.filter((i) => i.kind === 'fooi').reduce((n, i) => n + i.eur, 0))
  const costsEur = round2(items.filter((i) => i.kind === 'vaste-lasten' || i.kind === 'kosten').reduce((n, i) => n + i.eur, 0))
  const nowKnown = Object.keys(now.other).length === 0
  const months: ForecastMonth[] = []
  const current = monthOf(today)
  // Gemeten maanden: de laatste `history`, of vanaf de maand van `from` (hoogstens vijf jaar terug).
  if (range) history = Math.min(60, monthsBetween(monthOf(range.from), current) + 1)
  for (let i = history - 1; i >= 1; i--) {
    const month = shiftMonth(current, -i)
    const p = positionAt(input, range && range.to < monthLast(month) ? range.to : monthLast(month))
    const known = p.counted > 0 || p.receivable.length > 0 || p.claims.length > 0 || Object.keys(p.cashTips).length > 0
    months.push({ month, eur: known && Object.keys(p.totals.net.other).length === 0 ? p.totals.net.eur : null, future: false })
  }
  months.push({ month: current, eur: nowKnown ? now.eur : null, future: false })
  // Een periode die al voorbij is: niets verwachts, alleen gemeten tot en met `to`.
  if (range && range.to < today) {
    const past = months.filter((m) => m.month <= monthOf(range.to))
    const end = positionAt(input, range.to).totals.net
    return { now, items: [], until: monthOf(range.to), endEur: Object.keys(end.other).length === 0 ? end.eur : null, addsEur: 0, tipEstimateEur: 0, costsEur: 0, costsUnknown: false, other, months: past }
  }
  for (let month = shiftMonth(current, 1); month <= until; month = shiftMonth(month, 1)) {
    const by = range && monthLast(month) > range.to ? range.to : monthLast(month)
    const added = items.filter((i) => i.date <= by).reduce((n, i) => n + i.eur, 0)
    months.push({ month, eur: nowKnown ? round2(now.eur + added) : null, future: true })
  }
  // De lopende maand: wat er nog deze maand binnenkomt, telt pas in de verwachte lijn; het punt van nu is gemeten.
  return { now, items, until, endEur: nowKnown ? round2(now.eur + addsEur) : null, addsEur, tipEstimateEur, costsEur, costsUnknown, other, months }
}
