import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyMoneyStep, isEmptyStep } from '../src/model/week-money'
import type { Account, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Ronde 3 · PR 7: de geldstap van de weekafsluiting. De stand per rekening, ontvangen salaris en gestorte contanten in
// één keer, met één ongedaan maken voor alles. Verzonnen data.

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
const trip = (id: string): Trip => ({ id, name: `Nep ${id}`, organisation: 'sailing-virgins', startDate: '2026-10-01', endDate: '2026-10-07', salary: { amount: 1000, currency: 'EUR', status: 'verwacht', source: 'standaard' }, updatedAt: T0, deletedAt: null })
const tip: Transaction = { id: 'c', date: '2026-11-02', kind: 'fooi', amount: 60, currency: 'EUR', source: 'sailing-virgins', tipVia: 'contant', updatedAt: T0, deletedAt: null }

describe('geldstap van de weekafsluiting', () => {
  it('alles overslaan is leeg', () => {
    expect(isEmptyStep({ balances: [], received: [], deposited: [] })).toBe(true)
  })

  it('stand, ontvangen salaris en gestorte contanten in één keer; één ongedaan maken zet alles terug', async () => {
    const s = await store()
    await s.put('accounts.json.enc', account)
    await s.putMany('trips.json.enc', [trip('a'), trip('b')])
    await s.put('transactions.json.enc', tip)
    const { undo, skipped } = await applyMoneyStep(s, { balances: [{ account, amount: 1500 }], received: [trip('a'), trip('b')], deposited: ['EUR'] }, TODAY, null)
    expect(skipped).toEqual([])
    expect(s.list('balances.json.enc')).toEqual([expect.objectContaining({ accountId: 'asn', date: TODAY, amount: 1500 })])
    const loon = s.list('transactions.json.enc').filter((tx) => tx.kind === 'loon')
    expect(loon).toHaveLength(2)
    expect(new Set(loon.map((tx) => tx.payoutId)).size).toBe(1)
    expect(loon.reduce((n, tx) => n + tx.amount, 0)).toBe(2000)
    expect(s.list('trips.json.enc').map((x) => x.salary!.status)).toEqual(['ontvangen', 'ontvangen'])
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'c')!.depositedAt).toBe(TODAY)
    await undo()
    expect(s.list('balances.json.enc')).toEqual([])
    expect(s.list('transactions.json.enc').filter((tx) => tx.kind === 'loon')).toEqual([])
    expect(s.list('trips.json.enc').map((x) => x.salary!.status)).toEqual(['verwacht', 'verwacht'])
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'c')!.depositedAt).toBeUndefined()
  })

  it('zonder koers voor een uitbetaling in een andere valuta: die organisatie wordt overgeslagen, de rest gaat door', async () => {
    const s = await store()
    const usd = { ...trip('u'), salary: { amount: 900, currency: 'USD' as const, status: 'verwacht' as const, source: 'eigen' as const } }
    await s.putMany('trips.json.enc', [trip('a'), usd])
    const { skipped } = await applyMoneyStep(s, { balances: [], received: [trip('a'), usd], deposited: [] }, TODAY, null)
    expect(skipped).toEqual(['sailing-virgins'])
    expect(s.list('transactions.json.enc')).toEqual([])
  })
})
