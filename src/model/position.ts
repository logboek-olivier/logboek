import { balanceOn, toEur, type EurAmount } from './accounts'
import type { CalendarIndex } from './calendar'
import { expectedCosts, type DayAverage } from './costs'
import { ownCostsOn, scenarioParts, type BlockRange, type ScenarioPart } from './scenario'
import { active } from './derive'
import { eurOf, totals } from './money'
import { booked } from '../domain/geldmodel'
import { payoutRule } from './money-path'
import { eurValue, type RatesFile } from './rates'
import { tipAverages, tripEnd } from './salary'
import { salaryStatus } from '../domain/geldmodel'
import type { Account, AccountKind, Balance, Claim, CostDayType, Currency, FixedCost, Leg, Organisation, Settings, Transaction, Trip } from './types'
import { endedFor } from './trip-dates'
import { round2 } from '../basis/bedrag'
import { addDays, monthOf, shiftMonth } from '../basis/datum'
import { transactionList } from '../domain/geldrapport'

// Geld → Mijn positie: wat de gebruiker nu heeft, en waar de planning naartoe gaat. De rekeningen (op de bank, een
// kasrekening, beleggingen en schulden) plus wat nog te ontvangen is (het salaris van voorbije tochten dat nog niet
// binnen is, en declaraties), en de netto waarde: alles bij elkaar. Twee totalen: de netto waarde vandaag, en de
// verandering in de gekozen periode (netto waarde op het einde min die op de begindag, met een uitsplitsing die precies
// optelt; zonder stand op de begindag "onbekend", nooit verzonnen). De vooruitblik telt bij de netto waarde van vandaag
// het verwachte salaris van komende trips op (per uitbetaalmoment), een geschatte fooi (eigen gemiddelde per organisatie,
// als schatting gemarkeerd) en de kosten. Alles in euro met de koers van de dag; zonder koers apart per valuta. Geen
// datums, bedragen of organisaties van een bepaalde gebruiker: alles komt uit de instellingen en de data.

/** De start van de zeilcarrière (Instellingen → Start zeilcarrière), of null als die niet is ingesteld. */
export function careerStart(settings: Settings): string | null {
  const d = settings.careerStart
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
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

/** De snelkeuze die echt geldt: "sinds de start van de zeilcarrière" zonder ingestelde start is "dit jaar". */
export function effectivePreset(choice: PeriodChoice, settings: Settings): PeriodPreset {
  return choice.preset === 'carriere' && careerStart(settings) === null ? 'jaar' : choice.preset
}

/**
 * De periode bij een keuze: sinds de start van de zeilcarrière (tot het einde van de planning), dit kalenderjaar, van
 * vandaag tot het einde van de planning, alles (vanaf de eerste gegevens tot het einde van de planning), of zelf gekozen.
 * Zonder planning is het einde vandaag. Zonder ingestelde start van de zeilcarrière geldt "dit jaar"; een ongeldige eigen
 * keuze valt terug op de standaard.
 */
export function resolvePeriod(choice: PeriodChoice, settings: Settings, today: string, planningEnd: string | null, earliest: string | null): Period {
  const end = planningEnd && planningEnd > today ? planningEnd : today
  const career = careerStart(settings)
  const year = { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
  const standard = career ? { from: career, to: end > career ? end : career } : year
  switch (effectivePreset(choice, settings)) {
    case 'jaar':
      return year
    case 'planning':
      return { from: today, to: end }
    case 'alles': {
      const first = [earliest, career].filter((d): d is string => !!d).sort()[0] ?? year.from
      return { from: first, to: end > first ? end : first }
    }
    case 'eigen':
      if (choice.from && choice.to && ISO.test(choice.from) && ISO.test(choice.to) && choice.from <= choice.to) return { from: choice.from, to: choice.to }
      return standard
    default:
      return standard
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
  /** Het salaris (een transactie van soort loon bij de tocht). */
  tx: Transaction
  amount: number
  currency: Currency
}

export interface Position {
  date: string
  bank: AccountRow[]
  /** Contant: de kasrekeningen. */
  cashAccounts: AccountRow[]
  receivable: ReceivableRow[]
  /** Declaraties met een bedrag die op die dag nog niet terugbetaald waren (open of ingediend). */
  claims: Claim[]
  investments: AccountRow[]
  /** Bezittingen: huis, boot, auto (soort `bezit`), met hun geschatte waarde. */
  assets: AccountRow[]
  debts: AccountRow[]
  totals: Record<'bank' | 'cash' | 'receivable' | 'investments' | 'assets' | 'debts' | 'net', Sum>
  /** Rekeningen met een stand. */
  counted: number
}

export type PositionGroupKey = 'bank' | 'cash' | 'investments' | 'assets' | 'debts'

export const GROUP: Record<AccountKind, PositionGroupKey> = {
  betaal: 'bank',
  spaar: 'bank',
  contant: 'cash',
  beleggen: 'investments',
  bezit: 'assets',
  schuld: 'debts',
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
 * De positie op `date` (aan het einde van die dag): per rekening die dan open was de laatste stand op of vóór die dag,
 * plus wat op die dag nog te ontvangen was. Een rekening zonder stand op of vóór die dag telt niet mee (nooit een latere
 * stand: dat zou verzinnen zijn).
 */
export function positionAt(input: PositionInput, date: string): Position {
  const { accounts, balances, trips, legs, transactions, rates } = input
  const out: Position = {
    date,
    bank: [],
    cashAccounts: [],
    receivable: [],
    claims: [],
    investments: [],
    assets: [],
    debts: [],
    totals: { bank: emptySum(), cash: emptySum(), receivable: emptySum(), investments: emptySum(), assets: emptySum(), debts: emptySum(), net: emptySum() },
    counted: 0,
  }
  for (const account of accounts) {
    if (account.deletedAt !== null || (account.closedAt && account.closedAt <= date)) continue
    const balance = balanceOn(balances, account.id, date)
    const row: AccountRow = { account, balance, eur: balance ? toEur(balance.amount, account.currency, date, rates) : null }
    const group = GROUP[account.kind] ?? 'bank'
    if (group === 'bank') out.bank.push(row)
    else if (group === 'cash') out.cashAccounts.push(row)
    else if (group === 'investments') out.investments.push(row)
    else if (group === 'assets') out.assets.push(row)
    else out.debts.push(row)
    if (!balance) continue
    out.counted++
    add(out.totals[group], balance.amount, account.currency, date, rates)
  }
  // Te ontvangen: het salaris van tochten die op die dag voorbij waren en nog niet binnen (verwacht, of pas later
  // ontvangen). Alleen salaris dat bij een tocht hoort; een eerder seizoen is al voorbij.
  const tripById = new Map(active(trips).map((x) => [x.id, x]))
  for (const tx of active(transactions)) {
    if (tx.kind !== 'loon' || !tx.tripId || !(tx.amount > 0)) continue
    const status = salaryStatus(tx)
    if (status === 'geen' || (status === 'ontvangen' && tx.date <= date)) continue
    const trip = tripById.get(tx.tripId)
    const end = trip ? tripEnd(trip, legs) : ''
    if (!trip || !end || endedFor(trip, end) >= date) continue
    out.receivable.push({ trip, tx, amount: tx.amount, currency: tx.currency })
    add(out.totals.receivable, tx.amount, tx.currency, date, rates)
  }
  out.receivable.sort((a, b) => tripEnd(a.trip, legs).localeCompare(tripEnd(b.trip, legs)))
  // Declaraties: met een bedrag, op die dag al gedaan en nog niet terugbetaald.
  for (const c of active(input.claims ?? [])) {
    if (c.status === 'terugbetaald' && !c.repaid) continue
    if (c.amount === undefined || c.currency === undefined || c.amount <= 0 || c.date > date) continue
    if (c.repaid && c.repaid.date <= date) continue
    // De terugbetaling staat er al (ook als de declaratie zelf nog niet op terugbetaald staat): niet meer te ontvangen.
    if (booked(transactions).some((tx) => tx.kind === 'terugbetaling' && tx.claimId === c.id && tx.date <= date)) continue
    out.claims.push(c)
    add(out.totals.receivable, c.amount, c.currency, date, rates)
  }
  for (const key of ['bank', 'cash', 'receivable', 'investments', 'assets', 'debts'] as const) addSum(out.totals.net, out.totals[key])
  return out
}

/** Verschil van twee bedragen; null als een van beide iets zonder koers bevat (dan is het niet te zeggen). */
export function difference(now: Sum, then: Sum): number | null {
  if (Object.keys(now.other).length > 0 || Object.keys(then.other).length > 0) return null
  return round2(now.eur - then.eur)
}

/** Een rekening in de verandering van de netto waarde: de stand op de begindag en op het einde, in euro. */
export interface AccountChange {
  account: Account
  start: AccountRow | null
  end: AccountRow | null
  /** Eind min begin in euro (een rekening die op het einde opgeheven is, telt daar als 0). */
  eur: number
}

/**
 * De verandering van de netto waarde in een periode: de netto waarde op het einde (de laatste dag van de periode, hoogstens
 * vandaag) min die op de begindag, met een uitsplitsing die precies optelt:
 * - zeilresultaat: het echte geld in Geld (inkomsten en terugbetalingen min uitgaven) ná de begindag tot en met het einde
 *   (wat op de begindag zelf binnenkwam, zit al in de netto waarde van die dag);
 * - te ontvangen: de verandering in wat nog te ontvangen is (salaris van voorbije tochten, declaraties);
 * - waardeverandering: beleggingen en bezittingen (koers, huizenprijs: geld dat niet in Geld staat);
 * - schulden: wat er van een lening of studieschuld af ging (of bij kwam);
 * - overig: de rest op de bank en contant (geld dat niet in Geld staat, koersverschillen).
 * Heeft een rekening die op de begindag open was geen stand op of vóór die dag, dan is de verandering onbekend: nooit
 * een latere stand of een verzonnen bedrag. Zonder rekeningen staat er geen verandering (er is niets om te vergelijken).
 */
export type NetWorthChange =
  | { state: 'toekomst' | 'geen-rekeningen' | 'geen-koers'; from: string; to: string }
  | { state: 'onbekend'; from: string; to: string; missing: Account[] }
  | {
      state: 'bekend'
      from: string
      to: string
      start: Position
      end: Position
      change: number
      sailing: number
      /** Zeilgeld zonder koers in de periode (niet in het zeilresultaat in euro; zit in overig). */
      sailingOther: Partial<Record<Currency, number>>
      receivable: number
      /** Waardeverandering van beleggingen en bezittingen. */
      value: number
      /** Verandering van de schulden (positief = minder schuld). */
      debts: number
      other: number
      accounts: AccountChange[]
    }

const cents = (n: number) => Math.round(n * 100)

export function netWorthChange(input: PositionInput, period: Period, today: string): NetWorthChange {
  const from = period.from
  const to = period.to < today ? period.to : today
  if (from >= today) return { state: 'toekomst', from, to }
  const live = input.accounts.filter((a) => a.deletedAt === null)
  if (live.length === 0) return { state: 'geen-rekeningen', from, to }
  const missing = live.filter((a) => !(a.closedAt && a.closedAt <= from) && !balanceOn(input.balances, a.id, from)).sort((a, b) => a.name.localeCompare(b.name))
  if (missing.length > 0) return { state: 'onbekend', from, to, missing }
  const start = positionAt(input, from)
  const end = positionAt(input, to)
  if (Object.keys(start.totals.net.other).length > 0 || Object.keys(end.totals.net.other).length > 0) return { state: 'geen-koers', from, to }
  const change = cents(end.totals.net.eur) - cents(start.totals.net.eur)
  const receivable = cents(end.totals.receivable.eur) - cents(start.totals.receivable.eur)
  const sailingTotals = totals(transactionList(input.transactions, { from: addDays(from, 1), to }))
  const sailing = cents(sailingTotals.balanceEur)
  const sailingOther: Partial<Record<Currency, number>> = {}
  for (const [c, v] of Object.entries(sailingTotals.other)) sailingOther[c as Currency] = round2(v.income - v.costs)
  const rows = (p: Position) => [...p.bank, ...p.cashAccounts, ...p.investments, ...p.assets, ...p.debts]
  const startRows = new Map(rows(start).map((r) => [r.account.id, r]))
  const endRows = new Map(rows(end).map((r) => [r.account.id, r]))
  const accounts: AccountChange[] = []
  for (const account of live) {
    const s = startRows.get(account.id)?.balance ? startRows.get(account.id)! : null
    const e = endRows.get(account.id)?.balance ? endRows.get(account.id)! : null
    if (!s && !e) continue
    accounts.push({ account, start: s, end: e, eur: round2((cents(e?.eur?.eur ?? 0) - cents(s?.eur?.eur ?? 0)) / 100) })
  }
  accounts.sort((a, b) => a.account.name.localeCompare(b.account.name))
  const sumOf = (keys: readonly PositionGroupKey[]) => accounts.filter((a) => keys.includes(GROUP[a.account.kind] ?? 'bank')).reduce((n, a) => n + cents(a.eur), 0)
  const value = sumOf(['investments', 'assets'])
  const debts = sumOf(['debts'])
  return {
    state: 'bekend',
    from,
    to,
    start,
    end,
    change: change / 100,
    sailing: sailing / 100,
    sailingOther,
    receivable: receivable / 100,
    value: value / 100,
    debts: debts / 100,
    other: (change - receivable - sailing - value - debts) / 100,
    accounts,
  }
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
  /** jjjj-mm-dd: het uitbetaalmoment (salaris), het einde van de trip (fooi), het einde van de maand (kosten) of van het deel van een scenarioblok. */
  date: string
  /** Kosten (vaste lasten, variabele kosten, kosten van een scenarioblok) staan als negatief bedrag. */
  kind: 'salaris' | 'fooi' | 'vaste-lasten' | 'kosten' | 'scenario' | 'scenario-kosten'
  org?: Organisation
  trips: Trip[]
  /** Bij salaris: het verwachte salaris (de transactie) en wanneer het waarschijnlijk wordt uitbetaald. */
  tx?: Transaction
  payout?: string
  /** Bij een scenario: het blok en de maand. */
  part?: ScenarioPart
  eur: number
}

export interface ForecastMonth {
  /** jjjj-mm */
  month: string
  /** Alleen bij het eindpunt binnen de lopende maand: de einddatum (jjjj-mm-dd). */
  date?: string
  /** Netto waarde aan het einde van de maand (de lopende maand: vandaag); verleden gemeten, toekomst verwacht. */
  eur: number | null
  future: boolean
}

/**
 * De som van de vooruitblik, zichtbaar en sluitend (in centen): netto waarde vandaag + salaris + geschatte fooien +
 * scenario-inkomen − kosten = netto waarde op de einddatum.
 */
export interface ForecastLines {
  start: number
  salary: number
  tips: number
  scenario: number
  /** Negatief: vaste lasten, variabele kosten en de kosten van scenarioblokken. */
  costs: number
  end: number
}

export interface Forecast {
  now: Sum
  /** Verwacht salaris per uitbetaalmoment en de geschatte fooi per trip, in de tijd. */
  items: ForecastItem[]
  /** jjjj-mm van de laatste maand van de planning. */
  until: string
  /** Netto waarde aan het einde van de planning (null zonder koers voor alles van nu). */
  endEur: number | null
  /** Wat de planning toevoegt: salaris plus geschatte fooi plus scenario-inkomen, min kosten. */
  addsEur: number
  /** Daarvan geschatte fooi. */
  tipEstimateEur: number
  /** Daarvan kosten (vaste lasten en variabele kosten, negatief). */
  costsEur: number
  /** Een dagsoort zonder eigen gemiddelde of standaardbedrag: de variabele kosten zijn dan te laag. */
  costsUnknown: boolean
  /** Verwacht salaris (of scenario-inkomen) zonder koers, per valuta (niet meegeteld). */
  other: Partial<Record<Currency, number>>
  months: ForecastMonth[]
  /** De som regel voor regel; null als de netto waarde van vandaag niet in euro te zeggen is, of de periode al voorbij is. */
  lines: ForecastLines | null
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

export interface CostInput {
  fixed: readonly FixedCost[]
  averages: Record<CostDayType, DayAverage>
  index: CalendarIndex
}

/**
 * Vooruitblik tot het einde van de planning (de laatste trip, of `planningEnd` uit de agenda), of tot en met `range.to`:
 * de netto waarde van vandaag (dezelfde als in Mijn positie), plus het verwachte salaris van tochten die nog niet voorbij
 * zijn (op het uitbetaalmoment, één regel per salaris), een geschatte fooi per komende trip (eigen gemiddelde van de
 * organisatie, min wat er die trip al binnenkwam), het inkomen van een scenario (`scenario`: blokken ná de planning) en de
 * kosten (vaste lasten naar rato, per dag het gemiddelde van de dagsoort, of de kosten van een scenarioblok). Salaris van
 * voorbije trips staat al in "te ontvangen" en telt dus niet nog eens. Alles tot en met de einddatum, niets daarna.
 */
export function forecast(
  input: PositionInput,
  settings: Settings,
  today: string,
  planningEnd: string | null = null,
  history = 6,
  costs: CostInput | null = null,
  range: Period | null = null,
  scenario: readonly BlockRange[] | null = null,
): Forecast {
  const { trips, legs, transactions, rates } = input
  const now = positionAt(input, today).totals.net
  const items: ForecastItem[] = []
  const other: Partial<Record<Currency, number>> = {}
  let until = monthOf(today)
  const scenarioLast = scenario && scenario.length > 0 ? scenario.at(-1)!.to : null
  if (range) {
    if (monthOf(range.to) > until) until = monthOf(range.to)
  } else {
    if (planningEnd && monthOf(planningEnd) > until) until = monthOf(planningEnd)
    if (scenarioLast && monthOf(scenarioLast) > until) until = monthOf(scenarioLast)
  }
  // Binnen de gekozen periode: alleen wat er tot en met `to` binnenkomt of afgaat.
  const inRange = (date: string) => !range || date <= range.to
  const averages = tipAverages(trips, legs, transactions, today)
  // Alles in de vooruitblik valt na vandaag: wat vandaag al telt, zit in de netto waarde van vandaag.
  const tomorrow = addDays(today, 1)
  for (const trip of active(trips)) {
    const end = tripEnd(trip, legs)
    // Voorbij zoals overal (een tocht die de dagen volgt pas drie dagen na de laatste dag): daarna staat het salaris in
    // "te ontvangen", daarvóór in de vooruitblik; nooit in geen van beide.
    if (!end || endedFor(trip, end) < today) continue
    if (!range && monthOf(end) > until) until = monthOf(end)
    // Het salaris telt vanaf het einde van de tocht (daarna is het te ontvangen, zoals in positionAt), niet pas bij de
    // uitbetaling: die verandert de netto waarde niet en staat er alleen ter informatie bij. Nooit op vandaag of eerder.
    const counts = end > today ? end : tomorrow
    for (const s of active(transactions)) {
      if (s.kind !== 'loon' || s.tripId !== trip.id || salaryStatus(s) !== 'verwacht' || !(s.amount > 0)) continue
      if (!inRange(counts)) continue
      if (!range && monthOf(counts) > until) until = monthOf(counts)
      const eur = eurValue({ ...s, date: end }, rates)?.eur ?? null
      if (eur === null) other[s.currency] = round2((other[s.currency] ?? 0) + s.amount)
      else items.push({ date: counts, kind: 'salaris', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], tx: s, payout: payoutMoment(trip, legs, settings) ?? end, eur })
    }
    const avg = trip.organisation ? averages[trip.organisation] : undefined
    const tipDate = end > today ? end : tomorrow
    if (avg !== undefined && inRange(tipDate)) {
      const already = booked(transactions)
        .filter((tx) => tx.kind === 'fooi' && tx.tripId === trip.id)
        .reduce((n, tx) => n + (eurOf(tx) ?? 0), 0)
      const estimate = round2(Math.max(0, avg - already))
      if (estimate > 0) items.push({ date: tipDate, kind: 'fooi', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], eur: estimate })
    }
  }
  // Het scenario: per blok en per maand het inkomen (en de eigen kosten van het blok), tot en met de einddatum.
  const endDate = range ? range.to : monthLast(until)
  if (scenario) {
    for (const part of scenarioParts(scenario, endDate, rates, today)) {
      if (part.incomeEur === null) other[part.range.block.currency] = round2((other[part.range.block.currency] ?? 0) + part.income)
      else if (part.incomeEur > 0) items.push({ date: part.date, kind: 'scenario', trips: [], part, eur: part.incomeEur })
      if (part.costs !== null && part.costs > 0) {
        if (part.costsEur === null) other[part.range.block.currency] = round2((other[part.range.block.currency] ?? 0) - part.costs)
        else items.push({ date: part.date, kind: 'scenario-kosten', trips: [], part, eur: -part.costsEur })
      }
    }
  }
  // Kosten tot en met de einddatum: per maand de vaste lasten en de variabele kosten (negatief); dagen in een scenarioblok
  // met eigen kosten tellen niet mee in de variabele kosten.
  let costsUnknown = false
  if (costs) {
    const own = scenario ? (date: string) => ownCostsOn(scenario, date) : undefined
    for (const m of expectedCosts(costs.fixed, costs.averages, costs.index, today, until, rates, endDate, own)) {
      const last = monthLast(m.month) > endDate ? endDate : monthLast(m.month)
      if (m.fixedEur > 0) items.push({ date: last, kind: 'vaste-lasten', trips: [], eur: -m.fixedEur })
      // Vaste lasten zonder koers: niet in de som in euro, wel apart erbij (nooit stil weggelaten).
      for (const [c, v] of Object.entries(m.fixedOther ?? {}) as [Currency, number][]) other[c] = round2((other[c] ?? 0) - v)
      if (m.variableEur > 0) items.push({ date: last, kind: 'kosten', trips: [], eur: -m.variableEur })
      costsUnknown ||= m.unknown
    }
  }
  const order = { salaris: 0, fooi: 1, scenario: 2, 'vaste-lasten': 3, kosten: 4, 'scenario-kosten': 5 }
  items.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind])
  const sum = (kinds: readonly ForecastItem['kind'][]) => items.filter((i) => kinds.includes(i.kind)).reduce((n, i) => n + cents(i.eur), 0)
  const salary = sum(['salaris'])
  const tips = sum(['fooi'])
  const scenarioIncome = sum(['scenario'])
  const costTotal = sum(['vaste-lasten', 'kosten', 'scenario-kosten'])
  const addsCents = salary + tips + scenarioIncome + costTotal
  const addsEur = addsCents / 100
  const nowKnown = Object.keys(now.other).length === 0
  const months: ForecastMonth[] = []
  const current = monthOf(today)
  // Gemeten maanden: de laatste `history`, of vanaf de maand van `from` (hoogstens vijf jaar terug).
  if (range) history = Math.min(60, monthsBetween(monthOf(range.from), current) + 1)
  for (let i = history - 1; i >= 1; i--) {
    const month = shiftMonth(current, -i)
    const p = positionAt(input, range && range.to < monthLast(month) ? range.to : monthLast(month))
    const known = p.counted > 0 || p.receivable.length > 0 || p.claims.length > 0
    months.push({ month, eur: known && Object.keys(p.totals.net.other).length === 0 ? p.totals.net.eur : null, future: false })
  }
  months.push({ month: current, eur: nowKnown ? now.eur : null, future: false })
  // Een periode die al voorbij is: niets verwachts, alleen gemeten tot en met `to`.
  if (range && range.to < today) {
    const past = months.filter((m) => m.month <= monthOf(range.to))
    const end = positionAt(input, range.to).totals.net
    return { now, items: [], until: monthOf(range.to), endEur: Object.keys(end.other).length === 0 ? end.eur : null, addsEur: 0, tipEstimateEur: 0, costsEur: 0, costsUnknown: false, other, months: past, lines: null }
  }
  // Eindigt de vooruitblik nog deze maand, dan een eindpunt op de einddatum (zo is het laatste punt altijd het einde).
  if (monthOf(endDate) === current && endDate > today) {
    const added = items.reduce((n, i) => n + cents(i.eur), 0)
    months.push({ month: current, date: endDate, eur: nowKnown ? (cents(now.eur) + added) / 100 : null, future: true })
  }
  for (let month = shiftMonth(current, 1); month <= until; month = shiftMonth(month, 1)) {
    const by = monthLast(month) > endDate ? endDate : monthLast(month)
    const added = items.filter((i) => i.date <= by).reduce((n, i) => n + cents(i.eur), 0)
    months.push({ month, eur: nowKnown ? (cents(now.eur) + added) / 100 : null, future: true })
  }
  // De lopende maand: wat er nog deze maand binnenkomt, telt pas in de verwachte lijn; het punt van nu is gemeten.
  const start = cents(now.eur)
  const lines: ForecastLines | null = nowKnown ? { start: start / 100, salary: salary / 100, tips: tips / 100, scenario: scenarioIncome / 100, costs: costTotal / 100, end: (start + addsCents) / 100 } : null
  return { now, items, until, endEur: lines ? lines.end : null, addsEur, tipEstimateEur: tips / 100, costsEur: costTotal / 100, costsUnknown, other, months, lines }
}
