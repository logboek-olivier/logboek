import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  cashOnHand,
  depositCash,
  expectedPayout,
  payoutQuestions,
  payoutRule,
  payoutSuggestion,
  recordPayout,
  salaryState,
  splitPayout,
  tripMoney,
} from '../src/model/money-path'
import type { RatesFile } from '../src/model/rates'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Settings, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Ronde 3 · PR 3: het geldpad per trip. Salaris verwacht, te ontvangen of ontvangen; een uitbetaling per organisatie
// vinkt de trips in één keer af (per trip een eigen inkomen); contante fooien staan in Contant tot ze gestort zijn.
// Een eigen of ontvangen salaris wordt nooit vanzelf overschreven. Verzonnen data.

const TOKEN = 'github_pat_GELDPAD_0123456789abcdefghijklmnopqrstuvwxyzA'
const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-geldpad-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const trip = (id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({
  id,
  name: `Nep ${id}`,
  startDate,
  endDate,
  organisation: 'sailing-virgins',
  salary: { amount: 1000, currency: 'EUR', status: 'verwacht', source: 'standaard' },
  updatedAt: T0,
  deletedAt: null,
  ...extra,
})
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra })
const tip = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date: '2026-10-10', kind: 'fooi', amount: 50, currency: 'EUR', source: 'sailing-virgins', updatedAt: T0, deletedAt: null, ...extra })
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-10-01'], rates: { USD: [1.1] } }

describe('salaris per trip: verwacht, te ontvangen, ontvangen', () => {
  it('volgt de einddatum en de status', () => {
    expect(salaryState(trip('a', '2026-11-01', '2026-11-07'), [], '2026-10-30')).toBe('verwacht')
    expect(salaryState(trip('a', '2026-10-25', '2026-11-02'), [], '2026-10-30')).toBe('verwacht')
    expect(salaryState(trip('a', '2026-10-01', '2026-10-07'), [], '2026-10-30')).toBe('te-ontvangen')
    expect(salaryState(trip('a', '2026-10-01', '2026-10-07', { salary: { amount: 1, currency: 'EUR', status: 'ontvangen', source: 'eigen' } }), [], '2026-10-30')).toBe('ontvangen')
    expect(salaryState(trip('a', '2026-10-01', '2026-10-07', { salary: undefined }), [], '2026-10-30')).toBeNull()
  })
})

describe('uitbetaling per organisatie', () => {
  it('zonder instelling na elke trip; maandelijks alleen met een dag van 1 tot 28', () => {
    expect(payoutRule(settings(), 'sailing-virgins')).toEqual({ kind: 'per-trip' })
    expect(payoutRule(settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } }), 'sailing-virgins')).toEqual({ kind: 'maandelijks', day: 5 })
    expect(payoutRule(settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 40 } } }), 'sailing-virgins')).toEqual({ kind: 'per-trip' })
  })

  it('voorstel: na elke trip de oudste open trip; maandelijks de trips van vóór de maand van de uitbetaling', () => {
    const trips = [trip('sep', '2026-09-20', '2026-09-26'), trip('okt1', '2026-10-01', '2026-10-07'), trip('okt2', '2026-10-15', '2026-10-21'), trip('nov', '2026-11-01', '2026-11-03'), trip('yw', '2026-10-01', '2026-10-07', { organisation: 'yacht-week' })]
    expect(payoutSuggestion(trips, [], settings(), 'sailing-virgins', '2026-11-05').map((x) => x.id)).toEqual(['sep'])
    const monthly = settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } })
    expect(payoutSuggestion(trips, [], monthly, 'sailing-virgins', '2026-11-05').map((x) => x.id)).toEqual(['sep', 'okt1', 'okt2'])
  })

  it('verwacht bedrag in de valuta van de uitbetaling, en verdeeld naar verhouding (de delen zijn samen precies het bedrag)', () => {
    const trips = [trip('a', '2026-10-01', '2026-10-07'), trip('b', '2026-10-08', '2026-10-14', { salary: { amount: 2000, currency: 'EUR', status: 'verwacht', source: 'eigen' } })]
    expect(expectedPayout(trips, [], 'EUR', '2026-11-05', null)).toBe(3000)
    expect(expectedPayout(trips, [], 'USD', '2026-11-05', null)).toBeNull()
    expect(expectedPayout(trips, [], 'USD', '2026-11-05', RATES)).toBe(3300)
    expect(splitPayout(2900, trips, [], 'EUR', '2026-11-05', null)).toEqual([966.67, 1933.33])
    expect(splitPayout(100, trips, [], 'USD', '2026-11-05', null)).toEqual([50, 50])
  })

  it('een uitbetaling invoeren vinkt de trips af, met per trip een eigen inkomen; ongedaan maken zet alles terug', async () => {
    const s = await store()
    const a = trip('a', '2026-10-01', '2026-10-07', { salary: { amount: 1000, currency: 'EUR', status: 'verwacht', source: 'eigen', askAfter: '2026-11-01' } })
    const b = trip('b', '2026-10-15', '2026-10-21')
    await s.putMany('trips.json.enc', [a, b])
    const undo = await recordPayout(s, { org: 'sailing-virgins', amount: 1950, currency: 'EUR', date: '2026-11-05' }, [a, b], null)
    const txs = s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)
    expect(txs.map((tx) => [tx.tripId, tx.amount, tx.kind, tx.date])).toEqual(expect.arrayContaining([['a', 975, 'loon', '2026-11-05'], ['b', 975, 'loon', '2026-11-05']]))
    expect(new Set(txs.map((tx) => tx.payoutId)).size).toBe(1)
    for (const id of ['a', 'b']) {
      const x = s.list('trips.json.enc').find((t) => t.id === id)!
      expect(x.salary).toMatchObject({ status: 'ontvangen', transactionId: txs.find((tx) => tx.tripId === id)!.id })
      expect(x.salary!.askAfter).toBeUndefined()
    }
    // Het eigen bedrag blijft staan, ook na ontvangen.
    expect(s.list('trips.json.enc').find((t) => t.id === 'a')!.salary).toMatchObject({ amount: 1000, source: 'eigen' })
    await undo()
    expect(s.list('transactions.json.enc').every((tx) => tx.deletedAt !== null)).toBe(true)
    expect(s.list('trips.json.enc').map((t) => t.salary!.status)).toEqual(['verwacht', 'verwacht'])
  })

  it('Vandaag vraagt bij maandelijks pas vanaf dag N, voor de trips van de vorige maand en wat nog openstond', () => {
    const trips = [trip('sep', '2026-09-20', '2026-09-26'), trip('okt', '2026-10-01', '2026-10-07'), trip('nov', '2026-11-01', '2026-11-03'), trip('later', '2026-10-02', '2026-10-08', { salary: { amount: 1, currency: 'EUR', status: 'verwacht', source: 'eigen', askAfter: '2026-11-20' } })]
    const monthly = settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } })
    expect(payoutQuestions(trips, [], monthly, '2026-11-04')).toEqual([{ org: 'sailing-virgins', month: '2026-09', trips: [trips[0]] }])
    expect(payoutQuestions(trips, [], monthly, '2026-11-05')).toEqual([{ org: 'sailing-virgins', month: '2026-10', trips: [trips[0], trips[1]] }])
    expect(payoutQuestions(trips, [], settings(), '2026-11-05')).toEqual([])
  })
})

describe('contant', () => {
  it('contante fooien per valuta tot ze gestort zijn; gestort haalt ze uit Contant, met ongedaan maken', async () => {
    const s = await store()
    await s.putMany('transactions.json.enc', [tip('c1', { tipVia: 'contant' }), tip('c2', { tipVia: 'contant', currency: 'USD', amount: 20 }), tip('b1', { tipVia: 'bank' }), tip('u1')])
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ EUR: 50, USD: 20 })
    const undo = await depositCash(s, 'EUR', '2026-10-30')
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ USD: 20 })
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'c1')!.depositedAt).toBe('2026-10-30')
    await undo()
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ EUR: 50, USD: 20 })
  })

  it('het geldpad van een trip: salaris met status en fooi naar contant, bank en onbekend', () => {
    const x = trip('t', '2026-10-01', '2026-10-07')
    const money = tripMoney(x, [], [tip('c', { tripId: 't', tipVia: 'contant' }), tip('b', { tripId: 't', tipVia: 'bank', amount: 30 }), tip('u', { tripId: 't', currency: 'USD', amount: 10 }), tip('ander', { tripId: 'x' })], '2026-10-30')
    expect(money.salary).toEqual({ state: 'te-ontvangen', amount: 1000, currency: 'EUR' })
    expect(money.tips.contant.eur).toBe(50)
    expect(money.tips.bank.eur).toBe(30)
    expect(money.tips.onbekend).toEqual({ eur: 0, other: { USD: 10 } })
  })
})
