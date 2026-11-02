import type { Tx } from '../domain/tx'
import { booked, expectedSalaries, salaryIncomeId, salaryOf, salaryStatus } from '../domain/geldmodel'
import { active } from './derive'
import { eurOf } from './money'
import { eurValue, finalRateFields, getRates, type RatesFile } from './rates'
import { currentSettings, saveSettings } from './settings'
import { keepUnknownFields, type Currency, type Leg, type Organisation, type SalaryDefault, type SalaryStatus, type Settings, type Transaction, type Trip } from './types'
import { weekView } from './weeks'
import { endedFor } from './trip-dates'
import { round2 } from '../basis/bedrag'
import { sourceForPeriod } from '../basis/organisatie'

// Salaris per tocht (Olivier wordt per tocht betaald): precies één transactie van soort loon bij de tocht, met een status
// (src/domain/geldmodel.ts). Het standaardbedrag per organisatie is een instelling: het vult het bedrag van een nieuwe
// tocht die nog niet voorbij is ("Standaardbedrag gebruiken" vult alleen het bedrag in). "Ontvangen" kan alleen met een
// bedrag. Een tweede salaris bij dezelfde tocht maakt de app nooit: opslaan werkt het bestaande bij.

/** Standaardbedrag van een organisatie uit Instellingen, of null. */
export function salaryDefault(settings: Settings, org: Organisation | undefined): SalaryDefault | null {
  if (!org) return null
  const d = settings.salaryDefaults?.[org]
  return d && d.amount > 0 ? d : null
}

/** Einddatum van een tocht (opgeslagen, anders uit de dagen); leeg als de tocht geen datums heeft. */
export function tripEnd(trip: Trip, legs: readonly Leg[]): string {
  return weekView(trip, legs).endDate
}

/** Nog niet voorbij: de einddatum is vandaag of later. Tochten zonder datums tellen niet mee. */
function notEnded(trip: Trip, legs: readonly Leg[], today: string): boolean {
  const end = tripEnd(trip, legs)
  return !!end && end >= today
}

/** Datum van een verwacht salaris: het einde van de tocht, anders vandaag. */
function expectedDate(trip: Trip, legs: readonly Leg[], today: string): string {
  return tripEnd(trip, legs) || today
}

/** Velden van een loon-transactie die deze versie beheert (de rest blijft staan, `keepUnknownFields`). */
const SALARY_FIELDS = ['id', 'date', 'kind', 'amount', 'currency', 'amountEur', 'rate', 'rateDate', 'receivedEur', 'source', 'tripId', 'season', 'status', 'askAfter', 'updatedAt', 'deletedAt'] as const

export interface SalaryInput {
  amount: number
  currency: Currency
  status: SalaryStatus
  /** jjjj-mm-dd; ontbreekt = de datum die er al stond, anders bij ontvangen vandaag en anders het einde van de tocht. */
  date?: string
  payoutId?: string
  /** Koersen voor een ontvangen salaris in een andere valuta (standaard het geladen koersbestand). */
  rates?: RatesFile | null
}

/**
 * Het salaris van een tocht zetten of wijzigen: het bestaande salaris bijwerken, anders één nieuw (vast id). Bij "geen
 * salaris" is het bedrag 0; "ontvangen" kan alleen met een bedrag. Een ontvangen salaris krijgt de koers van zijn datum
 * zodra die definitief is; een verwacht salaris nooit (dat is nog geen geld).
 */
export async function saveSalary(tx: Tx, tripId: string, input: SalaryInput): Promise<Transaction> {
  const trip = tx.list('trips.json.enc').find((x) => x.id === tripId)
  if (!trip) throw new Error('trip ontbreekt')
  const all = tx.list('transactions.json.enc')
  const current = salaryOf(tripId, all)
  const amount = input.status === 'geen' ? 0 : round2(Math.max(0, input.amount))
  if (input.status === 'ontvangen' && !(amount > 0)) throw new Error('ontvangen zonder bedrag')
  const today = tx.now.slice(0, 10)
  const date = input.date ?? (current && salaryStatus(current) === input.status ? current.date : input.status === 'ontvangen' ? today : expectedDate(trip, tx.list('legs.json.enc'), today))
  const same = current && current.amount === amount && current.currency === input.currency && current.date === date
  const record: Transaction = keepUnknownFields(current, {
    id: current?.id ?? salaryIncomeId(tripId, all),
    date,
    kind: 'loon',
    amount,
    currency: input.currency,
    source: sourceForPeriod(trip),
    tripId,
    status: input.status,
    ...(input.status === 'verwacht' && current?.askAfter && same ? { askAfter: current.askAfter } : {}),
    ...(input.payoutId ? { payoutId: input.payoutId } : current?.payoutId && same ? { payoutId: current.payoutId } : {}),
    // Het werkelijk ontvangen eurobedrag blijft alleen bij hetzelfde bedrag in dezelfde valuta.
    ...(input.status === 'ontvangen' && current?.receivedEur !== undefined && same ? { receivedEur: current.receivedEur } : {}),
    ...(input.status === 'ontvangen' ? (input.currency === 'EUR' ? { amountEur: amount } : (finalRateFields({ date, amount, currency: input.currency }, input.rates === undefined ? getRates() : input.rates) ?? {})) : {}),
    updatedAt: tx.now,
    deletedAt: null,
  }, [...SALARY_FIELDS, 'payoutId'])
  await tx.put('transactions.json.enc', record)
  return record
}

/**
 * "Salaris ontvangen?" → Ja (of een ander bedrag): het salaris van de tocht op ontvangen, met vandaag als datum. Een
 * tweede tik of een ander apparaat dat het al ontving: niets. Zonder bedrag kan het niet (dan eerst het bedrag invullen).
 */
export async function receiveSalary(tx: Tx, tripId: string, today: string, actual?: { amount: number; currency: Currency }): Promise<void> {
  const current = salaryOf(tripId, tx.list('transactions.json.enc'))
  if (!current || salaryStatus(current) === 'ontvangen') return
  await saveSalary(tx, tripId, { amount: actual?.amount ?? current.amount, currency: actual?.currency ?? current.currency, status: 'ontvangen', date: today })
}

/** "Geen salaris" voor deze tocht: bedrag 0, telt nergens mee; Vandaag vraagt er niet meer naar. Niet bij ontvangen. */
export async function setNoSalary(tx: Tx, tripId: string): Promise<void> {
  const current = salaryOf(tripId, tx.list('transactions.json.enc'))
  if (current && salaryStatus(current) !== 'verwacht') return
  await saveSalary(tx, tripId, { amount: 0, currency: current?.currency ?? 'EUR', status: 'geen' })
}

/** "Nog niet": een week later opnieuw vragen. */
export async function askSalaryLater(tx: Tx, tripId: string, today: string, days = 7): Promise<void> {
  const current = salaryOf(tripId, tx.list('transactions.json.enc'))
  if (!current || salaryStatus(current) !== 'verwacht') return
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  await tx.put('transactions.json.enc', { ...current, askAfter: d.toISOString().slice(0, 10), updatedAt: tx.now })
}

/**
 * Een nieuwe tocht, of een tocht met een andere organisatie: het standaardbedrag als verwacht salaris, alleen als de tocht
 * nog niet voorbij is en nog geen salaris heeft. Had hij het standaardbedrag van zijn vorige organisatie (verwacht), dan
 * het nieuwe standaardbedrag (zonder standaard bij de nieuwe organisatie: geen verwacht salaris meer). Een ander bedrag, een ontvangen salaris of "geen salaris" blijft altijd staan.
 */
export async function applySalaryDefault(tx: Tx, trip: Trip, previousOrg: Organisation | undefined | null, today: string): Promise<void> {
  const legs = tx.list('legs.json.enc')
  if (!notEnded(trip, legs, today)) return
  const settings = currentSettings(tx.list('settings.json.enc'))
  const d = salaryDefault(settings, trip.organisation)
  const current = salaryOf(trip.id, tx.list('transactions.json.enc'))
  if (!current) {
    if (d) await saveSalary(tx, trip.id, { amount: d.amount, currency: d.currency, status: 'verwacht' })
    return
  }
  if (previousOrg === null || previousOrg === trip.organisation || salaryStatus(current) !== 'verwacht') return
  const old = salaryDefault(settings, previousOrg)
  if (!old || current.amount !== old.amount || current.currency !== old.currency) return
  // Het standaardbedrag van de vorige organisatie: dat van de nieuwe, of (zonder standaard) geen verwacht salaris meer.
  if (d) await saveSalary(tx, trip.id, { amount: d.amount, currency: d.currency, status: 'verwacht' })
  else await tx.put('transactions.json.enc', { ...current, updatedAt: tx.now, deletedAt: tx.now })
}

/** Tochten van de organisatie zonder salaris die nog niet voorbij zijn: die krijgen een nieuw standaardbedrag. */
export function tripsWithoutSalary(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], org: Organisation, today: string): Trip[] {
  return active(trips).filter((x) => x.organisation === org && !salaryOf(x.id, transactions) && notEnded(x, legs, today))
}

/**
 * Standaardbedragen opslaan (een instelling). Tochten van die organisatie zonder salaris die nog niet voorbij zijn,
 * krijgen het nieuwe bedrag als verwacht salaris; een salaris dat er al staat, verandert niet.
 */
export async function saveSalaryDefaults(tx: Tx, next: Partial<Record<Organisation, SalaryDefault>>, today: string): Promise<number> {
  const clean: Partial<Record<Organisation, SalaryDefault>> = {}
  for (const [org, d] of Object.entries(next) as [Organisation, SalaryDefault | undefined][]) if (d && d.amount > 0) clean[org] = { amount: round2(d.amount), currency: d.currency }
  await saveSettings(tx, { salaryDefaults: clean })
  const trips = tx.list('trips.json.enc')
  const legs = tx.list('legs.json.enc')
  let n = 0
  for (const [org, d] of Object.entries(clean) as [Organisation, SalaryDefault][]) {
    for (const trip of tripsWithoutSalary(trips, legs, tx.list('transactions.json.enc'), org, today)) {
      await saveSalary(tx, trip.id, { amount: d.amount, currency: d.currency, status: 'verwacht' })
      n++
    }
  }
  return n
}

/** Tochten waarvan Vandaag vraagt of het salaris binnen is: verwacht, met een bedrag, de tocht voorbij. */
export function salaryQuestions(trips: readonly Trip[], legs: readonly Leg[], today: string, transactions: readonly Transaction[]): { trip: Trip; salary: Transaction }[] {
  const out: { trip: Trip; salary: Transaction; end: string }[] = []
  for (const trip of active(trips)) {
    const salary = salaryOf(trip.id, transactions)
    if (!salary || salaryStatus(salary) !== 'verwacht' || !(salary.amount > 0)) continue
    const end = tripEnd(trip, legs)
    // Een tocht die de dagen volgt, is pas drie dagen na de laatste dag voorbij (hij kan nog doorlopen).
    if (end && endedFor(trip, end) < today && (!salary.askAfter || salary.askAfter <= today)) out.push({ trip, salary, end })
  }
  return out.sort((a, b) => a.end.localeCompare(b.end)).map(({ trip, salary }) => ({ trip, salary }))
}

export interface OutlookMonth {
  /** jjjj-mm */
  month: string
  /** Verwacht salaris (nog niet ontvangen), op de maand van de einddatum van de tocht. */
  expectedEur: number
  /** Ontvangen salaris (loon), op de maand van ontvangst. */
  receivedEur: number
  /** Geschatte fooi (gemiddelde per tocht van de organisatie); alleen een schatting, apart van het salaris. */
  tipEstimateEur: number
  /** Tochten die in deze maand eindigen met een verwacht salaris. */
  trips: Trip[]
}

export interface Outlook {
  months: OutlookMonth[]
  /** Totaal verwacht tot en met de laatste maand van de planning. */
  expectedEur: number
  tipEstimateEur: number
  /** jjjj-mm van de laatste maand (einde van de planning). */
  until: string
  /** Bedragen zonder koers, per valuta (nooit met een verzonnen koers omgerekend). */
  other: Partial<Record<Currency, number>>
  /** Gemiddelde fooi per tocht per organisatie (uit afgelopen tochten met fooi). */
  tipAverages: Partial<Record<Organisation, number>>
}

const month = (iso: string) => iso.slice(0, 7)

function nextMonth(m: string): string {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`
}

/** Gemiddelde fooi per tocht per organisatie, over afgelopen tochten met minstens één fooi. */
export function tipAverages(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], today: string): Partial<Record<Organisation, number>> {
  const tipsByTrip = new Map<string, number>()
  for (const tx of booked(transactions)) {
    if (tx.kind !== 'fooi' || !tx.tripId) continue
    const eur = eurOf(tx)
    if (eur === null) continue
    tipsByTrip.set(tx.tripId, (tipsByTrip.get(tx.tripId) ?? 0) + eur)
  }
  const sums = new Map<Organisation, { total: number; n: number }>()
  for (const x of active(trips)) {
    const tip = tipsByTrip.get(x.id)
    if (!x.organisation || tip === undefined) continue
    const end = tripEnd(x, legs)
    if (!end || end >= today) continue
    const s = sums.get(x.organisation) ?? { total: 0, n: 0 }
    s.total += tip
    s.n++
    sums.set(x.organisation, s)
  }
  const out: Partial<Record<Organisation, number>> = {}
  for (const [org, s] of sums) out[org] = round2(s.total / s.n)
  return out
}

/**
 * Vooruitblik: per maand het verwachte en het ontvangen salaris, van de vroegste maand met een verwacht salaris (of deze
 * maand) tot en met de maand waarin de laatste tocht van de planning eindigt. Met een geschatte fooi per komende tocht,
 * apart gehouden van het salaris.
 */
export function salaryOutlook(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], today: string, rates: RatesFile | null = getRates()): Outlook {
  const live = active(trips)
  const byId = new Map(live.map((x) => [x.id, x]))
  const averages = tipAverages(live, legs, transactions, today)
  const other: Partial<Record<Currency, number>> = {}
  // Alleen het salaris van tochten die er nog zijn (zoals Mijn positie en de vooruitblik).
  const expected = expectedSalaries(transactions)
    .filter((tx) => tx.amount > 0 && (!tx.tripId || byId.has(tx.tripId)))
    .map((tx) => {
      const trip = tx.tripId ? byId.get(tx.tripId) : undefined
      return { tx, trip, end: (trip ? tripEnd(trip, legs) : '') || tx.date }
    })
  const upcoming = live.map((x) => ({ trip: x, end: tripEnd(x, legs) })).filter((e) => e.end && e.end >= today)
  let first = month(today)
  for (const e of expected) if (month(e.end) < first) first = month(e.end)
  let last = month(today)
  for (const e of [...expected, ...upcoming]) if (month(e.end) > last) last = month(e.end)
  const months: OutlookMonth[] = []
  for (let m = first; m <= last; m = nextMonth(m)) months.push({ month: m, expectedEur: 0, receivedEur: 0, tipEstimateEur: 0, trips: [] })
  const at = (m: string) => months.find((x) => x.month === m)
  for (const e of expected) {
    const row = at(month(e.end))
    if (!row) continue
    const eur = eurValue({ ...e.tx, date: e.end }, rates)?.eur ?? null
    if (eur === null) other[e.tx.currency] = round2((other[e.tx.currency] ?? 0) + e.tx.amount)
    else row.expectedEur = round2(row.expectedEur + eur)
    if (e.trip) row.trips.push(e.trip)
  }
  for (const tx of booked(transactions)) {
    if (tx.kind !== 'loon') continue
    const row = at(month(tx.date))
    if (!row) continue
    const eur = eurValue(tx, rates)?.eur ?? null
    if (eur === null) other[tx.currency] = round2((other[tx.currency] ?? 0) + tx.amount)
    else row.receivedEur = round2(row.receivedEur + eur)
  }
  for (const e of upcoming) {
    const avg = e.trip.organisation ? averages[e.trip.organisation] : undefined
    const row = at(month(e.end))
    if (avg === undefined || !row) continue
    row.tipEstimateEur = round2(row.tipEstimateEur + avg)
  }
  return {
    months,
    expectedEur: round2(months.reduce((n, m) => n + m.expectedEur, 0)),
    tipEstimateEur: round2(months.reduce((n, m) => n + m.tipEstimateEur, 0)),
    until: last,
    other,
    tipAverages: averages,
  }
}
