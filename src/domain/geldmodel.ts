import { active } from '../model/derive'
import { endedFor } from '../model/trip-dates'
import { newId, type SalaryStatus, type Season, type Transaction, type Trip } from '../model/types'

// Eén waarheid voor geld (CLAUDE.md, Zeilgeld): al het geld is een Transaction. Het salaris van een tocht is precies één
// transactie van soort loon met een status (verwacht, ontvangen of geen); fooien, bonus, overige inkomsten, kosten en
// investeringen zijn gewone transacties. Een transactie hoort bij een tocht (tripId), bij een eerder seizoen (organisatie
// en jaar) of bij niets. Elk geldscherm rekent met deze functies, zodat tocht, Geld, agenda, Vandaag, het jaaroverzicht,
// per organisatie, per werkdag en de fooi per gast uit dezelfde transacties dezelfde uitkomst geven.

/** Status van een loon-transactie; zonder status (elk loon van vóór dit veld, en een onbekende waarde) ontvangen. */
export function salaryStatus(tx: Pick<Transaction, 'status'>): SalaryStatus {
  return tx.status === 'verwacht' || tx.status === 'geen' ? tx.status : 'ontvangen'
}

/**
 * Echt geld: niet verwijderd, en geen salaris dat nog verwacht wordt of "geen salaris" is. Alleen dit telt in verdiend,
 * kosten, het saldo, de transactielijst, per organisatie, per werkdag en het jaaroverzicht.
 */
export function isBooked(tx: Transaction): boolean {
  return tx.deletedAt === null && (tx.kind !== 'loon' || salaryStatus(tx) === 'ontvangen')
}

export function booked(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter(isBooked)
}

const byDate = (a: Transaction, b: Transaction) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

/** Alle salarissen (loon, elke status) van een tocht. Meer dan één staat in Te controleren: Olivier kiest zelf. */
export function salariesOf(tripId: string, transactions: readonly Transaction[]): Transaction[] {
  return active(transactions)
    .filter((tx) => tx.kind === 'loon' && tx.tripId === tripId)
    .sort(byDate)
}

/** Het salaris van een tocht (bij meer dan één het oudste), of undefined. */
export function salaryOf(tripId: string, transactions: readonly Transaction[]): Transaction | undefined {
  return salariesOf(tripId, transactions)[0]
}

/**
 * Het id voor een nieuw salaris van een tocht: vast per tocht (`salaris:<trip>`), zodat een tweede tik of een ander
 * apparaat hetzelfde record schrijft. Is dat id al van een levende transactie (zelf naar een andere tocht gezet, of een
 * ander soort inkomen geworden), dan een nieuw id: nooit over ander geld heen.
 */
export function salaryIncomeId(tripId: string, transactions: readonly Transaction[] = []): string {
  const id = `salaris:${tripId}`
  // Elk levend record met dit id (naar een andere tocht gezet, of een ander soort inkomen geworden) blijft van zichzelf.
  return transactions.some((tx) => tx.id === id && tx.deletedAt === null) ? newId() : id
}

/** Verwachte salarissen (nog geen geld). */
export function expectedSalaries(transactions: readonly Transaction[]): Transaction[] {
  return active(transactions).filter((tx) => tx.kind === 'loon' && salaryStatus(tx) === 'verwacht')
}

/** Verwacht (de tocht loopt nog), te ontvangen (voorbij, nog niet binnen) of ontvangen; null bij "geen salaris". */
export type SalaryState = 'verwacht' | 'te-ontvangen' | 'ontvangen'

/** `end`: de einddatum van de tocht (leeg zonder datums). */
export function salaryState(salary: Transaction, trip: Trip | undefined, end: string, today: string): SalaryState | null {
  const status = salaryStatus(salary)
  if (status === 'geen') return null
  if (status === 'ontvangen') return 'ontvangen'
  // Een tocht die de dagen volgt, is pas drie dagen na de laatste dag voorbij (zoals overal).
  return end && trip && endedFor(trip, end) < today ? 'te-ontvangen' : 'verwacht'
}

/** Waar een transactie bij hoort: een tocht, een eerder seizoen of niets. */
export type MoneyLink = { kind: 'tocht'; tripId: string } | { kind: 'seizoen'; season: Season } | { kind: 'geen' }

export function linkOf(tx: Pick<Transaction, 'tripId' | 'season'>): MoneyLink {
  if (tx.tripId) return { kind: 'tocht', tripId: tx.tripId }
  const s = tx.season
  if (s && typeof s.org === 'string' && Number.isInteger(s.year)) return { kind: 'seizoen', season: s }
  return { kind: 'geen' }
}
