import type { Store } from '../storage/store'
import { active } from './derive'
import { addDocument, scrubbedDocument } from './documents'
import type { Undo } from './edit'
import { round2 } from './money'
import { finalRateFields } from './rates'
import { newId, type Claim, type ClaimStatus, type Currency, type Transaction, type TransactionSource, type Trip, type VaultDocument } from './types'
import type { Bytes } from '../crypto/encrypt'

// Declaraties: een uitgave die de organisatie terugbetaalt. + → Declaratie: een foto van het bonnetje (camera of
// galerij), een notitie en optioneel bedrag en valuta, bij de trip van die datum. Het bonnetje gaat versleuteld de kluis
// in (een document van soort financieel, met de kluistechniek: willekeurige bestandsnaam, AES-GCM, pas na de
// meta-controle naar GitHub); bonnetjes mogen in de testfase van de kluis, identiteitsdocumenten niet. Per declaratie
// "Delen" (het bonnetje naar de app van de organisatie), daarna "Ingediend?", en tot slot terugbetaald met datum en
// bedrag: dat wordt een inkomen van soort terugbetaling (telt in het saldo, niet als verdiend).

export interface ClaimInput {
  date: string
  tripId: string | null
  note: string
  amount: number | null
  currency: Currency
}

function clean(input: ClaimInput): Pick<Claim, 'date'> & Partial<Pick<Claim, 'tripId' | 'note' | 'amount' | 'currency'>> {
  const note = input.note.trim().slice(0, 500)
  const amount = input.amount !== null && Number.isFinite(input.amount) && input.amount > 0 ? round2(input.amount) : null
  return {
    date: input.date,
    ...(input.tripId ? { tripId: input.tripId } : {}),
    ...(note ? { note } : {}),
    ...(amount !== null ? { amount, currency: input.currency } : {}),
  }
}

/** Titel van het bonnetje in de kluis: neutraal, met de datum (de notitie staat bij de declaratie). */
function receiptTitle(date: string): string {
  return `Bonnetje ${date}`
}

/**
 * Een nieuwe declaratie. Met een foto: eerst het bonnetje versleuteld in de kluis (offline beschikbaar, zodat delen ook
 * zonder verbinding kan), dan de declaratie.
 */
export async function addClaim(store: Store, input: ClaimInput, receipt: { bytes: Bytes; mime: string } | null): Promise<Claim> {
  let document: VaultDocument | null = null
  if (receipt) document = await addDocument(store, { title: receiptTitle(input.date), category: 'financieel', issuedAt: input.date, expiresAt: '', notes: '', offline: true }, receipt)
  const claim: Claim = { id: newId(), ...clean(input), ...(document ? { documentId: document.id } : {}), status: 'open', updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('claims.json.enc', claim)
  void store.sync()
  return claim
}

/** Notitie, bedrag, datum en trip wijzigen; de status en het bonnetje blijven. */
export async function updateClaim(store: Store, claim: Claim, input: ClaimInput): Promise<void> {
  const latest = store.list('claims.json.enc').find((c) => c.id === claim.id) ?? claim
  const next: Claim = { id: latest.id, ...clean(input), status: latest.status, updatedAt: new Date().toISOString(), deletedAt: null }
  if (latest.documentId) next.documentId = latest.documentId
  if (latest.submittedAt) next.submittedAt = latest.submittedAt
  if (latest.repaid) next.repaid = latest.repaid
  await store.put('claims.json.enc', next)
  void store.sync()
}

async function setStatus(store: Store, claim: Claim, change: (latest: Claim) => Claim): Promise<Undo> {
  const before = store.list('claims.json.enc').find((c) => c.id === claim.id) ?? claim
  await store.put('claims.json.enc', { ...change(before), updatedAt: new Date().toISOString() })
  void store.sync()
  return async () => {
    await store.put('claims.json.enc', { ...before, updatedAt: new Date().toISOString() })
    void store.sync()
  }
}

/** "Ingediend": na het delen met de app van de organisatie. */
export function markSubmitted(store: Store, claim: Claim, date: string): Promise<Undo> {
  return setStatus(store, claim, (latest) => (latest.status === 'open' ? { ...latest, status: 'ingediend', submittedAt: date } : latest))
}

function sourceOf(trip: Trip | undefined): TransactionSource {
  if (trip?.organisation === 'sailing-virgins' || trip?.organisation === 'yacht-week') return trip.organisation
  return trip?.type === 'delivery' ? 'delivery' : 'overig'
}

/**
 * Terugbetaald: datum en bedrag (standaard het gedeclareerde bedrag). Er komt een inkomen van soort terugbetaling bij de
 * trip (telt in het saldo, niet als verdiend). Al terugbetaald (een tweede tik, een ander apparaat): niets. Ongedaan
 * maken haalt het inkomen weg en zet de declaratie terug.
 */
export async function markRepaid(store: Store, claim: Claim, repaid: { date: string; amount: number; currency: Currency }): Promise<Undo> {
  const before = store.list('claims.json.enc').find((c) => c.id === claim.id) ?? claim
  if (before.status === 'terugbetaald') return async () => {}
  const trip = before.tripId ? store.list('trips.json.enc').find((x) => x.id === before.tripId && x.deletedAt === null) : undefined
  const now = new Date().toISOString()
  const base = { date: repaid.date, amount: round2(repaid.amount), currency: repaid.currency }
  const tx: Transaction = {
    id: newId(),
    ...base,
    kind: 'terugbetaling',
    source: sourceOf(trip),
    ...(trip ? { tripId: trip.id } : {}),
    ...(base.currency === 'EUR' ? { amountEur: base.amount } : (finalRateFields(base) ?? {})),
    updatedAt: now,
    deletedAt: null,
  }
  await store.put('transactions.json.enc', tx)
  await store.put('claims.json.enc', { ...before, status: 'terugbetaald', ...(before.submittedAt ? {} : { submittedAt: repaid.date }), repaid: { ...base, transactionId: tx.id }, updatedAt: now })
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.put('transactions.json.enc', { ...tx, deletedAt: later, updatedAt: later })
    await store.put('claims.json.enc', { ...before, updatedAt: later })
    void store.sync()
  }
}

/** Tombstone zonder notitie of bedrag (alleen id en tijden); het bonnetje gaat mee de kluis uit. Met ongedaan maken. */
export async function deleteClaim(store: Store, claim: Claim): Promise<Undo> {
  const original = { ...claim }
  const doc = claim.documentId ? store.list('documents/index.json.enc').find((d) => d.id === claim.documentId && d.deletedAt === null) : undefined
  const now = new Date().toISOString()
  await store.put('claims.json.enc', { id: claim.id, date: claim.date, status: 'open', updatedAt: now, deletedAt: now })
  if (doc) await store.put('documents/index.json.enc', scrubbedDocument(doc, now))
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.put('claims.json.enc', { ...original, updatedAt: later, deletedAt: null })
    if (doc) await store.put('documents/index.json.enc', { ...doc, updatedAt: later, deletedAt: null })
    void store.sync()
  }
}

/** De declaraties van een trip, nieuwste eerst. */
export function tripClaims(claims: readonly Claim[], tripId: string): Claim[] {
  return active(claims)
    .filter((c) => c.tripId === tripId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Open of ingediende declaraties met een bedrag: die tellen als te ontvangen. */
export function openClaims(claims: readonly Claim[]): Claim[] {
  return active(claims).filter((c) => c.status !== 'terugbetaald' && c.amount !== undefined && c.amount > 0 && c.currency !== undefined)
}

/** Aantal per status, voor het geldpad van een trip. */
export function claimCounts(claims: readonly Claim[]): Record<ClaimStatus, number> {
  const out: Record<ClaimStatus, number> = { open: 0, ingediend: 0, terugbetaald: 0 }
  for (const c of active(claims)) out[c.status]++
  return out
}

/** De bestandsnaam bij delen: neutraal (nooit de notitie of titel), met de juiste extensie. */
export function receiptFileName(mime: string): string {
  return mime === 'application/pdf' ? 'bonnetje.pdf' : mime === 'image/png' ? 'bonnetje.png' : 'bonnetje.jpg'
}
