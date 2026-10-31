import { tripOrganisation } from './counters'
import { isEarned, isIncome } from './money'
import { eurValue, type RatesFile } from './rates'
import type { Organisation, Transaction, Trip } from './types'

// Jaaroverzicht voor de belasting (Meer → Geld): alle inkomsten van één kalenderjaar per organisatie, in euro, met per
// regel het oorspronkelijke bedrag en de gebruikte koers met datum, zoals overal in de app: het ontvangen eurobedrag,
// anders de opgeslagen koers, anders de ECB-koers van de transactiedatum of de werkdag ervoor. Een voorlopige koers
// staat erbij als voorlopig; zonder koers staat het bedrag apart, nooit omgerekend met een verzonnen koers.
// Terugbetaalde onkosten tellen niet als verdiend en staan apart. Als PDF via de printfunctie; er gaat niets naar buiten.

/** Organisatie van een inkomen: die van de trip, anders uit de bron van de transactie. */
export type TaxGroup = Organisation | 'delivery' | 'overig'

export interface TaxLine {
  id: string
  date: string
  kind: Transaction['kind']
  amount: number
  currency: Transaction['currency']
  /** null: geen eurowaarde bekend (geen koers). */
  eur: number | null
  /** Koers (valuta per euro) en de datum daarvan; bij euro en bij ontvangen euro geen koers. */
  rate?: number
  rateDate?: string
  basis: 'eur' | 'received' | 'stored' | 'rate' | 'none'
  provisional: boolean
  trip?: string
}

export interface TaxGroupTotal {
  group: TaxGroup
  lines: TaxLine[]
  /** Verdiend in euro (zonder terugbetalingen en zonder regels zonder koers). */
  eur: number
  /** Regels zonder eurowaarde, per valuta. */
  other: Record<string, number>
}

export interface TaxYear {
  year: number
  groups: TaxGroupTotal[]
  totalEur: number
  /** Terugbetaalde onkosten (apart, telt niet als verdiend). */
  reimbursed: TaxLine[]
  reimbursedEur: number
  /** Er staat minstens één voorlopige koers in. */
  provisional: boolean
}

const GROUP_ORDER: readonly TaxGroup[] = ['sailing-virgins', 'yacht-week', 'eigen', 'delivery', 'overig']

/** De organisatie van een inkomen of uitgave: van de trip (ook uit de naam), anders de oude bron. */
export function groupOf(tx: Transaction, trips: ReadonlyMap<string, Trip>): TaxGroup {
  const trip = tx.tripId ? trips.get(tx.tripId) : undefined
  // De organisatie van de trip, ook uit de naam ("Yacht week 7"), zoals de teller en de statistieken.
  const counted = trip ? tripOrganisation(trip) : null
  if (counted) return counted
  if (trip?.organisation && trip.organisation !== 'overig') return trip.organisation
  if (tx.source === 'sailing-virgins' || tx.source === 'yacht-week' || tx.source === 'delivery') return tx.source
  return 'overig'
}

export function taxYears(transactions: readonly Transaction[]): number[] {
  const years = new Set<number>()
  for (const tx of transactions) if (!tx.deletedAt && isIncome(tx.kind) && /^\d{4}-/.test(tx.date)) years.add(Number(tx.date.slice(0, 4)))
  return [...years].sort((a, b) => b - a)
}

export function taxYear(transactions: readonly Transaction[], trips: readonly Trip[], year: number, rates: RatesFile | null): TaxYear {
  const tripById = new Map(trips.filter((t) => !t.deletedAt).map((t) => [t.id, t]))
  const groups = new Map<TaxGroup, TaxGroupTotal>()
  const reimbursed: TaxLine[] = []
  let provisional = false
  const income = transactions
    .filter((tx) => !tx.deletedAt && isIncome(tx.kind) && tx.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const tx of income) {
    const value = eurValue(tx, rates)
    const line: TaxLine = {
      id: tx.id,
      date: tx.date,
      kind: tx.kind,
      amount: tx.amount,
      currency: tx.currency,
      eur: value?.eur ?? null,
      ...(value?.rate !== undefined && value.basis !== 'eur' && value.basis !== 'received' ? { rate: value.rate, ...(value.rateDate ? { rateDate: value.rateDate } : {}) } : {}),
      basis: value?.basis ?? 'none',
      provisional: value?.provisional ?? false,
      ...(tx.tripId && tripById.get(tx.tripId) ? { trip: tripById.get(tx.tripId)!.name } : {}),
    }
    if (line.provisional) provisional = true
    if (!isEarned(tx.kind)) {
      reimbursed.push(line)
      continue
    }
    const group = groupOf(tx, tripById)
    const total = groups.get(group) ?? { group, lines: [], eur: 0, other: {} }
    total.lines.push(line)
    if (line.eur !== null) total.eur = Math.round((total.eur + line.eur) * 100) / 100
    else total.other[tx.currency] = Math.round(((total.other[tx.currency] ?? 0) + tx.amount) * 100) / 100
    groups.set(group, total)
  }
  const ordered = GROUP_ORDER.map((g) => groups.get(g)).filter((g): g is TaxGroupTotal => !!g)
  return {
    year,
    groups: ordered,
    totalEur: Math.round(ordered.reduce((sum, g) => sum + g.eur, 0) * 100) / 100,
    reimbursed,
    reimbursedEur: Math.round(reimbursed.reduce((sum, l) => sum + (l.eur ?? 0), 0) * 100) / 100,
    provisional,
  }
}
