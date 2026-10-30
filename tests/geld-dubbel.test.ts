import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { addClaim, markRepaid } from '../src/model/claims'
import { recordPayout } from '../src/model/money-path'
import { positionAt } from '../src/model/position'
import { receiveSalary, salaryQuestions } from '../src/model/salary'
import type { Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Fundering: geld nooit dubbel. Een tweede tik, twee apparaten of de app die sluit tussen twee schrijfacties mogen een
// salaris, uitbetaling of terugbetaling nooit twee keer boeken, en wat al betaald is, telt niet meer als te ontvangen.
// Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(github = new FakeGithub()): Promise<Store> {
  return Store.open(await openLogboekDb(`logboek-geld-dubbel-${++counter}`), masterKey, new GithubClient('github_pat_DUBBEL_0123456789abcdefghijklmnopqrstuvwxy', github.fetch))
}

const trip = (id: string): Trip => ({
  id,
  name: `Nepweek ${id}`,
  organisation: 'sailing-virgins',
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  salary: { amount: 1000, currency: 'EUR', status: 'verwacht', source: 'standaard' },
  updatedAt: T0,
  deletedAt: null,
})
const loon = (s: Store) => s.list('transactions.json.enc').filter((tx) => tx.kind === 'loon')
const position = (s: Store, date: string) =>
  positionAt({ accounts: [], balances: [], trips: s.list('trips.json.enc'), legs: [], transactions: s.list('transactions.json.enc'), rates: null, claims: s.list('claims.json.enc') }, date)

describe('salaris en uitbetaling', () => {
  it('twee keer tegelijk "salaris ontvangen" boekt één inkomen', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('a'))
    const t = s.list('trips.json.enc')[0]!
    await Promise.all([receiveSalary(s, t, '2026-10-10', { amount: 950, currency: 'EUR' }), receiveSalary(s, t, '2026-10-10', { amount: 950, currency: 'EUR' })])
    expect(loon(s)).toHaveLength(1)
  })

  it('twee keer tegelijk dezelfde uitbetaling invoeren boekt per trip één inkomen', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a'), trip('b')])
    const trips = s.list('trips.json.enc')
    const payout = { org: 'sailing-virgins' as const, amount: 2000, currency: 'EUR' as const, date: '2026-11-01' }
    await Promise.all([recordPayout(s, payout, trips, null), recordPayout(s, payout, trips, null)])
    expect(loon(s).map((tx) => tx.tripId).sort()).toEqual(['a', 'b'])
  })

  it('op twee apparaten ontvangen (zonder sync ertussen) geeft na de sync één inkomen', async () => {
    const github = new FakeGithub()
    const laptop = await store(github)
    const phone = await store(github)
    await laptop.put('trips.json.enc', trip('a'))
    await laptop.sync()
    await phone.sync()
    await receiveSalary(laptop, laptop.list('trips.json.enc')[0]!, '2026-10-10')
    await receiveSalary(phone, phone.list('trips.json.enc')[0]!, '2026-10-11')
    await laptop.sync()
    await phone.sync()
    await laptop.sync()
    expect(loon(laptop)).toHaveLength(1)
    expect(loon(phone)).toHaveLength(1)
  })

  it('een salarisinkomen terwijl de status (op een ander apparaat) terugviel naar verwacht: niet opnieuw vragen of boeken, niet te ontvangen', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('a'))
    // Het inkomen staat er (bijvoorbeeld van de laptop), de trip zelf staat nog op verwacht.
    const income: Transaction = { id: 'loon-1', date: '2026-10-10', kind: 'loon', amount: 1000, currency: 'EUR', amountEur: 1000, source: 'sailing-virgins', tripId: 'a', updatedAt: T0, deletedAt: null }
    await s.put('transactions.json.enc', income)
    expect(salaryQuestions(s.list('trips.json.enc'), [], '2026-10-12', s.list('transactions.json.enc'))).toHaveLength(0)
    expect(position(s, '2026-10-12').totals.receivable.eur).toBe(0)
    await receiveSalary(s, s.list('trips.json.enc')[0]!, '2026-10-12')
    expect(loon(s)).toHaveLength(1)
    expect(s.list('trips.json.enc')[0]!.salary).toMatchObject({ status: 'ontvangen', transactionId: 'loon-1' })
  })
})

describe('terugbetaling van een declaratie', () => {
  it('twee keer tegelijk terugbetaald boekt één inkomen', async () => {
    const s = await store()
    const claim = await addClaim(s, { date: '2026-10-03', tripId: null, note: '', amount: 20, currency: 'EUR' }, null)
    await Promise.all([markRepaid(s, claim, { date: '2026-10-09', amount: 20, currency: 'EUR' }), markRepaid(s, claim, { date: '2026-10-09', amount: 20, currency: 'EUR' })])
    expect(s.list('transactions.json.enc').filter((tx) => tx.kind === 'terugbetaling')).toHaveLength(1)
  })

  it('app gesloten na het inkomen maar vóór de status: niet meer te ontvangen, en opnieuw invoeren boekt niets dubbel', async () => {
    const s = await store()
    const claim = await addClaim(s, { date: '2026-10-03', tripId: null, note: '', amount: 20, currency: 'EUR' }, null)
    // Nagebootst: het inkomen staat er, de declaratie zelf kwam niet meer op het apparaat (de app sloot ertussen).
    await s.put('transactions.json.enc', { id: 'tb-1', date: '2026-10-09', kind: 'terugbetaling', amount: 20, currency: 'EUR', amountEur: 20, source: 'overig', claimId: claim.id, updatedAt: new Date().toISOString(), deletedAt: null })
    expect(s.list('claims.json.enc')[0]!.status).toBe('open')
    expect(position(s, '2026-10-10').totals.receivable.eur).toBe(0)
    await markRepaid(s, s.list('claims.json.enc')[0]!, { date: '2026-10-09', amount: 20, currency: 'EUR' })
    expect(s.list('transactions.json.enc').filter((tx) => tx.kind === 'terugbetaling')).toHaveLength(1)
    expect(s.list('claims.json.enc')[0]!.status).toBe('terugbetaald')
  })
})
