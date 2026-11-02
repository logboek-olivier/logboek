import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { salaryOf, salaryState } from '../src/domain/geldmodel'
import { tripResult } from '../src/domain/geldrapport'
import { expectedSalary } from '../src/model/money-path'
import { forecast, positionAt, type PositionInput } from '../src/model/position'
import { setRates, type RatesFile } from '../src/model/rates'
import { salaryOutlook, salaryQuestions } from '../src/model/salary'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'
import { geenSalaris } from '../src/domain/geld'
import { saveSalary } from '../src/model/salary'

// Salaris en geld per tocht: het salaris is één loon-transactie met een status (src/domain/geldmodel.ts). Een salaris
// van 0 en "Geen salaris" tellen nergens als verwacht of te ontvangen; het resultaat per tocht is de som van zijn
// transacties (salaris + fooi + overige inkomsten − uitgaven), met openstaande declaraties ter informatie. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-10-30'
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-09-01'], rates: { USD: [1.25] } }
const trip = (id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, startDate, endDate, updatedAt: T0, deletedAt: null, ...extra })
const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ id, date: '2026-10-10', kind: 'fooi', amount: 10, currency: 'EUR', amountEur: extra.amount ?? 10, source: 'overig', updatedAt: T0, deletedAt: null, ...extra })
/** Het salaris van een tocht als loon-transactie (zonder opgeslagen koers: een verwacht salaris is nog geen geld). */
const salary = (tripId: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id: `salaris:${tripId}`, date, kind: 'loon', amount: 2000, currency: 'USD', source: 'overig', tripId, status: 'verwacht', updatedAt: T0, deletedAt: null, ...extra })
const input = (extra: Partial<PositionInput>): PositionInput => ({ accounts: [], balances: [], trips: [], legs: [], transactions: [], rates: RATES, ...extra })

afterEach(() => setRates(null))

describe('welk salaris meetelt', () => {
  it('alleen een verwacht salaris met een bedrag; niet bij "Geen salaris" of 0', () => {
    const t = trip('a', '2026-11-01', '2026-11-07')
    expect(expectedSalary(t, [salary('a', '2026-11-07', { amount: 0, status: 'geen' })])).toBeUndefined()
    expect(expectedSalary(t, [salary('a', '2026-11-07', { amount: 0 })])).toBeUndefined()
    expect(expectedSalary(t, [salary('a', '2026-11-07', { status: 'ontvangen' })])).toBeUndefined()
    expect(expectedSalary(t, [salary('a', '2026-11-07')])).toMatchObject({ amount: 2000 })
  })

  it('de vooruitblik toont alleen verwachte salarissen met een bedrag', () => {
    const trips = [
      trip('nul', '2026-11-10', '2026-11-14', { organisation: 'sailing-virgins' }),
      trip('sv', '2026-12-01', '2026-12-07', { organisation: 'sailing-virgins' }),
      trip('geen', '2026-12-10', '2026-12-14', { organisation: 'yacht-week' }),
    ]
    const transactions = [salary('nul', '2026-11-14', { amount: 0 }), salary('sv', '2026-12-07'), salary('geen', '2026-12-14', { amount: 0, currency: 'EUR', status: 'geen' })]
    // De koersen zoals de app ze geladen heeft (getRates), dezelfde als in de invoer.
    setRates(RATES)
    const f = forecast(input({ trips, transactions }), DEFAULT_SETTINGS, TODAY)
    const salaries = f.items.filter((i) => i.kind === 'salaris')
    expect(salaries.map((i) => i.trips.map((x) => x.id))).toEqual([['sv']])
    expect(salaries.every((i) => i.org)).toBe(true)
    // 2000 USD tegen 1,25 = € 1600.
    expect(salaries[0]!.eur).toBe(1600)
    expect(salaryOutlook(trips, [], transactions, TODAY, RATES).months.flatMap((m) => m.trips.map((x) => x.id))).toEqual(['sv'])
  })

  it('"Geen salaris" telt niet als te ontvangen, Vandaag vraagt er niet naar en de agenda toont geen bolletje', () => {
    const geen = trip('yw1', '2026-09-01', '2026-09-07', { organisation: 'yacht-week' })
    const transactions = [salary('yw1', '2026-09-07', { amount: 0, currency: 'EUR', status: 'geen' })]
    expect(positionAt(input({ trips: [geen], transactions }), TODAY).receivable).toEqual([])
    expect(salaryQuestions([geen], [], TODAY, transactions)).toEqual([])
    expect(salaryState(transactions[0]!, geen, geen.endDate!, TODAY)).toBeNull()
  })
})

describe('salaris kiezen en opslaan', () => {
  let masterKey: CryptoKey
  let counter = 0
  beforeAll(async () => {
    masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  })
  const open = async () => Store.open(await openLogboekDb(`logboek-geen-salaris-${++counter}`), masterKey, new GithubClient('github_pat_GEEN_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))

  it('"Geen salaris" zet de status op geen, en ongedaan maken zet het verwachte salaris terug; een ontvangen salaris blijft', async () => {
    const store = await open()
    const t = trip('yw1', '2026-09-01', '2026-09-07', { organisation: 'yacht-week' })
    await put(store, 'trips.json.enc', t)
    await put(store, 'transactions.json.enc', salary('yw1', '2026-09-07', { amount: 600, currency: 'EUR' }))
    const undo = await geenSalaris(store, 'yw1')
    expect(salaryOf('yw1', store.list('transactions.json.enc'))).toMatchObject({ status: 'geen', amount: 0 })
    expect(positionAt(input({ trips: store.list('trips.json.enc'), transactions: store.list('transactions.json.enc') }), TODAY).receivable).toEqual([])
    await undo()
    expect(salaryOf('yw1', store.list('transactions.json.enc'))).toMatchObject({ status: 'verwacht', amount: 600 })
    await put(store, 'transactions.json.enc', { ...salaryOf('yw1', store.list('transactions.json.enc'))!, status: 'ontvangen', updatedAt: new Date().toISOString() })
    await geenSalaris(store, 'yw1')
    expect(salaryOf('yw1', store.list('transactions.json.enc'))).toMatchObject({ status: 'ontvangen', amount: 600 })
  })

  it('een salaris van 0 blijft 0; "Geen salaris" heeft altijd bedrag 0; ontvangen kan alleen met een bedrag; nooit een tweede salaris', async () => {
    const store = await open()
    await putMany(store, 'trips.json.enc', [trip('a', '2026-09-01', '2026-09-07'), trip('b', '2026-09-08', '2026-09-14')])
    await inTx(store, saveSalary, 'a', { amount: 0, currency: 'EUR', status: 'verwacht' })
    expect(salaryOf('a', store.list('transactions.json.enc'))).toMatchObject({ amount: 0, status: 'verwacht' })
    await inTx(store, saveSalary, 'b', { amount: 500, currency: 'EUR', status: 'geen' })
    expect(salaryOf('b', store.list('transactions.json.enc'))).toMatchObject({ amount: 0, status: 'geen' })
    await expect(inTx(store, saveSalary, 'a', { amount: 0, currency: 'EUR', status: 'ontvangen' })).rejects.toThrow()
    // Opslaan werkt het bestaande salaris bij: één loon per tocht, met het vaste id.
    await inTx(store, saveSalary, 'a', { amount: 900, currency: 'EUR', status: 'ontvangen', date: '2026-09-10' })
    const loon = store.list('transactions.json.enc').filter((x) => x.tripId === 'a')
    expect(loon).toHaveLength(1)
    expect(loon[0]).toMatchObject({ id: 'salaris:a', amount: 900, status: 'ontvangen', date: '2026-09-10', amountEur: 900 })
  })
})

describe('resultaat per tocht', () => {
  it('de som van de transacties van de tocht: salaris + fooi + overige inkomsten − uitgaven; kan negatief zijn', () => {
    const t = trip('t', '2026-10-01', '2026-10-07', { organisation: 'sailing-virgins' })
    const transactions = [
      salary('t', '2026-10-07', { amount: 500, currency: 'EUR' }),
      tx('fooi', { tripId: 't', kind: 'fooi', amount: 100 }),
      tx('bonus', { tripId: 't', kind: 'bonus', amount: 50 }),
      tx('vlucht', { tripId: 't', kind: 'kosten', amount: 900 }),
      tx('open', { tripId: 't', kind: 'kosten', amount: 40, claimId: 'd1' }),
      tx('terug-kosten', { tripId: 't', kind: 'kosten', amount: 30, claimId: 'd2' }),
      tx('terug', { tripId: 't', kind: 'terugbetaling', amount: 30, claimId: 'd2' }),
      tx('ander', { tripId: 'ander', kind: 'kosten', amount: 1000 }),
    ]
    const r = tripResult(t, transactions)
    expect(r.salaryExpected).toBe(true)
    expect(r.salary.eur).toBe(500)
    expect(r.tips.eur).toBe(100)
    expect(r.otherIncome.eur).toBe(80)
    // Alle uitgaven tellen; een declaratie die nog niet terugbetaald is, staat er ter informatie bij.
    expect(r.costs.eur).toBe(970)
    expect(r.openClaims.eur).toBe(40)
    expect(r.result.eur).toBe(500 + 100 + 80 - 970)
    // Ontvangen salaris: het ontvangen bedrag telt.
    const paid = tripResult(t, [...transactions.filter((x) => x.kind !== 'loon'), salary('t', '2026-10-09', { amount: 480, currency: 'EUR', status: 'ontvangen', amountEur: 480 })])
    expect(paid.salaryExpected).toBe(false)
    expect(paid.salary.eur).toBe(480)
    // "Geen salaris" telt als 0.
    const none = tripResult(t, [...transactions.filter((x) => x.kind !== 'loon'), salary('t', '2026-10-07', { amount: 0, status: 'geen' })])
    expect(none.salary.eur).toBe(0)
    expect(none.salaryExpected).toBe(false)
  })
})
