import type { Store } from '../storage/store'
import { t } from '../i18n'
import { active } from './derive'
import { addDocument, scrubbedDocument } from './documents'
import type { Undo } from './edit'
import { round2 } from './money'
import { finalRateFields } from './rates'
import { keepUnknownFields, newId, todayIso, type Claim, type ClaimStatus, type Currency, type Transaction, type TransactionSource, type Trip, type VaultDocument } from './types'
import type { Bytes } from '../crypto/encrypt'

// Declaraties: een uitgave die de organisatie terugbetaalt. + → Declaratie: een foto van het bonnetje (camera of
// galerij), een notitie en optioneel bedrag en valuta, bij de trip van die datum. Het bonnetje gaat versleuteld de kluis
// in (een document van soort financieel, met de kluistechniek: willekeurige bestandsnaam, AES-GCM, pas na de
// meta-controle naar GitHub); bonnetjes mogen in de testfase van de kluis, identiteitsdocumenten niet. Met een bedrag
// is de declaratie ook een uitgave (kosten, met claimId: telt niet mee in het gemiddelde van de losse uitgaven), zodat
// uitgave en terugbetaling samen op nul uitkomen. Per declaratie "Bonnetje delen" (naar de app van de organisatie),
// daarna "Ingediend?", en tot slot terugbetaald met datum en bedrag: een inkomen van soort terugbetaling (telt in het
// saldo, niet als verdiend).

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
    // Een lege datum is vandaag (zoals overal: niets is verplicht).
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayIso(),
    ...(input.tripId ? { tripId: input.tripId } : {}),
    ...(note ? { note } : {}),
    ...(amount !== null ? { amount, currency: input.currency } : {}),
  }
}

/** De velden van een declaratie die deze versie kent (de rest blijft bij bewerken staan, zie keepUnknownFields). */
const CLAIM_FIELDS = ['id', 'date', 'tripId', 'note', 'amount', 'currency', 'documentId', 'status', 'submittedAt', 'repaid', 'updatedAt', 'deletedAt'] as const

/** Titel van het bonnetje in de kluis: neutraal, met de datum (de notitie staat alleen bij de declaratie). */
function receiptTitle(date: string): string {
  return t('claims.receiptTitle', { date })
}

function sourceOf(trip: Trip | undefined): TransactionSource {
  if (trip?.organisation === 'sailing-virgins' || trip?.organisation === 'yacht-week') return trip.organisation
  return trip?.type === 'delivery' ? 'delivery' : 'overig'
}

/** De uitgave bij een declaratie met een bedrag (soort kosten, met claimId); null zonder bedrag. */
function costFor(store: Store, claim: Claim, id: string, now: string): Transaction | null {
  if (claim.amount === undefined || claim.currency === undefined) return null
  const trip = claim.tripId ? store.list('trips.json.enc').find((x) => x.id === claim.tripId) : undefined
  const base = { date: claim.date, amount: claim.amount, currency: claim.currency }
  return {
    id,
    ...base,
    kind: 'kosten',
    category: 'overig',
    source: sourceOf(trip),
    ...(claim.tripId ? { tripId: claim.tripId } : {}),
    ...(claim.note ? { note: claim.note } : {}),
    claimId: claim.id,
    ...(base.currency === 'EUR' ? { amountEur: base.amount } : (finalRateFields(base) ?? {})),
    updatedAt: now,
    deletedAt: null,
  }
}

/** Vaste id's voor de uitgave en de terugbetaling van een declaratie: een tweede tik of een ander apparaat boekt hetzelfde record. */
function costIdOf(claimId: string): string {
  return `uitgave:${claimId}`
}

function repaymentIdOf(claimId: string): string {
  return `terugbetaling:${claimId}`
}

/** De levende uitgave bij een declaratie. */
function costOf(store: Store, claimId: string): Transaction | undefined {
  // De uitgave van de declaratie (ook als iemand er een investering van maakte); de terugbetaling is een inkomen.
  return store.list('transactions.json.enc').find((tx) => tx.claimId === claimId && (tx.kind === 'kosten' || tx.kind === 'investering'))
}

/**
 * Een nieuwe declaratie. Met een foto: eerst het bonnetje versleuteld in de kluis (offline beschikbaar, zodat delen ook
 * zonder verbinding kan), dan de declaratie, en met een bedrag de uitgave.
 */
export async function addClaim(store: Store, input: ClaimInput, receipt: { bytes: Bytes; mime: string } | null): Promise<Claim> {
  const fields = clean(input)
  let document: VaultDocument | null = null
  if (receipt) document = await addDocument(store, { title: receiptTitle(fields.date), category: 'financieel', issuedAt: fields.date, expiresAt: '', notes: '', offline: true }, receipt)
  const now = new Date().toISOString()
  const claim: Claim = { id: newId(), ...fields, ...(document ? { documentId: document.id } : {}), status: 'open', updatedAt: now, deletedAt: null }
  await store.put('claims.json.enc', claim)
  const cost = costFor(store, claim, costIdOf(claim.id), now)
  if (cost) await store.put('transactions.json.enc', cost)
  void store.sync()
  return claim
}

/** Notitie, bedrag, datum en trip wijzigen; de status en het bonnetje blijven. De uitgave volgt mee. */
export async function updateClaim(store: Store, claim: Claim, input: ClaimInput): Promise<void> {
  const latest = store.list('claims.json.enc').find((c) => c.id === claim.id) ?? claim
  const now = new Date().toISOString()
  const rebuilt: Claim = { id: latest.id, ...clean(input), status: latest.status, updatedAt: now, deletedAt: null }
  if (latest.documentId) rebuilt.documentId = latest.documentId
  if (latest.submittedAt) rebuilt.submittedAt = latest.submittedAt
  if (latest.repaid) rebuilt.repaid = latest.repaid
  const next = keepUnknownFields(latest, rebuilt, CLAIM_FIELDS)
  await store.put('claims.json.enc', next)
  const existing = costOf(store, latest.id)
  const cost = costFor(store, next, existing?.id ?? costIdOf(latest.id), now)
  if (cost) await store.put('transactions.json.enc', cost)
  else if (existing) await store.put('transactions.json.enc', { ...existing, updatedAt: now, deletedAt: now })
  // De titel van het bonnetje volgt de datum.
  const doc = next.documentId ? store.list('documents/index.json.enc').find((d) => d.id === next.documentId) : undefined
  if (doc && next.date !== latest.date) await store.put('documents/index.json.enc', { ...doc, title: receiptTitle(next.date), issuedAt: next.date, updatedAt: now })
  void store.sync()
}

/** "Ingediend": na het delen met de app van de organisatie. Al ingediend of terugbetaald: niets. */
export async function markSubmitted(store: Store, claim: Claim, date: string): Promise<Undo> {
  const before = store.list('claims.json.enc').find((c) => c.id === claim.id) ?? claim
  if (before.status !== 'open') return async () => {}
  await store.put('claims.json.enc', { ...before, status: 'ingediend', submittedAt: date, updatedAt: new Date().toISOString() })
  void store.sync()
  return async () => {
    await store.put('claims.json.enc', { ...before, updatedAt: new Date().toISOString() })
    void store.sync()
  }
}

/**
 * Terugbetaald: datum en bedrag (standaard het gedeclareerde bedrag). Er komt een inkomen van soort terugbetaling bij de
 * trip (telt in het saldo, niet als verdiend). Al terugbetaald (een tweede tik, een ander apparaat): niets. Ongedaan
 * maken haalt het inkomen weg en zet de declaratie terug.
 */
export async function markRepaid(store: Store, claim: Claim, repaid: { date: string; amount: number; currency: Currency }): Promise<Undo> {
  const before = store.list('claims.json.enc').find((c) => c.id === claim.id) ?? claim
  if (before.status === 'terugbetaald') return async () => {}
  const trip = before.tripId ? store.list('trips.json.enc').find((x) => x.id === before.tripId) : undefined
  const now = new Date().toISOString()
  // De terugbetaling staat er al (de app sloot na het inkomen, vóór de declaratie): alleen de declaratie bijwerken.
  const existing = store.list('transactions.json.enc').find((tx) => tx.kind === 'terugbetaling' && tx.claimId === before.id)
  if (existing) {
    const paid = { date: existing.date, amount: existing.amount, currency: existing.currency, transactionId: existing.id }
    await store.put('claims.json.enc', { ...before, status: 'terugbetaald', ...(before.submittedAt ? {} : { submittedAt: paid.date }), repaid: paid, updatedAt: now })
    void store.sync()
    return async () => {
      await store.put('claims.json.enc', { ...before, updatedAt: new Date().toISOString() })
      void store.sync()
    }
  }
  const base = { date: repaid.date, amount: round2(repaid.amount), currency: repaid.currency }
  const tx: Transaction = {
    id: repaymentIdOf(before.id),
    ...base,
    kind: 'terugbetaling',
    source: sourceOf(trip),
    ...(trip ? { tripId: trip.id } : {}),
    claimId: before.id,
    ...(base.currency === 'EUR' ? { amountEur: base.amount } : (finalRateFields(base) ?? {})),
    updatedAt: now,
    deletedAt: null,
  }
  // Eerst het inkomen (met een vast id: een tweede tik of een ander apparaat schrijft hetzelfde record), dan de
  // declaratie. Sluit de app ertussen, dan telt de declaratie niet meer als te ontvangen en zet een tweede tik alleen de
  // status bij; zo verdwijnt een terugbetaling nooit stil uit het saldo.
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

/** Tombstone zonder notitie of bedrag: alleen id, datum, status en tijden. */
export function scrubbedClaim(claim: Claim, now: string): Claim {
  return { id: claim.id, date: claim.date, status: 'open', updatedAt: now, deletedAt: now }
}

/**
 * Verwijderen: een tombstone zonder notitie of bedrag; de uitgave en het bonnetje gaan mee weg. Een terugbetaling die al
 * binnen is, blijft staan (dat geld kwam echt binnen). Met ongedaan maken.
 */
export async function deleteClaim(store: Store, claim: Claim): Promise<Undo> {
  const original = store.list('claims.json.enc').find((c) => c.id === claim.id)
  if (!original) return async () => {}
  const doc = original.documentId ? store.list('documents/index.json.enc').find((d) => d.id === original.documentId) : undefined
  const cost = costOf(store, original.id)
  const now = new Date().toISOString()
  await store.put('claims.json.enc', scrubbedClaim(original, now))
  if (doc) await store.put('documents/index.json.enc', scrubbedDocument(doc, now))
  if (cost) await store.put('transactions.json.enc', { ...cost, updatedAt: now, deletedAt: now })
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.put('claims.json.enc', { ...original, updatedAt: later, deletedAt: null })
    if (doc) await store.put('documents/index.json.enc', { ...doc, updatedAt: later, deletedAt: null })
    if (cost) await store.put('transactions.json.enc', { ...cost, updatedAt: later, deletedAt: null })
    void store.sync()
  }
}

/** De declaraties van een trip, nieuwste eerst. */
export function tripClaims(claims: readonly Claim[], tripId: string): Claim[] {
  return active(claims)
    .filter((c) => c.tripId === tripId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Declaraties die aandacht vragen of geen trip hebben: niet terugbetaald, of zonder trip (anders alleen via de trip). */
export function claimsToShow(claims: readonly Claim[]): Claim[] {
  return active(claims)
    .filter((c) => c.status !== 'terugbetaald' || !c.tripId)
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
