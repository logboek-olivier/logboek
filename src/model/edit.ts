import type { Tx } from '../domain/tx'
import { scrubbedCareer } from './career'
import { tripForDate } from './derive'
import { scrubbedDocument } from './documents'
import { datesFollowDays, followDays, hasOtherData } from './trip-dates'
import { finalRateFields } from './rates'
import type { CareerRecord, Claim, CollectionPath, Collections, Goal, Leg, Reminder, Session, Skill, SyncRecord, TipFrom, TipVia, CostCategory, Transaction, Trip, VaultDocument, WeekClosing } from './types'
import { round2 } from '../basis/bedrag'

// Bewerken en verwijderen, in de transactie van een opdracht (src/domain). Verwijderen is een tombstone; ongedaan maken
// regelt de opdracht (de toestand vooraf komt terug).

/** Records verwijderen: een tombstone met de inhoud erin (de prullenbak en ongedaan maken hebben die nodig). */
async function removeAll(tx: Tx, path: CollectionPath, records: readonly SyncRecord[]): Promise<void> {
  if (records.length === 0) return
  await tx.putMany(path, records.map((r) => ({ ...r, updatedAt: tx.now, deletedAt: tx.now })) as Collections[typeof path][])
}

export function deleteReminder(tx: Tx, reminder: Reminder): Promise<void> {
  return removeAll(tx, 'reminders.json.enc', [reminder])
}

export function deleteWeekClosing(tx: Tx, closing: WeekClosing): Promise<void> {
  return removeAll(tx, 'weekreviews.json.enc', [closing])
}

/** Een doel met zijn metingen verwijderen. */
export async function deleteGoal(tx: Tx, goal: Goal): Promise<void> {
  await removeAll(tx, 'goals.json.enc', [goal])
  await removeAll(tx, 'sessions.json.enc', tx.list('sessions.json.enc').filter((s) => s.goalId === goal.id))
}

/** Een skill met zijn sessies verwijderen. */
export async function deleteSkill(tx: Tx, skill: Skill): Promise<void> {
  await removeAll(tx, 'skills.json.enc', [skill])
  await removeAll(tx, 'sessions.json.enc', tx.list('sessions.json.enc').filter((s) => s.skillId === skill.id))
}

/** Een document verwijderen: een tombstone zonder titel en notitie. */
export async function deleteDocument(tx: Tx, document: VaultDocument): Promise<void> {
  await tx.put('documents/index.json.enc', scrubbedDocument(document, tx.now))
}

/** Een sollicitatie, contact of project verwijderen: een tombstone zonder inhoud. */
export async function deleteCareerRecord(tx: Tx, record: CareerRecord): Promise<void> {
  await tx.put('career.json.enc', scrubbedCareer(record, tx.now))
}

export function deleteSession(tx: Tx, session: Session): Promise<void> {
  return removeAll(tx, 'sessions.json.enc', [session])
}

/**
 * Een transactie verwijderen. Was het het inkomen van een ontvangen salaris (ook een deel van een uitbetaling), dan
 * staat dat salaris weer op te ontvangen; de uitgave of terugbetaling van een declaratie: de declaratie volgt, zodat
 * saldo en "te ontvangen" blijven kloppen.
 */
export async function deleteTransaction(tx: Tx, transaction: Transaction): Promise<void> {
  const paid = tx.list('trips.json.enc').filter((x) => x.salary?.status === 'ontvangen' && x.salary.transactionId === transaction.id)
  const claim = transaction.claimId ? tx.list('claims.json.enc').find((c) => c.id === transaction.claimId) : undefined
  const claimNext = claim ? claimWithout(claim, transaction) : null
  await removeAll(tx, 'transactions.json.enc', [transaction])
  if (claimNext) await tx.put('claims.json.enc', { ...claimNext, updatedAt: tx.now })
  await tx.putMany(
    'trips.json.enc',
    paid.map((x) => {
      const { transactionId: _t, ...salary } = x.salary!
      void _t
      return { ...x, salary: { ...salary, status: 'verwacht' as const }, updatedAt: tx.now }
    }),
  )
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
export async function deleteLeg(tx: Tx, leg: Leg): Promise<void> {
  await removeAll(tx, 'legs.json.enc', [leg])
  const others = tx.list('legs.json.enc').filter((l) => l.tripId === leg.tripId)
  const trip = tx.list('trips.json.enc').find((t) => t.id === leg.tripId)
  if (others.length === 0 && trip && datesFollowDays(trip) && !hasOtherData(tx, trip)) await removeAll(tx, 'trips.json.enc', [trip])
  await followDays(tx, [leg.tripId])
}

export async function renameTrip(tx: Tx, trip: Trip, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed || trimmed === trip.name) return
  await tx.put('trips.json.enc', { ...trip, name: trimmed, updatedAt: tx.now })
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
export async function updateTransaction(store: Tx, tx: Transaction, patch: TransactionPatch): Promise<void> {
  const { tripId: chosenTrip, tipFrom, tipVia, depositedAt, category, ...fields } = patch
  const next: Transaction = { ...tx, ...fields, amount: round2(patch.amount), updatedAt: store.now }
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
}

export type LegPatch = Omit<Leg, 'id' | 'updatedAt' | 'deletedAt' | 'source' | 'dateEstimated' | 'tripId'>

/**
 * Werkt een dag bij. `trip` is een bestaande tocht (id) of een nieuwe naam. Een gewijzigde datum is daarna niet
 * meer geschat. Een geïmporteerde dag blijft `import`: een nieuwe import vervangt hem.
 */
export async function updateLeg(store: Tx, leg: Leg, patch: LegPatch, trip: { id: string } | { newName: string }): Promise<void> {
  const now = store.now
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
}

/** "12,5" → 12.5; leeg → 0; ongeldig of negatief → null. Voor mijlen en nachturen, waar 0 geldig is. */
export function parseNonNegative(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? round2(n) : null
}
