import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { addClaim, claimCounts, deleteClaim, markRepaid, markSubmitted, openClaims, receiptFileName, tripClaims, updateClaim } from '../src/model/claims'
import { totals } from '../src/model/money'
import { positionAt } from '../src/model/position'
import type { Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Ronde 3 · PR 6: declaraties. Het bonnetje versleuteld in de kluis, de status open → ingediend → terugbetaald, de
// terugbetaling als inkomen van soort terugbetaling (in het saldo, niet verdiend), open declaraties met een bedrag als
// te ontvangen, en verwijderen zonder notitie of bedrag in de tombstone. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-declaraties-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_DECLARATIE_0123456789abcdefghijklmnopqrstuvw', new FakeGithub().fetch))
}

const trip: Trip = { id: 'trip-1', name: 'Nepweek', organisation: 'sailing-virgins', startDate: '2026-10-01', endDate: '2026-10-07', updatedAt: T0, deletedAt: null }
const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mime: 'image/jpeg' }

describe('declaraties', () => {
  it('bonnetje in de kluis (financieel, offline), declaratie open bij de trip; het bestand ontsleutelt weer', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip)
    const claim = await addClaim(s, { date: '2026-10-03', tripId: 'trip-1', note: 'Nepdiesel', amount: 42.5, currency: 'EUR' }, jpeg)
    expect(claim).toMatchObject({ status: 'open', tripId: 'trip-1', amount: 42.5, currency: 'EUR', note: 'Nepdiesel' })
    const doc = s.list('documents/index.json.enc').find((d) => d.id === claim.documentId)!
    expect(doc).toMatchObject({ category: 'financieel', offline: true, mime: 'image/jpeg' })
    // De naam in de kluis noemt de notitie niet.
    expect(doc.title).not.toContain('Nepdiesel')
    expect(await s.documentFile(doc.fileId)).toEqual(jpeg.bytes)
    expect(tripClaims(s.list('claims.json.enc'), 'trip-1').map((c) => c.id)).toEqual([claim.id])
    expect(receiptFileName('image/jpeg')).toBe('bonnetje.jpg')
  })

  it('ingediend, dan terugbetaald: een inkomen van soort terugbetaling, niet verdiend; een tweede tik boekt niets', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip)
    const claim = await addClaim(s, { date: '2026-10-03', tripId: 'trip-1', note: '', amount: 42.5, currency: 'EUR' }, null)
    await markSubmitted(s, claim, '2026-10-08')
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend', submittedAt: '2026-10-08' })
    // Open of ingediend met een bedrag: te ontvangen.
    expect(openClaims(s.list('claims.json.enc'))).toHaveLength(1)
    const input = { accounts: [], balances: [], trips: s.list('trips.json.enc'), legs: [], transactions: s.list('transactions.json.enc'), rates: null, claims: s.list('claims.json.enc') }
    expect(positionAt(input, '2026-10-10').totals.receivable.eur).toBe(42.5)
    const undo = await markRepaid(s, claim, { date: '2026-10-20', amount: 42.5, currency: 'EUR' })
    await markRepaid(s, claim, { date: '2026-10-20', amount: 42.5, currency: 'EUR' })
    const txs = s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ kind: 'terugbetaling', tripId: 'trip-1', source: 'sailing-virgins', amount: 42.5 })
    const sum = totals(txs)
    expect(sum.reimbursedEur).toBe(42.5)
    expect(sum.balanceEur).toBe(42.5)
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'terugbetaald', repaid: { date: '2026-10-20', amount: 42.5, transactionId: txs[0]!.id } })
    expect(openClaims(s.list('claims.json.enc'))).toHaveLength(0)
    expect(claimCounts(s.list('claims.json.enc'))).toEqual({ open: 0, ingediend: 0, terugbetaald: 1 })
    // Na de terugbetaling niet meer te ontvangen, ook niet in de positie van die dag.
    const after = { ...input, transactions: s.list('transactions.json.enc'), claims: s.list('claims.json.enc') }
    expect(positionAt(after, '2026-10-20').totals.receivable.eur).toBe(0)
    expect(positionAt(after, '2026-10-19').totals.receivable.eur).toBe(42.5)
    await undo()
    expect(s.list('transactions.json.enc').every((tx) => tx.deletedAt !== null)).toBe(true)
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend' })
  })

  it('bewerken houdt status en bonnetje; verwijderen laat geen notitie of bedrag achter en haalt het bonnetje uit de kluis', async () => {
    const s = await store()
    const claim = await addClaim(s, { date: '2026-10-03', tripId: null, note: 'Neptaxi', amount: 20, currency: 'USD' }, jpeg)
    await markSubmitted(s, claim, '2026-10-04')
    await updateClaim(s, claim, { date: '2026-10-02', tripId: null, note: 'Neptaxi naar haven', amount: 25, currency: 'USD' })
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend', documentId: claim.documentId, amount: 25, date: '2026-10-02' })
    const undo = await deleteClaim(s, s.list('claims.json.enc')[0]!)
    const gone = s.get('claims.json.enc')[0]!
    expect(gone.deletedAt).not.toBeNull()
    expect(gone.note).toBeUndefined()
    expect(gone.amount).toBeUndefined()
    expect(s.list('documents/index.json.enc')).toHaveLength(0)
    expect(s.get('documents/index.json.enc')[0]!.title).toBe('')
    await undo()
    expect(s.list('claims.json.enc')[0]).toMatchObject({ deletedAt: null, note: 'Neptaxi naar haven' })
    expect(s.list('documents/index.json.enc')[0]!.deletedAt).toBeNull()
  })
})
