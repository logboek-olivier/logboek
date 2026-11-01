import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { salaryState, tripResult } from '../src/model/money-path'
import { forecast, positionAt, type PositionInput } from '../src/model/position'
import type { RatesFile } from '../src/model/rates'
import { cleanSalary, countedSalary, salaryOutlook, salaryQuestions } from '../src/model/salary'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'
import { geenSalaris } from '../src/domain/geld'

// Salaris en geld per trip: een salaris van 0 en "Geen salaris" tellen nergens als verwacht of te ontvangen; een
// standaardbedrag op een trip zonder organisatie telt niet (alleen trips van die organisatie); het resultaat per trip is
// salaris + fooi + overige inkomsten − uitgaven, met openstaande declaraties apart. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-10-30'
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-09-01'], rates: { USD: [1.25] } }
const trip = (id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, startDate, endDate, updatedAt: T0, deletedAt: null, ...extra })
const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ id, date: '2026-10-10', kind: 'fooi', amount: 10, currency: 'EUR', amountEur: extra.amount ?? 10, source: 'overig', updatedAt: T0, deletedAt: null, ...extra })
const input = (extra: Partial<PositionInput>): PositionInput => ({ accounts: [], balances: [], trips: [], legs: [], transactions: [], rates: RATES, ...extra })
const standard = { amount: 2000, currency: 'USD' as const, status: 'verwacht' as const, source: 'standaard' as const }

describe('welk salaris meetelt', () => {
  it('niet bij "Geen salaris", niet bij 0 en niet bij een standaardbedrag zonder organisatie', () => {
    expect(countedSalary(trip('a', '2026-11-01', '2026-11-07', { salary: { amount: 0, currency: 'EUR', status: 'geen', source: 'eigen' } }))).toBeNull()
    expect(countedSalary(trip('b', '2026-11-01', '2026-11-07', { salary: { amount: 0, currency: 'EUR', status: 'verwacht', source: 'eigen' } }))).toBeNull()
    expect(countedSalary(trip('c', '2026-11-01', '2026-11-07', { salary: standard }))).toBeNull()
    expect(countedSalary(trip('d', '2026-11-01', '2026-11-07', { organisation: 'sailing-virgins', salary: standard }))).not.toBeNull()
    // Een eigen bedrag telt ook zonder organisatie (bijvoorbeeld een delivery).
    expect(countedSalary(trip('e', '2026-11-01', '2026-11-07', { salary: { ...standard, source: 'eigen' } }))).not.toBeNull()
  })

  it('een salaris van 0 blijft 0 bij opslaan; "Geen salaris" heeft altijd bedrag 0', () => {
    expect(cleanSalary({ amount: 0, currency: 'EUR', status: 'verwacht', source: 'eigen' }).amount).toBe(0)
    expect(cleanSalary({ amount: 500, currency: 'EUR', status: 'geen', source: 'eigen' }).amount).toBe(0)
  })

  it('de vooruitblik geeft trips zonder organisatie geen verwacht salaris (geen "Salaris geen organisatie")', () => {
    const trips = [
      trip('zonder', '2026-11-10', '2026-11-14', { salary: standard }),
      trip('sv', '2026-12-01', '2026-12-07', { organisation: 'sailing-virgins', salary: standard }),
      trip('geen', '2026-12-10', '2026-12-14', { organisation: 'yacht-week', salary: { amount: 0, currency: 'EUR', status: 'geen', source: 'eigen' } }),
    ]
    const f = forecast(input({ trips }), DEFAULT_SETTINGS, TODAY)
    const salaries = f.items.filter((i) => i.kind === 'salaris')
    expect(salaries.map((i) => i.trips.map((x) => x.id))).toEqual([['sv']])
    expect(salaries.every((i) => i.org)).toBe(true)
    expect(salaryOutlook(trips, [], [], TODAY, RATES).months.flatMap((m) => m.trips.map((x) => x.id))).toEqual(['sv'])
  })

  it('"Geen salaris" telt niet als te ontvangen, Vandaag vraagt er niet naar en de agenda toont geen bolletje', () => {
    const geen = trip('yw1', '2026-09-01', '2026-09-07', { organisation: 'yacht-week', salary: { amount: 0, currency: 'EUR', status: 'geen', source: 'eigen' } })
    expect(positionAt(input({ trips: [geen] }), TODAY).receivable).toEqual([])
    expect(salaryQuestions([geen], [], TODAY)).toEqual([])
    expect(salaryState(geen, [], TODAY)).toBeNull()
  })
})

describe('"Geen salaris" kiezen', () => {
  let masterKey: CryptoKey
  beforeAll(async () => {
    masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  })

  it('zet de status op geen, en ongedaan maken zet het verwachte salaris terug; een ontvangen salaris blijft', async () => {
    const store = await Store.open(await openLogboekDb('logboek-geen-salaris'), masterKey, new GithubClient('github_pat_GEEN_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
    const t = trip('yw1', '2026-09-01', '2026-09-07', { organisation: 'yacht-week', salary: { amount: 600, currency: 'EUR', status: 'verwacht', source: 'eigen' } })
    await put(store, 'trips.json.enc', t)
    const undo = await geenSalaris(store, t)
    expect(store.list('trips.json.enc')[0]!.salary).toMatchObject({ status: 'geen', amount: 0 })
    expect(positionAt(input({ trips: store.list('trips.json.enc') }), TODAY).receivable).toEqual([])
    await undo()
    expect(store.list('trips.json.enc')[0]!.salary).toMatchObject({ status: 'verwacht', amount: 600 })
    const received = { ...store.list('trips.json.enc')[0]!, salary: { amount: 600, currency: 'EUR' as const, status: 'ontvangen' as const, source: 'eigen' as const, transactionId: 'x' }, updatedAt: new Date().toISOString() }
    await put(store, 'trips.json.enc', received)
    await geenSalaris(store, received)
    expect(store.list('trips.json.enc')[0]!.salary?.status).toBe('ontvangen')
  })
})

describe('resultaat per trip', () => {
  it('salaris + fooi + overige inkomsten − uitgaven; kan negatief zijn; openstaande declaraties apart', () => {
    const t = trip('t', '2026-10-01', '2026-10-07', { organisation: 'sailing-virgins', salary: { amount: 500, currency: 'EUR', status: 'verwacht', source: 'eigen' } })
    const transactions = [
      tx('fooi', { tripId: 't', kind: 'fooi', amount: 100 }),
      tx('bonus', { tripId: 't', kind: 'bonus', amount: 50 }),
      tx('vlucht', { tripId: 't', kind: 'kosten', amount: 900 }),
      tx('open', { tripId: 't', kind: 'kosten', amount: 40, claimId: 'd1' }),
      tx('terug-kosten', { tripId: 't', kind: 'kosten', amount: 30, claimId: 'd2' }),
      tx('terug', { tripId: 't', kind: 'terugbetaling', amount: 30, claimId: 'd2' }),
      tx('ander', { tripId: 'ander', kind: 'kosten', amount: 1000 }),
    ]
    const r = tripResult(t, [], transactions, RATES)
    expect(r.salaryExpected).toBe(true)
    expect(r.salary.eur).toBe(500)
    expect(r.tips.eur).toBe(100)
    expect(r.otherIncome.eur).toBe(80)
    expect(r.costs.eur).toBe(930)
    expect(r.openClaims.eur).toBe(40)
    expect(r.result.eur).toBe(500 + 100 + 80 - 930)
    // Ontvangen salaris: het inkomen telt, niet nog eens het verwachte bedrag.
    const paid = tripResult({ ...t, salary: { ...t.salary!, status: 'ontvangen', transactionId: 'loon' } }, [], [...transactions, tx('loon', { tripId: 't', kind: 'loon', amount: 480 })], RATES)
    expect(paid.salaryExpected).toBe(false)
    expect(paid.salary.eur).toBe(480)
  })
})
