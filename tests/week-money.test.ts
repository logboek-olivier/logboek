import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyMoneyStep, isEmptyStep } from '../src/model/week-money'
import { weekAfsluitenMetGeld } from '../src/domain/termijnen'
import type { Account, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'

// De geldstap van de weekafsluiting: de stand per rekening en ontvangen salaris in één keer, met één ongedaan maken voor
// alles. Het salaris is één loon-transactie per tocht met een status (src/domain/geldmodel.ts). Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-11-08'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-weekgeld-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_WEEKGELD_0123456789abcdefghijklmnopqrstuvwx', new FakeGithub().fetch))
}

const account: Account = { id: 'asn', name: 'Nep ASN', provider: 'asn', kind: 'betaal', currency: 'EUR', updatedAt: T0, deletedAt: null }
const trip = (id: string): Trip => ({ id, name: `Nep ${id}`, organisation: 'sailing-virgins', startDate: '2026-10-01', endDate: '2026-10-07', updatedAt: T0, deletedAt: null })
const salary = (tripId: string, extra: Partial<Transaction> = {}): Transaction => ({ id: `salaris:${tripId}`, date: '2026-10-07', kind: 'loon', amount: 1000, currency: 'EUR', source: 'sailing-virgins', tripId, status: 'verwacht', updatedAt: T0, deletedAt: null, ...extra })
const tip: Transaction = { id: 'c', date: '2026-11-02', kind: 'fooi', amount: 60, currency: 'EUR', source: 'sailing-virgins', updatedAt: T0, deletedAt: null }
const loon = (s: Store) => s.list('transactions.json.enc').filter((tx) => tx.kind === 'loon')

describe('geldstap van de weekafsluiting', () => {
  it('alles overslaan is leeg', () => {
    expect(isEmptyStep({ balances: [], received: [] })).toBe(true)
    expect(isEmptyStep({ balances: [], received: [trip('a')] })).toBe(false)
  })

  it('stand en ontvangen salaris in één keer; één ongedaan maken zet alles terug', async () => {
    const s = await store()
    await put(s, 'accounts.json.enc', account)
    await putMany(s, 'trips.json.enc', [trip('a'), trip('b')])
    await putMany(s, 'transactions.json.enc', [tip, salary('a'), salary('b')])
    // Zoals de weekafsluiting op Vandaag: de geldstap gaat mee met het afsluiten; ongedaan maken geldt voor de geldstap.
    const { undo, result: { skipped } } = await weekAfsluitenMetGeld(s, TODAY, { rating: null, lesson: '' }, { balances: [{ account, amount: 1500 }], received: [trip('a'), trip('b')] }, TODAY, null)
    expect(skipped).toEqual([])
    expect(s.list('balances.json.enc')).toEqual([expect.objectContaining({ accountId: 'asn', date: TODAY, amount: 1500 })])
    // Per tocht één salaris (geen tweede loon), op ontvangen, samen precies de uitbetaling.
    expect(loon(s)).toHaveLength(2)
    expect(loon(s).map((tx) => tx.status)).toEqual(['ontvangen', 'ontvangen'])
    expect(new Set(loon(s).map((tx) => tx.payoutId)).size).toBe(1)
    expect(loon(s).reduce((n, tx) => n + tx.amount, 0)).toBe(2000)
    await undo()
    expect(s.list('balances.json.enc')).toEqual([])
    expect(loon(s).map((tx) => tx.status)).toEqual(['verwacht', 'verwacht'])
    expect(loon(s).every((tx) => tx.payoutId === undefined)).toBe(true)
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'c')).toMatchObject({ amount: 60 })
  })

  it('zonder koers voor een uitbetaling in een andere valuta: die organisatie wordt overgeslagen, de rest gaat door', async () => {
    const s = await store()
    const usd = trip('u')
    await putMany(s, 'trips.json.enc', [trip('a'), usd])
    await putMany(s, 'transactions.json.enc', [salary('a'), salary('u', { amount: 900, currency: 'USD' })])
    const { skipped } = await inTx(s, applyMoneyStep, { balances: [], received: [trip('a'), usd] }, TODAY, null)
    expect(skipped).toEqual(['sailing-virgins'])
    expect(loon(s).map((tx) => tx.status)).toEqual(['verwacht', 'verwacht'])
  })
})
