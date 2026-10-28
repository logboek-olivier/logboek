import type { Store } from '../storage/store'
import { tripForDate } from './derive'
import { round2 } from './money'
import { finalRateFields } from './rates'
import type { CollectionPath, Collections, Leg, Reminder, TipFrom, Transaction, Trip } from './types'

// Bewerken en verwijderen. Verwijderen is een tombstone en geeft een functie terug die het ongedaan maakt
// (de melding "Verwijderd · Ongedaan maken"); ongedaan maken zet de vorige versie terug met een nieuwe updatedAt.

type Removal = { [P in CollectionPath]: { path: P; record: Collections[P] } }[CollectionPath]
export type Undo = () => Promise<void>

async function removeWithUndo(store: Store, items: Removal[]): Promise<Undo> {
  const now = new Date().toISOString()
  for (const item of items) await putOne(store, { ...item, record: { ...item.record, updatedAt: now, deletedAt: now } } as Removal)
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    for (const item of items) await putOne(store, { ...item, record: { ...item.record, updatedAt: later, deletedAt: null } } as Removal)
    void store.sync()
  }
}

function putOne(store: Store, item: Removal): Promise<void> {
  switch (item.path) {
    case 'trips.json.enc':
      return store.put(item.path, item.record)
    case 'legs.json.enc':
      return store.put(item.path, item.record)
    case 'transactions.json.enc':
      return store.put(item.path, item.record)
    case 'settings.json.enc':
      return store.put(item.path, item.record)
    case 'curricula.json.enc':
      return store.put(item.path, item.record)
    case 'students.json.enc':
      return store.put(item.path, item.record)
    case 'plans.json.enc':
      return store.put(item.path, item.record)
    case 'places.json.enc':
      return store.put(item.path, item.record)
    case 'reminders.json.enc':
      return store.put(item.path, item.record)
    case 'checklists.json.enc':
      return store.put(item.path, item.record)
    case 'calendar.json.enc':
      return store.put(item.path, item.record)
  }
}

export function deleteReminder(store: Store, reminder: Reminder): Promise<Undo> {
  return removeWithUndo(store, [{ path: 'reminders.json.enc', record: reminder }])
}

export function deleteTransaction(store: Store, tx: Transaction): Promise<Undo> {
  return removeWithUndo(store, [{ path: 'transactions.json.enc', record: tx }])
}

/** Een dag verwijderen; raakt de tocht daardoor leeg, dan gaat die mee (en komt terug bij ongedaan maken). */
export function deleteLeg(store: Store, leg: Leg): Promise<Undo> {
  const items: Removal[] = [{ path: 'legs.json.enc', record: leg }]
  const others = store.list('legs.json.enc').filter((l) => l.tripId === leg.tripId && l.id !== leg.id)
  const trip = store.list('trips.json.enc').find((t) => t.id === leg.tripId)
  if (others.length === 0 && trip) items.push({ path: 'trips.json.enc', record: trip })
  return removeWithUndo(store, items)
}

/** Een tocht met al zijn dagen verwijderen. */
export function deleteTrip(store: Store, trip: Trip): Promise<Undo> {
  const legs = store.list('legs.json.enc').filter((l) => l.tripId === trip.id)
  return removeWithUndo(store, [
    { path: 'trips.json.enc', record: trip },
    ...legs.map((record): Removal => ({ path: 'legs.json.enc', record })),
  ])
}

export async function renameTrip(store: Store, trip: Trip, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed || trimmed === trip.name) return
  await store.put('trips.json.enc', { ...trip, name: trimmed, updatedAt: new Date().toISOString() })
  void store.sync()
}

export type TransactionPatch = Pick<Transaction, 'date' | 'kind' | 'amount' | 'currency' | 'source'> & {
  note?: string
  receivedEur?: number
  /** Gekozen trip; null = geen trip; ontbreekt het, dan volgt de trip uit de datum. */
  tripId?: string | null
  /** Van wie een fooi komt; null = onbekend; ontbreekt het, dan blijft het zoals het was. */
  tipFrom?: TipFrom | null
}

/** Werkt een transactie bij; amountEur volgt uit valuta en datum, de trip uit de keuze of anders de datum. */
export async function updateTransaction(store: Store, tx: Transaction, patch: TransactionPatch): Promise<void> {
  const { tripId: chosenTrip, tipFrom, ...fields } = patch
  const next: Transaction = { ...tx, ...fields, amount: round2(patch.amount), updatedAt: new Date().toISOString() }
  if (tipFrom) next.tipFrom = tipFrom
  // Geen fooi meer, van onbekend, of een andere trip zonder nieuwe keuze: geen personen bewaren.
  if (tipFrom === null || next.kind !== 'fooi') delete next.tipFrom
  const trip = chosenTrip !== undefined ? (chosenTrip ? { id: chosenTrip } : null) : tripForDate(store.get('trips.json.enc'), store.get('legs.json.enc'), next.date)
  if (tipFrom === undefined && (trip?.id ?? undefined) !== tx.tripId) delete next.tipFrom
  if (!patch.note) delete next.note
  if (!patch.receivedEur) delete next.receivedEur
  if (next.currency === 'EUR') {
    next.amountEur = next.amount
    delete next.rate
    delete next.rateDate
    delete next.receivedEur
  } else if (patch.currency !== tx.currency || patch.amount !== tx.amount || patch.date !== tx.date) {
    // Andere valuta, bedrag of datum: de koers van de nieuwe datum, zodra die definitief is.
    delete next.amountEur
    delete next.rate
    delete next.rateDate
    Object.assign(next, finalRateFields(next) ?? {})
  }
  if (trip) next.tripId = trip.id
  else delete next.tripId
  await store.put('transactions.json.enc', next)
  void store.sync()
}

export type LegPatch = Omit<Leg, 'id' | 'updatedAt' | 'deletedAt' | 'source' | 'dateEstimated' | 'tripId'>

/**
 * Werkt een dag bij. `trip` is een bestaande tocht (id) of een nieuwe naam. Een gewijzigde datum is daarna niet
 * meer geschat. Een geïmporteerde dag blijft `import`: een nieuwe import vervangt hem.
 */
export async function updateLeg(store: Store, leg: Leg, patch: LegPatch, trip: { id: string } | { newName: string }): Promise<void> {
  const now = new Date().toISOString()
  let tripId: string
  if ('id' in trip) tripId = trip.id
  else {
    const created: Trip = { id: crypto.randomUUID(), name: trip.newName.trim(), updatedAt: now, deletedAt: null }
    await store.put('trips.json.enc', created)
    tripId = created.id
  }
  const next: Leg = { ...leg, ...patch, tripId, updatedAt: now, dateEstimated: patch.date === leg.date ? leg.dateEstimated : false }
  for (const key of ['skipperName', 'coSkipperName', 'windBft', 'notes'] as const) {
    if (!next[key]) delete next[key]
  }
  await store.put('legs.json.enc', next)
  void store.sync()
}

/** "12,5" → 12.5; leeg → 0; ongeldig of negatief → null. Voor mijlen en nachturen, waar 0 geldig is. */
export function parseNonNegative(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? round2(n) : null
}
