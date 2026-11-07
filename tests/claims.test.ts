import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { addClaim, claimCounts, claimOverview, claimPeople, claimsToShow, openClaims, openDebts, paymentIdOf, receiptFileName, setClaimTrip, tripClaims } from '../src/model/claims'
import { dayAverages } from '../src/model/costs'
import { buildIndex } from '../src/model/calendar'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import { totals } from '../src/model/money'
import { positionAt } from '../src/model/position'
import type { Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'
import { declaratieBewerken, declaratieIngediend, declaratieTerugbetaald, declaratieVerwijderen } from '../src/domain/geld'
import { periodeVerwijderen } from '../src/domain/trips'

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
    await put(s, 'trips.json.enc', trip)
    const claim = await inTx(s, addClaim, { date: '2026-10-03', tripId: 'trip-1', note: 'Nepdiesel', amount: 42.5, currency: 'EUR' }, jpeg)
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
    await put(s, 'trips.json.enc', trip)
    const claim = await inTx(s, addClaim, { date: '2026-10-03', tripId: 'trip-1', note: '', amount: 42.5, currency: 'EUR' }, null)
    await declaratieIngediend(s, claim, '2026-10-08')
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend', submittedAt: '2026-10-08' })
    // Open of ingediend met een bedrag: te ontvangen.
    expect(openClaims(s.list('claims.json.enc'))).toHaveLength(1)
    const input = { accounts: [], balances: [], trips: s.list('trips.json.enc'), legs: [], transactions: s.list('transactions.json.enc'), rates: null, claims: s.list('claims.json.enc') }
    expect(positionAt(input, '2026-10-10').totals.receivable.eur).toBe(42.5)
    const undo = await declaratieTerugbetaald(s, claim, { date: '2026-10-20', amount: 42.5, currency: 'EUR' })
    await declaratieTerugbetaald(s, claim, { date: '2026-10-20', amount: 42.5, currency: 'EUR' })
    const txs = s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)
    // De uitgave (bij het aanmaken) en de terugbetaling: samen nul in het saldo, niet verdiend.
    expect(txs.map((tx) => tx.kind).sort()).toEqual(['kosten', 'terugbetaling'])
    const repaidTx = txs.find((tx) => tx.kind === 'terugbetaling')!
    expect(repaidTx).toMatchObject({ tripId: 'trip-1', source: 'sailing-virgins', amount: 42.5, claimId: claim.id })
    const sum = totals(txs)
    expect(sum.reimbursedEur).toBe(42.5)
    expect(sum.costsEur).toBe(42.5)
    expect(sum.balanceEur).toBe(0)
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'terugbetaald', repaid: { date: '2026-10-20', amount: 42.5, transactionId: repaidTx.id } })
    expect(openClaims(s.list('claims.json.enc'))).toHaveLength(0)
    expect(claimCounts(s.list('claims.json.enc'))).toEqual({ open: 0, ingediend: 0, terugbetaald: 1 })
    // Na de terugbetaling niet meer te ontvangen, ook niet in de positie van die dag.
    const after = { ...input, transactions: s.list('transactions.json.enc'), claims: s.list('claims.json.enc') }
    expect(positionAt(after, '2026-10-20').totals.receivable.eur).toBe(0)
    expect(positionAt(after, '2026-10-19').totals.receivable.eur).toBe(42.5)
    await undo()
    expect(s.list('transactions.json.enc').map((tx) => tx.kind)).toEqual(['kosten'])
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend' })
  })

  it('bewerken houdt status en bonnetje; verwijderen laat geen notitie of bedrag achter en haalt het bonnetje uit de kluis', async () => {
    const s = await store()
    const claim = await inTx(s, addClaim, { date: '2026-10-03', tripId: null, note: 'Neptaxi', amount: 20, currency: 'USD' }, jpeg)
    await declaratieIngediend(s, claim, '2026-10-04')
    await declaratieBewerken(s, claim, { date: '2026-10-02', tripId: null, note: 'Neptaxi naar haven', amount: 25, currency: 'USD' })
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend', documentId: claim.documentId, amount: 25, date: '2026-10-02' })
    // De uitgave volgt het bedrag; het bonnetje in de kluis de datum.
    expect(s.list('transactions.json.enc')).toEqual([expect.objectContaining({ kind: 'kosten', amount: 25, currency: 'USD', claimId: claim.id })])
    expect(s.list('documents/index.json.enc')[0]).toMatchObject({ issuedAt: '2026-10-02' })
    const undo = await declaratieVerwijderen(s, s.list('claims.json.enc')[0]!)
    // Een tweede tik op verwijderen doet niets (en raakt het bonnetje niet kwijt bij ongedaan maken).
    await declaratieVerwijderen(s, claim)
    expect(s.list('transactions.json.enc')).toEqual([])
    const gone = s.get('claims.json.enc')[0]!
    expect(gone.deletedAt).not.toBeNull()
    expect(gone.note).toBeUndefined()
    expect(gone.amount).toBeUndefined()
    expect(s.list('documents/index.json.enc')).toHaveLength(0)
    expect(s.get('documents/index.json.enc')[0]!.title).toBe('')
    await undo()
    expect(s.list('claims.json.enc')[0]).toMatchObject({ deletedAt: null, note: 'Neptaxi naar haven' })
    expect(s.list('documents/index.json.enc')[0]!.deletedAt).toBeNull()
    expect(s.list('transactions.json.enc')).toHaveLength(1)
    // Zonder trip: te zien onder Geld → Declaraties.
    expect(claimsToShow(s.list('claims.json.enc')).map((c) => c.id)).toEqual([claim.id])
  })

  it('bij een trip met alles naar de prullenbak gaan de declaraties mee weg met het bonnetje; ongedaan maken zet ze terug', async () => {
    const s = await store()
    const other: Trip = { ...trip, id: 'trip-2', name: 'Nepweek twee', startDate: '2026-10-05', endDate: '2026-10-11' }
    await putMany(s, 'trips.json.enc', [trip, other])
    const claim = await inTx(s, addClaim, { date: '2026-10-08', tripId: 'trip-2', note: 'Nephaven', amount: 10, currency: 'EUR' }, jpeg)
    const undo = await periodeVerwijderen(s, s.list('trips.json.enc').find((x) => x.id === 'trip-2')!, 'alles')
    expect(s.list('claims.json.enc')).toEqual([])
    expect(s.get('claims.json.enc')[0]!.note).toBeUndefined()
    expect(s.list('documents/index.json.enc')).toEqual([])
    await undo()
    expect(s.list('claims.json.enc').map((c) => c.id)).toEqual([claim.id])
    expect(s.list('documents/index.json.enc')).toHaveLength(1)
  })

  it('een gedeclareerde uitgave telt niet mee in het gemiddelde van de losse uitgaven', async () => {
    const s = await store()
    await inTx(s, addClaim, { date: '2026-10-03', tripId: null, note: '', amount: 500, currency: 'EUR' }, null)
    const a = dayAverages(s.list('transactions.json.enc'), buildIndex([], [], []), '2026-10-30', DEFAULT_SETTINGS)
    expect(a.thuis.source).toBe('onbekend')
  })
})

describe('voorgeschoten en schulden bij vrienden', () => {
  const position = (s: Store, date: string) =>
    positionAt({ accounts: [], balances: [], trips: s.list('trips.json.enc'), legs: [], transactions: s.list('transactions.json.enc'), rates: null, claims: s.list('claims.json.enc') }, date)

  it('voorgeschoten voor een vriend: uitgave nu, te ontvangen, terugbetaald op nul; alleen de voornaam', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip)
    const claim = await inTx(s, addClaim, { kind: 'voorgeschoten', person: 'Nepgaspar Achternaam', date: '2026-10-03', tripId: 'trip-1', note: 'Nepbier', amount: 71, currency: 'EUR' }, null)
    expect(claim).toMatchObject({ kind: 'voorgeschoten', person: 'Nepgaspar', status: 'open' })
    expect(s.list('transactions.json.enc')).toEqual([expect.objectContaining({ kind: 'kosten', amount: 71, claimId: claim.id })])
    expect(position(s, '2026-10-05').totals.receivable.eur).toBe(71)
    // Geen "ingediend" bij een vriend.
    await declaratieIngediend(s, claim, '2026-10-04')
    expect(s.list('claims.json.enc')[0]!.status).toBe('open')
    await declaratieTerugbetaald(s, claim, { date: '2026-10-09', amount: 71, currency: 'EUR' })
    expect(totals(s.list('transactions.json.enc')).balanceEur).toBe(0)
    expect(position(s, '2026-10-10').totals.receivable.eur).toBe(0)
    expect(claimPeople(s.list('claims.json.enc'))).toEqual(['Nepgaspar'])
  })

  it('schuld aan een vriend: geen uitgave tot betalen, te betalen in Mijn positie, betalen = een gewone uitgave op die dag', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip)
    const debt = await inTx(s, addClaim, { kind: 'schuld', person: 'Nepjoep', date: '2026-10-04', tripId: 'trip-1', note: 'Nepdiner', amount: 30, currency: 'EUR' }, null)
    expect(s.list('transactions.json.enc')).toEqual([])
    expect(openDebts(s.list('claims.json.enc')).map((c) => c.id)).toEqual([debt.id])
    expect(openClaims(s.list('claims.json.enc'))).toEqual([])
    expect(position(s, '2026-10-05')).toMatchObject({ owed: [expect.objectContaining({ id: debt.id })], totals: { receivable: { eur: -30 } } })
    // De trip later wijzigen houdt het een schuld.
    await inTx(s, setClaimTrip, debt, null)
    expect(s.list('claims.json.enc')[0]).toMatchObject({ kind: 'schuld', person: 'Nepjoep' })
    const undo = await declaratieTerugbetaald(s, debt, { date: '2026-10-12', amount: 30, currency: 'EUR' })
    await declaratieTerugbetaald(s, debt, { date: '2026-10-12', amount: 30, currency: 'EUR' })
    const txs = s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)
    // Eén uitgave, zonder claimId: dat geld komt niet terug (telt dus gewoon als kosten en in het gemiddelde).
    expect(txs).toEqual([expect.objectContaining({ id: paymentIdOf(debt.id), kind: 'kosten', date: '2026-10-12', amount: 30 })])
    expect(txs[0]!.claimId).toBeUndefined()
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'terugbetaald', repaid: { date: '2026-10-12', amount: 30, transactionId: paymentIdOf(debt.id) } })
    expect(position(s, '2026-10-11').totals.receivable.eur).toBe(-30)
    expect(position(s, '2026-10-12').totals.receivable.eur).toBe(0)
    await undo()
    expect(s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)).toEqual([])
    expect(s.list('claims.json.enc')[0]!.status).toBe('open')
  })

  it('overzicht per persoon: te ontvangen (declaraties samen) en te betalen, per valuta; dezelfde voornaam is dezelfde persoon', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip)
    await inTx(s, addClaim, { date: '2026-10-01', tripId: 'trip-1', note: '', amount: 10, currency: 'EUR' }, null)
    await inTx(s, addClaim, { kind: 'voorgeschoten', person: 'Nepgaspar', date: '2026-10-02', tripId: 'trip-1', note: '', amount: 71, currency: 'USD' }, null)
    await inTx(s, addClaim, { kind: 'voorgeschoten', person: 'nepgaspar', date: '2026-10-03', tripId: 'trip-1', note: '', amount: 9, currency: 'USD' }, null)
    await inTx(s, addClaim, { kind: 'schuld', person: 'Nepjoep', date: '2026-10-04', tripId: 'trip-1', note: '', amount: 20, currency: 'EUR' }, null)
    expect(claimOverview(s.list('claims.json.enc'))).toEqual({
      receivable: [
        { person: null, sums: { EUR: 10 }, count: 1 },
        // De laatste schrijfwijze (3 oktober) is de naam.
        { person: 'nepgaspar', sums: { USD: 80 }, count: 2 },
      ],
      payable: [{ person: 'Nepjoep', sums: { EUR: 20 }, count: 1 }],
    })
  })

  it('een declaratie van vóór deze versie (zonder soort) blijft een declaratie; bewerken laat haar zonder soort', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip)
    const claim = await inTx(s, addClaim, { date: '2026-10-03', tripId: 'trip-1', note: 'Nep', amount: 5, currency: 'EUR' }, null)
    expect(claim.kind).toBeUndefined()
    await declaratieBewerken(s, claim, { date: '2026-10-03', tripId: 'trip-1', note: 'Nep 2', amount: 5, currency: 'EUR' })
    const after = s.list('claims.json.enc')[0]!
    expect(after.kind).toBeUndefined()
    expect(after.person).toBeUndefined()
  })
})
