import { balanceOn } from './accounts'
import type { CalendarIndex } from './calendar'
import { expectedCosts, type DayAverage } from './costs'
import { monthlyRate, ownCostsOn, scenarioParts, type ScenarioPart, type ScenarioPlan } from './scenario'
import { active } from './derive'
import { eurOf, totals } from './money'
import { booked } from '../domain/geldmodel'
import { payoutRule } from './money-path'
import { eurValue, toEur, type EurAmount, type RatesFile } from './rates'
import { expectedTip, tipAverages, tripEnd } from './salary'
import { salaryStatus } from '../domain/geldmodel'
import type { Account, AccountKind, Balance, Claim, CostDayType, Currency, FixedCost, Leg, Organisation, ScenarioOneOff, Settings, Transaction, Trip } from './types'
import { endedFor } from './trip-dates'
import { isDebt, paymentIdOf } from './claims'
import { round2 } from '../basis/bedrag'
import { addDays, dayCount, daysInMonth, monthEnd, monthOf, monthsBetween, shiftMonth } from '../basis/datum'
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
  addValue(sum, toEur(amount, currency, date, rates), amount, currency)
}

/** Een bedrag optellen dat al (of niet) in euro is omgerekend; zonder koers apart per valuta. */
function addValue(sum: Sum, eur: EurAmount | null, amount: number, currency: Currency): void {
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
  /** Declaraties en voorschotten met een bedrag die op die dag nog niet terugbetaald waren (open of ingediend). */
  claims: Claim[]
  /** Schulden (iemand schoot voor Olivier voor) die op die dag nog niet betaald waren: tellen negatief bij te ontvangen. */
  owed: Claim[]
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
    owed: [],
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
    // Dezelfde waardering als op de tripkaart en in de vooruitblik (src/model/rates.ts, eurValue): het werkelijk ontvangen
    // bedrag, anders de opgeslagen koers, anders de koers van de datum van het salaris; nooit de koers van de kijkdag.
    addValue(out.totals.receivable, receivableValue(tx, rates), tx.amount, tx.currency)
  }
  out.receivable.sort((a, b) => tripEnd(a.trip, legs).localeCompare(tripEnd(b.trip, legs)))
  // Declaraties: met een bedrag, op die dag al gedaan en nog niet terugbetaald.
  for (const c of active(input.claims ?? [])) {
    if (c.status === 'terugbetaald' && !c.repaid) continue
    if (c.amount === undefined || c.currency === undefined || c.amount <= 0 || c.date > date) continue
    if (c.repaid && c.repaid.date <= date) continue
    // Een schuld: te betalen tot de dag van betalen (de betaling is dan een uitgave en staat in de stand van de bank).
    if (isDebt(c)) {
      if (booked(transactions).some((tx) => tx.id === paymentIdOf(c.id) && tx.date <= date)) continue
      out.owed.push(c)
      add(out.totals.receivable, -c.amount, c.currency, c.date, rates)
      continue
    }
    // De terugbetaling staat er al (ook als de declaratie zelf nog niet op terugbetaald staat): niet meer te ontvangen.
    if (booked(transactions).some((tx) => tx.kind === 'terugbetaling' && tx.claimId === c.id && tx.date <= date)) continue
    out.claims.push(c)
    // Zoals de uitgave van de declaratie: de koers van de dag van de declaratie.
    add(out.totals.receivable, c.amount, c.currency, c.date, rates)
  }
  for (const key of ['bank', 'cash', 'receivable', 'investments', 'assets', 'debts'] as const) addSum(out.totals.net, out.totals[key])
  return out
}

/** De eurowaarde van een te ontvangen salaris: dezelfde als overal (`eurValue`), zodat Mijn positie, de tripkaart en de vooruitblik hetzelfde getal tonen. */
export function receivableValue(tx: Transaction, rates: RatesFile | null): EurAmount | null {
  const v = eurValue(tx, rates)
  return v ? { eur: v.eur, provisional: v.provisional } : null
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
 * - zeilresultaat: het echte geld in Geld (inkomsten en terugbetalingen min uitgaven) van de begindag tot en met het
 *   einde: precies "Zeilgeld: resultaat" voor dezelfde periode in Geld (wat op de begindag binnenkwam en al in een stand
 *   van die dag zit, komt in "overig" weer terug);
 * - te ontvangen: de verandering in wat nog te ontvangen is (salaris van voorbije tochten, declaraties);
 * - waardeverandering: beleggingen en bezittingen (koers, huizenprijs: geld dat niet in Geld staat);
 * - schulden: wat er van een lening of studieschuld af ging (of bij kwam);
 * - overig: de rest op de bank en contant (geld dat niet in Geld staat, koersverschillen).
 * Heeft een rekening die op de begindag open was geen stand op of vóór die dag, dan is de verandering onbekend: nooit
 * een latere stand of een verzonnen bedrag. Zonder rekeningen staat er geen verandering (er is niets om te vergelijken).
 * Een rekening of bedrag zonder koers laat de verandering niet verdwijnen: het eurodeel wordt gewoon uitgerekend en die
 * valuta staat apart (`unpriced`), zoals Mijn positie zelf doet.
 */
export type NetWorthChange =
  | { state: 'toekomst' | 'geen-rekeningen'; from: string; to: string }
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
      /** Per valuta zonder koers: de stand op het einde min die op de begindag (niet in de euro-getallen). */
      unpriced: Partial<Record<Currency, number>>
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
  // Zonder koers: het eurodeel gaat gewoon door, die valuta staat apart.
  const unpriced: Partial<Record<Currency, number>> = {}
  for (const c of new Set([...Object.keys(start.totals.net.other), ...Object.keys(end.totals.net.other)]) as Set<Currency>) {
    unpriced[c] = round2((end.totals.net.other[c] ?? 0) - (start.totals.net.other[c] ?? 0))
  }
  const change = cents(end.totals.net.eur) - cents(start.totals.net.eur)
  const receivable = cents(end.totals.receivable.eur) - cents(start.totals.receivable.eur)
  // Het zeilresultaat van de begindag tot en met het einde: hetzelfde getal als "Zeilgeld: resultaat" in Geld.
  const sailingTotals = totals(transactionList(input.transactions, { from, to }))
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
    unpriced,
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
  /** Kosten (vaste lasten, variabele kosten, kosten van een scenarioblok, eenmalige uitgaven) staan als negatief bedrag. */
  kind: 'salaris' | 'fooi' | 'vaste-lasten' | 'kosten' | 'scenario' | 'scenario-kosten' | 'eenmalig' | 'groei'
  org?: Organisation
  trips: Trip[]
  /** Bij salaris: het verwachte salaris (de transactie) en wanneer het waarschijnlijk wordt uitbetaald. */
  tx?: Transaction
  payout?: string
  /** Bij een scenario: het blok en de maand. */
  part?: ScenarioPart
  /** Bij een eenmalige uitgave. */
  oneOff?: ScenarioOneOff
  /** Bij waardegroei: de groep, het bedrag waarover gerekend is (euro, na de inleg van die maand) en het percentage van dat deel van de maand. */
  growth?: { group: 'beleggen' | 'bezit' | 'schuld'; month: string; opening: number; rate: number; contribution: number }
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
  /** Negatief: de eenmalige uitgaven van het scenario. */
  oneOffs: number
  /** Waardegroei: groei van beleggingen en bezittingen, min de rente op schulden. */
  growth: number
  end: number
  /** Ter informatie: wat er uit het inkomen belegd is, en de beleggingen op het einde. */
  invested: number
  investmentsEnd: number
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
  /** De som regel voor regel over het eurodeel; null als de periode al voorbij is. */
  lines: ForecastLines | null
  /** Standen van vandaag zonder koers, per valuta (niet in de euro-getallen; apart getoond). */
  unpriced: Partial<Record<Currency, number>>
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
  scenario: ScenarioPlan | null = null,
): Forecast {
  const { trips, legs, transactions, rates } = input
  const position = positionAt(input, today)
  const now = position.totals.net
  const items: ForecastItem[] = []
  const other: Partial<Record<Currency, number>> = {}
  let until = monthOf(today)
  const scenarioLast = scenario?.end ?? null
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
      // Dezelfde waarde als de tripkaart en Mijn positie: de datum van het salaris zelf, niet het tripeinde van nu.
      const eur = eurValue(s, rates)?.eur ?? null
      if (eur === null) other[s.currency] = round2((other[s.currency] ?? 0) + s.amount)
      else items.push({ date: counts, kind: 'salaris', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], tx: s, payout: payoutMoment(trip, legs, settings) ?? end, eur })
    }
    const tipDate = end > today ? end : tomorrow
    // De verwachte fooi: per trip ingevuld, anders de standaard van de organisatie, anders het eigen gemiddelde.
    const tip = expectedTip(trip, averages, settings, end, rates)
    if (tip !== undefined && inRange(tipDate)) {
      const already = booked(transactions)
        .filter((tx) => tx.kind === 'fooi' && tx.tripId === trip.id)
        .reduce((n, tx) => n + (eurOf(tx) ?? 0), 0)
      const estimate = round2(Math.max(0, tip.eur - already))
      if (estimate > 0) items.push({ date: tipDate, kind: 'fooi', ...(trip.organisation ? { org: trip.organisation } : {}), trips: [trip], eur: estimate })
    }
  }
  // Het scenario: per blok en per maand het inkomen (en de eigen kosten van het blok), tot en met de einddatum.
  const endDate = range ? range.to : monthEnd(until)
  // Het scenario stopt bij zijn horizon ("kijk vooruit tot"), ook als de periode bovenaan later eindigt.
  const scenarioUntil = scenario?.end && scenario.end < endDate ? scenario.end : endDate
  if (scenario) {
    for (const part of scenarioParts(scenario.ranges, scenarioUntil, rates, today)) {
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
    const own = scenario ? (date: string) => date <= scenarioUntil && ownCostsOn(scenario.ranges, date) : undefined
    for (const m of expectedCosts(costs.fixed, costs.averages, costs.index, today, until, rates, endDate, own)) {
      const last = monthEnd(m.month) > endDate ? endDate : monthEnd(m.month)
      if (m.fixedEur > 0) items.push({ date: last, kind: 'vaste-lasten', trips: [], eur: -m.fixedEur })
      // Vaste lasten zonder koers: niet in de som in euro, wel apart erbij (nooit stil weggelaten).
      for (const [c, v] of Object.entries(m.fixedOther ?? {}) as [Currency, number][]) other[c] = round2((other[c] ?? 0) - v)
      if (m.variableEur > 0) items.push({ date: last, kind: 'kosten', trips: [], eur: -m.variableEur })
      costsUnknown ||= m.unknown
    }
  }
  // Eenmalige uitgaven van het scenario: na vandaag, tot en met de einddatum; zonder koers apart per valuta.
  for (const o of scenario?.oneOffs ?? []) {
    if (o.date <= today || o.date > scenarioUntil) continue
    const eur = toEur(o.amount, o.currency, o.date, rates)
    if (eur) items.push({ date: o.date, kind: 'eenmalig', trips: [], oneOff: o, eur: -eur.eur })
    else other[o.currency] = round2((other[o.currency] ?? 0) - o.amount)
  }
  // Waardegroei per maand: beleggingen (plus het belegde deel van het inkomen van die maand), bezittingen en de rente op
  // schulden, met de maandrente uit het jaarpercentage, naar rato van de dagen van de maand die meetellen (vanaf morgen,
  // tot en met de einddatum). Zonder aannames gebeurt er niets: 0 procent is 0 euro, nooit verzonnen.
  let invested = 0
  let investments = cents(position.totals.investments.eur)
  // Over het eurodeel van de stand van vandaag; een stand zonder koers groeit niet mee (die staat apart).
  if (scenario) {
    const a = scenario.assumptions
    let assets = cents(position.totals.assets.eur)
    let debts = cents(position.totals.debts.eur)
    const rate = { beleggen: monthlyRate(a.investmentGrowthPct), bezit: monthlyRate(a.assetGrowthPct), schuld: monthlyRate(a.debtInterestPct) }
    const firstMonth = monthOf(today)
    for (let month = firstMonth; month <= until; month = shiftMonth(month, 1)) {
      const from = month === firstMonth ? tomorrow : `${month}-01`
      const to = monthEnd(month) > scenarioUntil ? scenarioUntil : monthEnd(month)
      if (from > to) continue
      const frac = dayCount(from, to) / daysInMonth(month)
      const income = items.filter((i) => (i.kind === 'salaris' || i.kind === 'fooi' || i.kind === 'scenario') && i.date >= from && i.date <= to).reduce((n, i) => n + cents(i.eur), 0)
      const contribution = a.investPct > 0 ? Math.round((income * a.investPct) / 100) : 0
      invested += contribution
      investments += contribution
      const grow = (group: 'beleggen' | 'bezit' | 'schuld', opening: number, r: number, c: number): number => {
        const g = Math.round(opening * r * frac)
        if (g !== 0) items.push({ date: to, kind: 'groei', trips: [], growth: { group, month, opening: opening / 100, rate: r * frac, contribution: c / 100 }, eur: g / 100 })
        return g
      }
      investments += grow('beleggen', investments, rate.beleggen, contribution)
      assets += grow('bezit', assets, rate.bezit, 0)
      debts += grow('schuld', debts, rate.schuld, 0)
    }
  }
  const order = { salaris: 0, fooi: 1, scenario: 2, 'vaste-lasten': 3, kosten: 4, 'scenario-kosten': 5, eenmalig: 6, groei: 7 }
  items.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind])
  const sum = (kinds: readonly ForecastItem['kind'][]) => items.filter((i) => kinds.includes(i.kind)).reduce((n, i) => n + cents(i.eur), 0)
  const salary = sum(['salaris'])
  const tips = sum(['fooi'])
  const scenarioIncome = sum(['scenario'])
  const costTotal = sum(['vaste-lasten', 'kosten', 'scenario-kosten'])
  const oneOffs = sum(['eenmalig'])
  const growth = sum(['groei'])
  const addsCents = salary + tips + scenarioIncome + costTotal + oneOffs + growth
  const addsEur = addsCents / 100
  const months: ForecastMonth[] = []
  const current = monthOf(today)
  // Gemeten maanden: de laatste `history`, of vanaf de maand van `from` (hoogstens vijf jaar terug).
  if (range) history = Math.min(60, Math.max(0, monthsBetween(monthOf(range.from), current)) + 1)
  for (let i = history - 1; i >= 1; i--) {
    const month = shiftMonth(current, -i)
    const p = positionAt(input, range && range.to < monthEnd(month) ? range.to : monthEnd(month))
    const known = p.counted > 0 || p.receivable.length > 0 || p.claims.length > 0 || p.owed.length > 0
    months.push({ month, eur: known ? p.totals.net.eur : null, future: false })
  }
  months.push({ month: current, eur: now.eur, future: false })
  // Een periode die al voorbij is: niets verwachts, alleen gemeten tot en met `to`.
  if (range && range.to < today) {
    const past = months.filter((m) => m.month <= monthOf(range.to))
    const end = positionAt(input, range.to).totals.net
    return { now, items: [], until: monthOf(range.to), endEur: end.eur, addsEur: 0, tipEstimateEur: 0, costsEur: 0, costsUnknown: false, other, months: past, lines: null, unpriced: end.other }
  }
  // Eindigt de vooruitblik nog deze maand, dan een eindpunt op de einddatum (zo is het laatste punt altijd het einde).
  if (monthOf(endDate) === current && endDate > today) {
    const added = items.reduce((n, i) => n + cents(i.eur), 0)
    months.push({ month: current, date: endDate, eur: (cents(now.eur) + added) / 100, future: true })
  }
  for (let month = shiftMonth(current, 1); month <= until; month = shiftMonth(month, 1)) {
    const by = monthEnd(month) > endDate ? endDate : monthEnd(month)
    const added = items.filter((i) => i.date <= by).reduce((n, i) => n + cents(i.eur), 0)
    months.push({ month, eur: (cents(now.eur) + added) / 100, future: true })
  }
  // De lopende maand: wat er nog deze maand binnenkomt, telt pas in de verwachte lijn; het punt van nu is gemeten.
  const start = cents(now.eur)
  const lines: ForecastLines = { start: start / 100, salary: salary / 100, tips: tips / 100, scenario: scenarioIncome / 100, costs: costTotal / 100, oneOffs: oneOffs / 100, growth: growth / 100, end: (start + addsCents) / 100, invested: invested / 100, investmentsEnd: investments / 100 }
  return { now, items, until, endEur: lines.end, addsEur, tipEstimateEur: tips / 100, costsEur: costTotal / 100, costsUnknown, other, months, lines, unpriced: now.other }
}
