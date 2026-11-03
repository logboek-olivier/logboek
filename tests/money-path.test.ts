import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { taxYear } from '../src/model/tax-year'
import { asksPerTrip, expectedPayout, expectedSalary, minimumPayout, payoutQuestions, payoutRule, payoutSuggestion, splitPayout } from '../src/model/money-path'
import { setRates, type RatesFile } from '../src/model/rates'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { SalaryStatus, Settings, Transaction, Trip } from '../src/model/types'
import { salaryOf, salaryState } from '../src/domain/geldmodel'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put, putMany } from './helpers/schrijf'
import { geldVerwijderen, salarisOntvangen, uitbetalingInvoeren } from '../src/domain/geld'
import { amountInput, parseAmount } from '../src/basis/bedrag'

// Het salaris per tocht en de uitbetaling per organisatie (src/model/money-path.ts). Het salaris van een tocht is één
// loon-transactie met een status (verwacht, ontvangen of geen; src/domain/geldmodel.ts); een uitbetaling vinkt de
// tochten in één keer af (per tocht zijn eigen salaris op ontvangen). Een ontvangen salaris gaat nooit nog eens mee.
// Verzonnen data.

const TOKEN = 'github_pat_GELDPAD_0123456789abcdefghijklmnopqrstuvwxyzA'
const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

afterEach(() => setRates(null))

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
  updatedAt: T0,
  deletedAt: null,
  ...extra,
})
/** Het salaris van een tocht: één loon-transactie, standaard verwacht € 1000 op de einddatum. */
const salary = (tripId: string, date: string, extra: Partial<Transaction> & { status?: SalaryStatus } = {}): Transaction => ({
  id: `salaris:${tripId}`,
  date,
  kind: 'loon',
  amount: 1000,
  currency: 'EUR',
  source: 'sailing-virgins',
  tripId,
  status: 'verwacht',
  updatedAt: T0,
  deletedAt: null,
  ...extra,
})
/** Tochten met elk een verwacht salaris op de einddatum. */
const withSalaries = (trips: Trip[]): Transaction[] => trips.map((x) => salary(x.id, x.endDate!))
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra })
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-10-01'], rates: { USD: [1.1] } }

describe('salaris per tocht: verwacht, te ontvangen, ontvangen', () => {
  it('volgt de einddatum en de status', () => {
    const at = (t: Trip, s: Transaction) => salaryState(s, t, t.endDate!, '2026-10-30')
    const a = trip('a', '2026-11-01', '2026-11-07')
    expect(at(a, salary('a', a.endDate!))).toBe('verwacht')
    const b = trip('a', '2026-10-25', '2026-11-02')
    expect(at(b, salary('a', b.endDate!))).toBe('verwacht')
    const c = trip('a', '2026-10-01', '2026-10-07')
    expect(at(c, salary('a', c.endDate!))).toBe('te-ontvangen')
    expect(at(c, salary('a', c.endDate!, { status: 'ontvangen' }))).toBe('ontvangen')
    // Zonder status (een loon van vóór het veld) is het ontvangen; "geen salaris" heeft geen toestand.
    expect(at(c, { ...salary('a', c.endDate!), status: undefined })).toBe('ontvangen')
    expect(at(c, salary('a', c.endDate!, { status: 'geen', amount: 0 }))).toBeNull()
  })
})

describe('uitbetaling per organisatie', () => {
  it('zonder instelling na elke tocht; maandelijks alleen met een dag van 1 tot 28', () => {
    expect(payoutRule(settings(), 'sailing-virgins')).toEqual({ kind: 'per-trip' })
    expect(payoutRule(settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } }), 'sailing-virgins')).toEqual({ kind: 'maandelijks', day: 5 })
    expect(payoutRule(settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 40 } } }), 'sailing-virgins')).toEqual({ kind: 'per-trip' })
  })

  it('voorstel: na elke tocht de oudste open tocht; maandelijks de tochten van vóór de maand van de uitbetaling', () => {
    const trips = [trip('sep', '2026-09-20', '2026-09-26'), trip('okt1', '2026-10-01', '2026-10-07'), trip('okt2', '2026-10-15', '2026-10-21'), trip('nov', '2026-11-01', '2026-11-03'), trip('yw', '2026-10-01', '2026-10-07', { organisation: 'yacht-week' })]
    const txs = withSalaries(trips)
    expect(payoutSuggestion(trips, [], settings(), 'sailing-virgins', '2026-11-05', txs).map((x) => x.id)).toEqual(['sep'])
    const monthly = settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } })
    expect(payoutSuggestion(trips, [], monthly, 'sailing-virgins', '2026-11-05', txs).map((x) => x.id)).toEqual(['sep', 'okt1', 'okt2'])
    // Een tocht zonder salaris of met een salaris van 0 is niets om uit te betalen.
    expect(payoutSuggestion(trips, [], settings(), 'sailing-virgins', '2026-11-05', [])).toEqual([])
    expect(payoutSuggestion(trips, [], settings(), 'sailing-virgins', '2026-11-05', [salary('sep', '2026-09-26', { amount: 0 })])).toEqual([])
  })

  it('verwacht bedrag in de valuta van de uitbetaling, en verdeeld naar verhouding (de delen zijn samen precies het bedrag)', () => {
    const trips = [trip('a', '2026-10-01', '2026-10-07'), trip('b', '2026-10-08', '2026-10-14')]
    const txs = [salary('a', '2026-10-07'), salary('b', '2026-10-14', { amount: 2000 })]
    expect(expectedPayout(trips, txs, 'EUR', '2026-11-05', null)).toBe(3000)
    expect(expectedPayout(trips, txs, 'USD', '2026-11-05', null)).toBeNull()
    expect(expectedPayout(trips, txs, 'USD', '2026-11-05', RATES)).toBe(3300)
    expect(splitPayout(2900, trips, txs, 'EUR', '2026-11-05', null)).toEqual([966.67, 1933.33])
    expect(splitPayout(100, trips, txs, 'USD', '2026-11-05', null)).toEqual([50, 50])
    // In centen naar de grootste rest: samen precies het bedrag, nooit negatief.
    const three = [trip('a', '2026-10-01', '2026-10-07'), trip('b', '2026-10-08', '2026-10-14'), trip('c', '2026-10-15', '2026-10-21')]
    const parts = splitPayout(1000, three, withSalaries(three), 'EUR', '2026-11-05', null)
    expect(parts).toEqual([333.34, 333.33, 333.33])
    expect(Math.round(parts.reduce((n, x) => n + x, 0) * 100)).toBe(100000)
    expect(minimumPayout(3)).toBe(0.03)
  })

  it('een voorgevuld bedrag leest precies zo terug, in het Nederlands en in het Engels', () => {
    for (const lang of ['nl', 'en'] as const) {
      for (const n of [2000, 1234.56, 12500, 0.5, 1100, 2162.43, 999999.99]) expect(parseAmount(amountInput(n, lang), lang)).toBe(n)
    }
    expect(amountInput(2000, 'en')).toBe('2000')
    expect(amountInput(1234.5, 'nl')).toBe('1234,50')
    // Engelse duizendtallen worden niet meer als decimalen gelezen.
    expect(parseAmount('2,000', 'en')).toBe(2000)
    expect(parseAmount('1,234.56', 'en')).toBe(1234.56)
    expect(parseAmount('12,50', 'en')).toBe(12.5)
    expect(parseAmount('2.000', 'nl')).toBe(2000)
    expect(parseAmount('12,50', 'nl')).toBe(12.5)
  })

  it('een uitbetaling invoeren zet het salaris van elke tocht op ontvangen met zijn deel; ongedaan maken zet alles terug', async () => {
    const s = await store()
    const a = trip('a', '2026-10-01', '2026-10-07')
    const b = trip('b', '2026-10-15', '2026-10-21')
    await putMany(s, 'trips.json.enc', [a, b])
    await putMany(s, 'transactions.json.enc', [salary('a', '2026-10-07', { askAfter: '2026-11-01' }), salary('b', '2026-10-21')])
    const undo = await uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 1950, currency: 'EUR', date: '2026-11-05' }, [a, b], null)
    const txs = s.list('transactions.json.enc')
    expect(txs.map((tx) => [tx.id, tx.tripId, tx.amount, tx.kind, tx.date, tx.status])).toEqual(
      expect.arrayContaining([
        ['salaris:a', 'a', 975, 'loon', '2026-11-05', 'ontvangen'],
        ['salaris:b', 'b', 975, 'loon', '2026-11-05', 'ontvangen'],
      ]),
    )
    expect(txs).toHaveLength(2)
    expect(new Set(txs.map((tx) => tx.payoutId)).size).toBe(1)
    expect(txs.find((tx) => tx.tripId === 'a')!.askAfter).toBeUndefined()
    // Een tweede tik op dezelfde tochten boekt niets nog eens.
    await uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 1950, currency: 'EUR', date: '2026-11-05' }, [a, b], null)
    expect(s.list('transactions.json.enc')).toHaveLength(2)
    expect(s.list('transactions.json.enc').reduce((n, tx) => n + tx.amount, 0)).toBe(1950)
    // In het jaaroverzicht telt de uitbetaling precies één keer.
    expect(taxYear(s.list('transactions.json.enc'), s.list('trips.json.enc'), 2026, null).totalEur).toBe(1950)
    // Ongedaan maken zet alleen het salaris terug: een naamwijziging intussen blijft.
    await put(s, 'trips.json.enc', { ...s.list('trips.json.enc').find((t) => t.id === 'b')!, name: 'Nep b nieuw', updatedAt: new Date().toISOString() })
    await undo()
    expect(s.list('transactions.json.enc').map((tx) => [tx.tripId, tx.status, tx.amount])).toEqual(
      expect.arrayContaining([
        ['a', 'verwacht', 1000],
        ['b', 'verwacht', 1000],
      ]),
    )
    expect(s.list('transactions.json.enc').find((tx) => tx.tripId === 'a')!.askAfter).toBe('2026-11-01')
    expect(s.list('trips.json.enc').find((t) => t.id === 'b')!.name).toBe('Nep b nieuw')
  })

  it('een uitbetaling in dollars krijgt de koers van de datum; te klein voor de tochten wordt geweigerd', async () => {
    const s = await store()
    // De koersen zoals de app ze geladen heeft (getRates): dezelfde als die van de uitbetaling.
    setRates(RATES)
    const a = trip('a', '2026-10-01', '2026-10-07')
    await putMany(s, 'trips.json.enc', [a])
    await put(s, 'transactions.json.enc', salary('a', '2026-10-07', { amount: 1100, currency: 'USD' }))
    await expect(uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 0.001, currency: 'USD', date: '2026-11-05' }, [a], RATES)).rejects.toThrow()
    // Een definitieve koers (de datum staat in het koersbestand) wordt opgeslagen; een voorlopige nooit.
    await uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 1100, currency: 'USD', date: '2026-10-01' }, [a], RATES)
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ amount: 1100, currency: 'USD', rate: 1.1, amountEur: 1000, status: 'ontvangen' })
  })

  it('salaris ontvangen twee keer achter elkaar boekt één inkomen; verwijderen haalt het salaris weg, ongedaan maken zet het terug', async () => {
    const s = await store()
    const a = trip('a', '2026-10-01', '2026-10-07')
    await putMany(s, 'trips.json.enc', [a])
    await put(s, 'transactions.json.enc', salary('a', '2026-10-07'))
    await salarisOntvangen(s, 'a', '2026-10-30')
    await salarisOntvangen(s, 'a', '2026-10-30')
    const incomes = s.list('transactions.json.enc')
    expect(incomes).toHaveLength(1)
    expect(incomes[0]).toMatchObject({ status: 'ontvangen', amount: 1000, date: '2026-10-30' })
    const undo = await geldVerwijderen(s, incomes[0]!)
    expect(salaryOf('a', s.list('transactions.json.enc'))).toBeUndefined()
    await undo()
    expect(salaryOf('a', s.list('transactions.json.enc'))).toMatchObject({ id: 'salaris:a', status: 'ontvangen', deletedAt: null })
  })

  it('een tocht met al een ontvangen loon wordt niet vanzelf voorgesteld of gevraagd; maandelijks geen vraag per tocht', () => {
    const x = trip('x', '2026-10-01', '2026-10-07')
    // Een loon zonder status (van vóór de status) is ontvangen.
    const loon: Transaction = { id: 'l', date: '2026-10-10', kind: 'loon', amount: 1000, currency: 'EUR', source: 'sailing-virgins', tripId: 'x', updatedAt: T0, deletedAt: null }
    expect(expectedSalary(x, [loon])).toBeUndefined()
    expect(payoutSuggestion([x], [], settings(), 'sailing-virgins', '2026-11-05', [loon])).toEqual([])
    const monthly = settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 1 } } })
    expect(payoutQuestions([x], [], monthly, '2026-11-05', [loon])).toEqual([])
    expect(asksPerTrip(monthly, x)).toBe(false)
    expect(asksPerTrip(settings(), x)).toBe(true)
  })

  it('Vandaag vraagt bij maandelijks pas vanaf dag N, voor de tochten van de vorige maand en wat nog openstond', () => {
    const trips = [trip('sep', '2026-09-20', '2026-09-26'), trip('okt', '2026-10-01', '2026-10-07'), trip('nov', '2026-11-01', '2026-11-03'), trip('later', '2026-10-02', '2026-10-08')]
    const txs = [...withSalaries(trips.slice(0, 3)), salary('later', '2026-10-08', { amount: 1, askAfter: '2026-11-20' })]
    const monthly = settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } })
    expect(payoutQuestions(trips, [], monthly, '2026-11-04', txs)).toEqual([{ org: 'sailing-virgins', month: '2026-09', trips: [trips[0]] }])
    expect(payoutQuestions(trips, [], monthly, '2026-11-05', txs)).toEqual([{ org: 'sailing-virgins', month: '2026-10', trips: [trips[0], trips[1]] }])
    expect(payoutQuestions(trips, [], settings(), '2026-11-05', txs)).toEqual([])
  })
})
