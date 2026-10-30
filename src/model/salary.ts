import type { Store } from '../storage/store'
import { active } from './derive'
import { eurOf, round2 } from './money'
import { finalRateFields, rateFor, type RatesFile } from './rates'
import { currentSettings, saveSettings } from './settings'
import { type Currency, type Leg, type Organisation, type SalaryDefault, type Settings, type Transaction, type TransactionSource, type Trip, type TripSalary } from './types'
import { weekView } from './weeks'
import type { Undo } from './edit'
import { endedFor } from './trip-dates'

// Salaris per trip (Olivier wordt per trip betaald): bedrag en valuta, verwacht of ontvangen, en of het bedrag het
// standaardbedrag van de organisatie is of een eigen bedrag. Harde regel: een eigen bedrag (zelf ingevuld of aangepast)
// en een ontvangen salaris worden nooit automatisch overschreven. Het standaardbedrag vult alleen een trip zonder
// salaris die nog niet voorbij is; een gewijzigd standaardbedrag gaat pas na "ja" naar trips met het oude bedrag.

/** Standaardbedrag van een organisatie uit Instellingen, of null. */
export function salaryDefault(settings: Settings, org: Organisation | undefined): SalaryDefault | null {
  if (!org) return null
  const d = settings.salaryDefaults?.[org]
  return d && d.amount > 0 ? d : null
}

/**
 * Het salaris dat meetelt (te ontvangen, verwacht, vooruitblik, vragen op Vandaag): niet bij "Geen salaris", niet bij
 * een bedrag van 0, en niet bij een standaardbedrag op een trip zonder organisatie (het standaardbedrag hoort alleen bij
 * trips van die organisatie). Het opgeslagen salaris blijft zoals het is.
 */
export function countedSalary(trip: Trip): TripSalary | null {
  const s = trip.salary
  if (!s || s.status === 'geen' || !(s.amount > 0)) return null
  if (s.source === 'standaard' && s.status === 'verwacht' && !trip.organisation) return null
  return s
}

/** "Geen salaris": zelf gekozen, nooit vanzelf overschreven (eigen). */
export function noSalary(currency: Currency): TripSalary {
  return { amount: 0, currency, status: 'geen', source: 'eigen' }
}

/** Einddatum van een trip (opgeslagen, anders uit de dagen); leeg als de trip geen datums heeft. */
export function tripEnd(trip: Trip, legs: readonly Leg[]): string {
  return weekView(trip, legs).endDate
}

/** Nog niet voorbij: de einddatum is vandaag of later. Trips zonder datums tellen niet mee. */
function notEnded(trip: Trip, legs: readonly Leg[], today: string): boolean {
  const end = tripEnd(trip, legs)
  return !!end && end >= today
}

/** Salaris uit het bewerkscherm: bedrag van 0 of meer op twee decimalen (bij "Geen salaris" 0), alleen bekende velden. */
export function cleanSalary(s: TripSalary): TripSalary {
  return {
    amount: s.status === 'geen' ? 0 : round2(Math.max(0, s.amount)),
    currency: s.currency,
    status: s.status,
    source: s.source,
    ...(s.transactionId ? { transactionId: s.transactionId } : {}),
    ...(s.askAfter ? { askAfter: s.askAfter } : {}),
  }
}

function standard(d: SalaryDefault): TripSalary {
  return { amount: d.amount, currency: d.currency, status: 'verwacht', source: 'standaard' }
}

/**
 * Nieuwe trip of andere organisatie: het standaardbedrag als de trip nog geen salaris heeft, of als hij het
 * standaardbedrag van zijn vorige organisatie had (nog niet ontvangen). Een eigen of ontvangen salaris blijft staan.
 * Een trip die voorbij is (of geen einddatum heeft), krijgt nooit vanzelf een salaris: dat is al betaald of onbekend, en
 * anders telt het als te ontvangen en vraagt Vandaag of het binnen is.
 */
export function withSalaryDefault(trip: Trip, settings: Settings, previous: Trip | undefined, legs: readonly Leg[], today: string): Trip {
  if (!notEnded(trip, legs, today)) return trip
  const d = salaryDefault(settings, trip.organisation)
  const s = trip.salary
  if (!s) return d ? { ...trip, salary: standard(d) } : trip
  const orgChanged = previous !== undefined && previous.organisation !== trip.organisation
  if (!orgChanged || s.source !== 'standaard' || s.status !== 'verwacht') return trip
  if (d) return { ...trip, salary: { ...s, amount: d.amount, currency: d.currency } }
  const { salary: _drop, ...rest } = trip
  void _drop
  return rest
}

/** Trips van de organisatie, nog niet voorbij, met nog het oude standaardbedrag (niet ontvangen, niet eigen). */
export function tripsWithOldDefault(trips: readonly Trip[], legs: readonly Leg[], org: Organisation, old: SalaryDefault, today: string): Trip[] {
  return active(trips).filter(
    (x) =>
      x.organisation === org &&
      x.salary?.source === 'standaard' &&
      x.salary.status === 'verwacht' &&
      x.salary.amount === old.amount &&
      x.salary.currency === old.currency &&
      notEnded(x, legs, today),
  )
}

/** Trips van de organisatie zonder salaris die nog niet voorbij zijn: die krijgen het standaardbedrag vanzelf. */
export function tripsWithoutSalary(trips: readonly Trip[], legs: readonly Leg[], org: Organisation, today: string): Trip[] {
  return active(trips).filter((x) => x.organisation === org && !x.salary && notEnded(x, legs, today))
}

export interface DefaultChange {
  org: Organisation
  old: SalaryDefault | null
  next: SalaryDefault | null
  /** Trips met nog het oude standaardbedrag: alleen na "ja" bijgewerkt. */
  stale: Trip[]
}

/** Wat een nieuw standaardbedrag raakt, per organisatie die verandert. */
export function defaultChanges(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, next: Partial<Record<Organisation, SalaryDefault>>, today: string): DefaultChange[] {
  const orgs = new Set<Organisation>([...Object.keys(settings.salaryDefaults ?? {}), ...Object.keys(next)] as Organisation[])
  const changes: DefaultChange[] = []
  for (const org of orgs) {
    const old = salaryDefault(settings, org)
    const nxt = next[org] && next[org]!.amount > 0 ? next[org]! : null
    if (old?.amount === nxt?.amount && old?.currency === nxt?.currency) continue
    changes.push({ org, old, next: nxt, stale: old && nxt ? tripsWithOldDefault(trips, legs, org, old, today) : [] })
  }
  return changes
}

/**
 * Nieuwe standaardbedragen opslaan. Trips zonder salaris die nog niet voorbij zijn krijgen het nieuwe bedrag; trips
 * met het oude standaardbedrag alleen als `alsoStale` (het antwoord op de vraag). Eigen en ontvangen nooit.
 */
export async function saveSalaryDefaults(store: Store, next: Partial<Record<Organisation, SalaryDefault>>, alsoStale: boolean, today: string): Promise<number> {
  const settings = currentSettings(store.list('settings.json.enc'))
  const trips = store.list('trips.json.enc')
  const legs = store.list('legs.json.enc')
  const changes = defaultChanges(trips, legs, settings, next, today)
  const now = new Date().toISOString()
  const changed: Trip[] = []
  for (const c of changes) {
    if (!c.next) continue
    for (const x of tripsWithoutSalary(trips, legs, c.org, today)) changed.push({ ...x, salary: standard(c.next), updatedAt: now })
    if (alsoStale) for (const x of c.stale) changed.push({ ...x, salary: { ...x.salary!, amount: c.next.amount, currency: c.next.currency }, updatedAt: now })
  }
  const clean: Partial<Record<Organisation, SalaryDefault>> = {}
  for (const [org, d] of Object.entries(next) as [Organisation, SalaryDefault | undefined][]) if (d && d.amount > 0) clean[org] = { amount: round2(d.amount), currency: d.currency }
  await saveSettings(store, { salaryDefaults: clean })
  if (changed.length > 0) await store.putMany('trips.json.enc', changed)
  void store.sync()
  return changed.length
}

/** Vandaag vraagt "Salaris van <trip> ontvangen?" na de einddatum, zolang het salaris verwacht is. */
/**
 * Het id van het salarisinkomen van een trip: vast per trip, zodat een tweede tik, een uitbetaling of een ander apparaat
 * nooit een tweede inkomen voor hetzelfde salaris maakt (twee apparaten schrijven dan hetzelfde record).
 */
export function salaryIncomeId(tripId: string): string {
  return `salaris:${tripId}`
}

/** Het salarisinkomen (loon) dat al bij deze trip staat, als dat er is. */
export function salaryIncomeOf(tripId: string, transactions: readonly Transaction[]): Transaction | undefined {
  return transactions.find((tx) => tx.deletedAt === null && tx.kind === 'loon' && tx.tripId === tripId)
}

/** Trips waarvan Vandaag vraagt of het salaris binnen is; niet als er al een salarisinkomen bij de trip staat. */
export function salaryQuestions(trips: readonly Trip[], legs: readonly Leg[], today: string, transactions: readonly Transaction[] = []): Trip[] {
  return active(trips)
    .filter((x) => {
      const s = countedSalary(x)
      if (!s || s.status !== 'verwacht' || salaryIncomeOf(x.id, transactions)) return false
      const end = tripEnd(x, legs)
      // Een trip die de dagen volgt, is pas drie dagen na de laatste dag voorbij (hij kan nog doorlopen).
      return !!end && endedFor(x, end) < today && (!s.askAfter || s.askAfter <= today)
    })
    .sort((a, b) => tripEnd(a, legs).localeCompare(tripEnd(b, legs)))
}

/** Bron van een salaristransactie: de organisatie (of delivery), anders overig. */
export function salarySource(trip: Trip): TransactionSource {
  if (trip.organisation === 'sailing-virgins' || trip.organisation === 'yacht-week') return trip.organisation
  return trip.type === 'delivery' ? 'delivery' : 'overig'
}

/**
 * Salaris ontvangen: één inkomen (loon) bij de trip, met het werkelijke bedrag als dat anders is, en de status op
 * ontvangen. De trip zoals hij nu op het apparaat staat (een tweede tik of een ander apparaat dat het al ontving: dan
 * niets); `trip.salary` mag een nieuw salaris zijn (salaris zetten en meteen ontvangen). Ongedaan maken haalt het inkomen
 * weg en zet alleen het salaris terug.
 */
export async function receiveSalary(store: Store, trip: Trip, today: string, actual?: { amount: number; currency: Currency }): Promise<Undo> {
  const s = trip.salary
  if (!s) throw new Error('salaris ontbreekt')
  const latest = store.list('trips.json.enc').find((x) => x.id === trip.id) ?? trip
  if (latest.salary?.status === 'ontvangen') return async () => {}
  const before = latest.salary
  const now = new Date().toISOString()
  const { askAfter: _ask, ...current } = s
  void _ask
  // Er staat al een salarisinkomen bij de trip (een tweede tik, of de status viel op een ander apparaat terug naar
  // verwacht): niets nog eens boeken, alleen de status bijwerken.
  const existing = salaryIncomeOf(trip.id, store.list('transactions.json.enc'))
  if (existing) {
    await store.put('trips.json.enc', { ...latest, salary: { ...current, status: 'ontvangen', transactionId: existing.id }, updatedAt: now })
    void store.sync()
    return async () => {
      const later = new Date().toISOString()
      const now2 = store.list('trips.json.enc').find((x) => x.id === trip.id)
      if (now2) {
        const restored: Trip = { ...now2, updatedAt: later }
        if (before) restored.salary = before
        else delete restored.salary
        await store.put('trips.json.enc', restored)
      }
      void store.sync()
    }
  }
  const amount = round2(actual?.amount ?? s.amount)
  const currency = actual?.currency ?? s.currency
  const base = { date: today, amount, currency }
  const tx: Transaction = {
    id: salaryIncomeId(trip.id),
    ...base,
    kind: 'loon',
    source: salarySource(latest),
    tripId: trip.id,
    ...(finalRateFields(base) ?? {}),
    updatedAt: now,
    deletedAt: null,
  }
  await store.put('transactions.json.enc', tx)
  await store.put('trips.json.enc', { ...latest, salary: { ...current, status: 'ontvangen', transactionId: tx.id }, updatedAt: now })
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.put('transactions.json.enc', { ...tx, deletedAt: later, updatedAt: later })
    const current = store.list('trips.json.enc').find((x) => x.id === trip.id)
    if (current) {
      const restored: Trip = { ...current, updatedAt: later }
      if (before) restored.salary = before
      else delete restored.salary
      await store.put('trips.json.enc', restored)
    }
    void store.sync()
  }
}

/**
 * "Geen salaris" voor deze trip (zelf gekozen): telt nergens meer als verwacht of te ontvangen, en Vandaag vraagt er niet
 * meer naar. Niet bij een salaris dat al ontvangen is (dat inkomen staat bij Geld). Met ongedaan maken.
 */
export async function setNoSalary(store: Store, trip: Trip): Promise<Undo> {
  const latest = store.list('trips.json.enc').find((x) => x.id === trip.id) ?? trip
  if (latest.salary?.status === 'ontvangen' || latest.salary?.status === 'geen') return async () => {}
  const before = latest.salary
  await store.put('trips.json.enc', { ...latest, salary: noSalary(before?.currency ?? 'EUR'), updatedAt: new Date().toISOString() })
  void store.sync()
  return async () => {
    const current = store.list('trips.json.enc').find((x) => x.id === trip.id)
    if (current) {
      const restored: Trip = { ...current, updatedAt: new Date().toISOString() }
      if (before) restored.salary = before
      else delete restored.salary
      await store.put('trips.json.enc', restored)
    }
    void store.sync()
  }
}

/** "Nog niet": een week later opnieuw vragen. */
export async function askSalaryLater(store: Store, trip: Trip, today: string, days = 7): Promise<Undo> {
  if (!trip.salary) throw new Error('salaris ontbreekt')
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  await store.put('trips.json.enc', { ...trip, salary: { ...trip.salary, askAfter: d.toISOString().slice(0, 10) }, updatedAt: new Date().toISOString() })
  void store.sync()
  return async () => {
    await store.put('trips.json.enc', { ...trip, updatedAt: new Date().toISOString() })
    void store.sync()
  }
}

/** Salaris in euro op een datum (de koers van die datum of de laatst bekende); null zonder koers. */
export function salaryEur(s: Pick<TripSalary, 'amount' | 'currency'>, date: string, rates: RatesFile | null): number | null {
  if (s.currency === 'EUR') return s.amount
  const hit = rateFor(rates, s.currency, date)
  return hit ? round2(s.amount / hit.rate) : null
}

export interface OutlookMonth {
  /** jjjj-mm */
  month: string
  /** Verwacht salaris (nog niet ontvangen), op de maand van de einddatum van de trip. */
  expectedEur: number
  /** Ontvangen salaris (inkomen van soort loon), op de maand van ontvangst. */
  receivedEur: number
  /** Geschatte fooi (gemiddelde per trip van de organisatie); alleen een schatting, apart van het salaris. */
  tipEstimateEur: number
  /** Trips die in deze maand eindigen met een verwacht salaris. */
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
  /** Gemiddelde fooi per trip per organisatie (uit afgelopen trips met fooi). */
  tipAverages: Partial<Record<Organisation, number>>
}

const month = (iso: string) => iso.slice(0, 7)

function nextMonth(m: string): string {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`
}

/** Gemiddelde fooi per trip per organisatie, over afgelopen trips met minstens één fooi. */
export function tipAverages(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], today: string): Partial<Record<Organisation, number>> {
  const tipsByTrip = new Map<string, number>()
  for (const tx of active(transactions)) {
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
 * Vooruitblik: per maand het verwachte en het ontvangen salaris, van de vroegste maand met een nog niet ontvangen
 * salaris (of deze maand) tot en met de maand waarin de laatste trip van de planning eindigt. Met een geschatte fooi
 * per komende trip, apart gehouden van het salaris.
 */
export function salaryOutlook(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], today: string, rates: RatesFile | null): Outlook {
  const live = active(trips)
  const averages = tipAverages(live, legs, transactions, today)
  const other: Partial<Record<Currency, number>> = {}
  const expected = live
    .map((x) => ({ trip: x, end: tripEnd(x, legs) }))
    .filter((e) => e.end && countedSalary(e.trip)?.status === 'verwacht')
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
    const eur = salaryEur(e.trip.salary!, e.end, rates)
    if (eur === null) other[e.trip.salary!.currency] = round2((other[e.trip.salary!.currency] ?? 0) + e.trip.salary!.amount)
    else row.expectedEur = round2(row.expectedEur + eur)
    row.trips.push(e.trip)
  }
  for (const tx of active(transactions)) {
    if (tx.kind !== 'loon') continue
    const row = at(month(tx.date))
    if (!row) continue
    const eur = eurOf(tx)
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
