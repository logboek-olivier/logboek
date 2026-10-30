import type { Store } from '../storage/store'
import { scrubbedCareer } from './career'
import { tripForDate } from './derive'
import { scrubbedDocument } from './documents'
import { datesFollowDays, followDays, hasOtherData } from './trip-dates'
import { round2 } from './money'
import { finalRateFields } from './rates'
import type { CareerRecord, Claim, CollectionPath, Collections, Goal, Leg, Reminder, Session, Skill, TipFrom, TipVia, CostCategory, Transaction, Trip, VaultDocument, WeekClosing } from './types'

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
    case 'weekreviews.json.enc':
      return store.put(item.path, item.record)
    case 'goals.json.enc':
      return store.put(item.path, item.record)
    case 'skills.json.enc':
      return store.put(item.path, item.record)
    case 'sessions.json.enc':
      return store.put(item.path, item.record)
    case 'documents/index.json.enc':
      return store.put(item.path, item.record)
    case 'career.json.enc':
      return store.put(item.path, item.record)
    case 'accounts.json.enc':
      return store.put(item.path, item.record)
    case 'balances.json.enc':
      return store.put(item.path, item.record)
    case 'fixedcosts.json.enc':
      return store.put(item.path, item.record)
    case 'claims.json.enc':
      return store.put(item.path, item.record)
    case 'periods.json.enc':
      return store.put(item.path, item.record)
  }
}

export function deleteReminder(store: Store, reminder: Reminder): Promise<Undo> {
  return removeWithUndo(store, [{ path: 'reminders.json.enc', record: reminder }])
}

export function deleteWeekClosing(store: Store, closing: WeekClosing): Promise<Undo> {
  return removeWithUndo(store, [{ path: 'weekreviews.json.enc', record: closing }])
}

/** Een doel met zijn metingen verwijderen (ongedaan maken zet ze allemaal terug). */
export function deleteGoal(store: Store, goal: Goal): Promise<Undo> {
  const own = store.list('sessions.json.enc').filter((s) => s.goalId === goal.id)
  return removeWithUndo(store, [{ path: 'goals.json.enc', record: goal }, ...own.map((record): Removal => ({ path: 'sessions.json.enc', record }))])
}

/** Een skill met zijn sessies verwijderen. */
export function deleteSkill(store: Store, skill: Skill): Promise<Undo> {
  const own = store.list('sessions.json.enc').filter((s) => s.skillId === skill.id)
  return removeWithUndo(store, [{ path: 'skills.json.enc', record: skill }, ...own.map((record): Removal => ({ path: 'sessions.json.enc', record }))])
}

/** Een document uit de kluis verwijderen (tombstone). Het bestand blijft nog een dag op het apparaat, voor ongedaan maken. */
/** Een document verwijderen: een tombstone zonder titel en notitie; ongedaan maken zet het uit het geheugen terug. */
export async function deleteDocument(store: Store, document: VaultDocument): Promise<Undo> {
  const original = { ...document }
  await store.put('documents/index.json.enc', scrubbedDocument(document, new Date().toISOString()))
  void store.sync()
  return async () => {
    await store.put('documents/index.json.enc', { ...original, updatedAt: new Date().toISOString(), deletedAt: null })
    void store.sync()
  }
}

/** Een sollicitatie, contact of project verwijderen: een tombstone zonder inhoud; ongedaan maken zet het uit het geheugen terug. */
export async function deleteCareerRecord(store: Store, record: CareerRecord): Promise<Undo> {
  const original = { ...record }
  await store.put('career.json.enc', scrubbedCareer(record, new Date().toISOString()))
  void store.sync()
  return async () => {
    await store.put('career.json.enc', { ...original, updatedAt: new Date().toISOString(), deletedAt: null })
    void store.sync()
  }
}

export function deleteSession(store: Store, session: Session): Promise<Undo> {
  return removeWithUndo(store, [{ path: 'sessions.json.enc', record: session }])
}

/**
 * Een transactie verwijderen. Was het het inkomen van een ontvangen salaris (ook een deel van een uitbetaling), dan
 * staat dat salaris weer op te ontvangen; ongedaan maken zet beide terug.
 */
export async function deleteTransaction(store: Store, tx: Transaction): Promise<Undo> {
  const paid = store.list('trips.json.enc').filter((x) => x.deletedAt === null && x.salary?.status === 'ontvangen' && x.salary.transactionId === tx.id)
  // De uitgave of terugbetaling van een declaratie: de declaratie volgt, zodat saldo en "te ontvangen" blijven kloppen.
  const claim = tx.claimId ? store.list('claims.json.enc').find((c) => c.id === tx.claimId) : undefined
  const claimNext = claim ? claimWithout(claim, tx) : null
  const undoTx = await removeWithUndo(store, [{ path: 'transactions.json.enc', record: tx }])
  const now = new Date().toISOString()
  if (claim && claimNext) await store.put('claims.json.enc', { ...claimNext, updatedAt: now })
  if (paid.length === 0) {
    if (!claim || !claimNext) return undoTx
    void store.sync()
    return async () => {
      await undoTx()
      await store.put('claims.json.enc', { ...claim, updatedAt: new Date().toISOString() })
      void store.sync()
    }
  }
  await store.putMany(
    'trips.json.enc',
    paid.map((x) => {
      const { transactionId: _t, ...salary } = x.salary!
      void _t
      return { ...x, salary: { ...salary, status: 'verwacht' as const }, updatedAt: now }
    }),
  )
  void store.sync()
  return async () => {
    await undoTx()
    const later = new Date().toISOString()
    const restored = paid.map((before) => ({ ...(store.list('trips.json.enc').find((x) => x.id === before.id) ?? before), salary: before.salary!, updatedAt: later }))
    await store.putMany('trips.json.enc', restored)
    void store.sync()
  }
}

/**
 * De declaratie zonder deze transactie: zonder terugbetaling weer ingediend (of open), zonder uitgave zonder bedrag
 * (dan is er ook niets meer te ontvangen). Null als de declaratie niet verandert.
 */
function claimWithout(claim: Claim, tx: Transaction): Claim | null {
  if (tx.kind === 'terugbetaling' && claim.status === 'terugbetaald') {
    const { repaid: _r, ...rest } = claim
    void _r
    return { ...rest, status: claim.submittedAt ? 'ingediend' : 'open' }
  }
  if (tx.kind === 'kosten' && claim.amount !== undefined) {
    const { amount: _a, currency: _c, ...rest } = claim
    void [_a, _c]
    return rest
  }
  return null
}

/**
 * Een dag verwijderen; raakt de tocht daardoor leeg, dan gaat die mee (en komt terug bij ongedaan maken), maar alleen als
 * de datums de dagen volgen en er verder niets aan hangt (inkomsten, deelnemers, salaris, review, ...): een trip met eigen
 * datums of met gegevens blijft. Volgen de datums van de trip de dagen, dan schuiven ze mee (ook bij ongedaan maken).
 */
export async function deleteLeg(store: Store, leg: Leg): Promise<Undo> {
  const items: Removal[] = [{ path: 'legs.json.enc', record: leg }]
  const others = store.list('legs.json.enc').filter((l) => l.tripId === leg.tripId && l.id !== leg.id)
  const trip = store.list('trips.json.enc').find((t) => t.id === leg.tripId)
  if (others.length === 0 && trip && datesFollowDays(trip) && !hasOtherData(store, trip)) items.push({ path: 'trips.json.enc', record: trip })
  const undo = await removeWithUndo(store, items)
  await followDays(store, [leg.tripId])
  return async () => {
    await undo()
    await followDays(store, [leg.tripId])
  }
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
  /** Fooi contant of op de bank; null = onbekend; ontbreekt het, dan blijft het zoals het was. */
  tipVia?: TipVia | null
  /** Contante fooi gestort op (jjjj-mm-dd); null = nog niet gestort; ontbreekt het, dan blijft het zoals het was. */
  depositedAt?: string | null
  /** Soort losse uitgave; null = weg; ontbreekt het, dan blijft het zoals het was. */
  category?: CostCategory | null
}

/** Werkt een transactie bij; amountEur volgt uit valuta en datum, de trip uit de keuze of anders de datum. */
export async function updateTransaction(store: Store, tx: Transaction, patch: TransactionPatch): Promise<void> {
  const { tripId: chosenTrip, tipFrom, tipVia, depositedAt, category, ...fields } = patch
  const next: Transaction = { ...tx, ...fields, amount: round2(patch.amount), updatedAt: new Date().toISOString() }
  if (tipFrom) next.tipFrom = tipFrom
  if (tipVia) next.tipVia = tipVia
  if (tipVia === null) delete next.tipVia
  if (depositedAt) next.depositedAt = depositedAt
  if (depositedAt === null) delete next.depositedAt
  // Contant of bank en gestort horen alleen bij een fooi; gestort alleen bij contant.
  if (next.kind !== 'fooi') delete next.tipVia
  if (next.tipVia !== 'contant') delete next.depositedAt
  if (category) next.category = category
  // Een soort hoort bij een uitgave (kosten of investering, docs/PERIODEMODEL.md).
  if (category === null || (next.kind !== 'kosten' && next.kind !== 'investering')) delete next.category
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
  // Een andere datum of een andere trip: de datums van beide trips volgen hun dagen (als ze dat doen).
  if (next.date !== leg.date || tripId !== leg.tripId) await followDays(store, [leg.tripId, tripId])
  void store.sync()
}

/** "12,5" → 12.5; leeg → 0; ongeldig of negatief → null. Voor mijlen en nachturen, waar 0 geldig is. */
export function parseNonNegative(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? round2(n) : null
}
