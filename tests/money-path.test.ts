import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { taxYear } from '../src/model/tax-year'
import {
  asksPerTrip,
  cashOnHand,
  expectedPayout,
  hasSalaryIncome,
  minimumPayout,
  payoutQuestions,
  payoutRule,
  payoutSuggestion,
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
import { put, putMany } from './helpers/schrijf'
import { contantGestort, geldBewerken, geldVerwijderen, salarisOntvangen, uitbetalingInvoeren } from '../src/domain/geld'
import { amountInput, parseAmount } from '../src/basis/bedrag'

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
    // In centen naar de grootste rest: samen precies het bedrag, nooit negatief.
    const three = [trip('a', '2026-10-01', '2026-10-07'), trip('b', '2026-10-08', '2026-10-14'), trip('c', '2026-10-15', '2026-10-21')]
    const parts = splitPayout(1000, three, [], 'EUR', '2026-11-05', null)
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

  it('een uitbetaling invoeren vinkt de trips af, met per trip een eigen inkomen; ongedaan maken zet alles terug', async () => {
    const s = await store()
    const a = trip('a', '2026-10-01', '2026-10-07', { salary: { amount: 1000, currency: 'EUR', status: 'verwacht', source: 'eigen', askAfter: '2026-11-01' } })
    const b = trip('b', '2026-10-15', '2026-10-21')
    await putMany(s, 'trips.json.enc', [a, b])
    const undo = await uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 1950, currency: 'EUR', date: '2026-11-05' }, [a, b], null)
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
    // Een tweede tik op dezelfde trips boekt niets nog eens.
    await uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 1950, currency: 'EUR', date: '2026-11-05' }, [a, b], null)
    expect(s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)).toHaveLength(2)
    // In het jaaroverzicht telt de uitbetaling precies één keer.
    expect(taxYear(s.list('transactions.json.enc'), s.list('trips.json.enc'), 2026, null).totalEur).toBe(1950)
    // Ongedaan maken zet alleen het salaris terug: een naamwijziging intussen blijft.
    await put(s, 'trips.json.enc', { ...s.list('trips.json.enc').find((t) => t.id === 'b')!, name: 'Nep b nieuw', updatedAt: new Date().toISOString() })
    await undo()
    expect(s.list('transactions.json.enc').every((tx) => tx.deletedAt !== null)).toBe(true)
    expect(s.list('trips.json.enc').map((t) => t.salary!.status)).toEqual(['verwacht', 'verwacht'])
    expect(s.list('trips.json.enc').find((t) => t.id === 'b')!.name).toBe('Nep b nieuw')
  })

  it('een uitbetaling in dollars krijgt de koers van de datum; te klein voor de trips wordt geweigerd', async () => {
    const s = await store()
    const a = trip('a', '2026-10-01', '2026-10-07', { salary: { amount: 1100, currency: 'USD', status: 'verwacht', source: 'eigen' } })
    await putMany(s, 'trips.json.enc', [a])
    await expect(uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 0.001, currency: 'USD', date: '2026-11-05' }, [a], RATES)).rejects.toThrow()
    // Een definitieve koers (de datum staat in het koersbestand) wordt opgeslagen; een voorlopige nooit.
    await uitbetalingInvoeren(s, { org: 'sailing-virgins', amount: 1100, currency: 'USD', date: '2026-10-01' }, [a], RATES)
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ amount: 1100, currency: 'USD', rate: 1.1, amountEur: 1000 })
  })

  it('salaris ontvangen twee keer achter elkaar boekt één inkomen; het inkomen verwijderen zet het salaris weer op te ontvangen', async () => {
    const s = await store()
    const a = trip('a', '2026-10-01', '2026-10-07')
    await putMany(s, 'trips.json.enc', [a])
    await salarisOntvangen(s, a, '2026-10-30')
    await salarisOntvangen(s, a, '2026-10-30')
    const incomes = s.list('transactions.json.enc').filter((tx) => tx.deletedAt === null)
    expect(incomes).toHaveLength(1)
    const undo = await geldVerwijderen(s, incomes[0]!)
    expect(s.list('trips.json.enc')[0]!.salary).toMatchObject({ status: 'verwacht' })
    expect(s.list('trips.json.enc')[0]!.salary!.transactionId).toBeUndefined()
    await undo()
    expect(s.list('trips.json.enc')[0]!.salary).toMatchObject({ status: 'ontvangen', transactionId: incomes[0]!.id })
    expect(s.list('transactions.json.enc')[0]!.deletedAt).toBeNull()
  })

  it('een trip met al een inkomen van soort loon wordt niet vanzelf voorgesteld of gevraagd; maandelijks geen vraag per trip', () => {
    const x = trip('x', '2026-10-01', '2026-10-07')
    const loon = { id: 'l', date: '2026-10-10', kind: 'loon' as const, amount: 1000, currency: 'EUR' as const, source: 'sailing-virgins' as const, tripId: 'x', updatedAt: T0, deletedAt: null }
    expect(hasSalaryIncome(x, [loon])).toBe(true)
    expect(payoutSuggestion([x], [], settings(), 'sailing-virgins', '2026-11-05', [loon])).toEqual([])
    const monthly = settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 1 } } })
    expect(payoutQuestions([x], [], monthly, '2026-11-05', [loon])).toEqual([])
    expect(asksPerTrip(monthly, x)).toBe(false)
    expect(asksPerTrip(settings(), x)).toBe(true)
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
    await putMany(s, 'transactions.json.enc', [tip('c1', { tipVia: 'contant' }), tip('c2', { tipVia: 'contant', currency: 'USD', amount: 20 }), tip('b1', { tipVia: 'bank' }), tip('u1')])
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ EUR: 50, USD: 20 })
    const undo = await contantGestort(s, 'EUR', '2026-10-30')
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ USD: 20 })
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'c1')!.depositedAt).toBe('2026-10-30')
    await undo()
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ EUR: 50, USD: 20 })
    // Gestort op een eerdere datum: een fooi van daarna kan er niet bij zitten.
    await contantGestort(s, 'EUR', '2026-10-05')
    expect(cashOnHand(s.list('transactions.json.enc'))).toEqual({ EUR: 50, USD: 20 })
  })

  it('contant of bank in het bewerkblad: onbekend, een andere soort en van contant naar bank ruimen gestort op', async () => {
    const s = await store()
    const c = tip('c', { tipVia: 'contant', depositedAt: '2026-10-12' })
    await putMany(s, 'transactions.json.enc', [c])
    const base = { date: c.date, kind: c.kind, amount: c.amount, currency: c.currency, source: c.source }
    await geldBewerken(s, c, { ...base, tipVia: 'bank' })
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ tipVia: 'bank' })
    expect(s.list('transactions.json.enc')[0]!.depositedAt).toBeUndefined()
    await geldBewerken(s, s.list('transactions.json.enc')[0]!, { ...base, tipVia: null })
    expect(s.list('transactions.json.enc')[0]!.tipVia).toBeUndefined()
    await geldBewerken(s, s.list('transactions.json.enc')[0]!, { ...base, tipVia: 'contant', depositedAt: '2026-10-12' })
    await geldBewerken(s, s.list('transactions.json.enc')[0]!, { ...base, kind: 'kosten' })
    expect(s.list('transactions.json.enc')[0]!.tipVia).toBeUndefined()
    expect(s.list('transactions.json.enc')[0]!.depositedAt).toBeUndefined()
  })

  it('het geldpad van een trip: salaris met status en fooi naar contant, bank en onbekend', () => {
    const x = trip('t', '2026-10-01', '2026-10-07')
    const money = tripMoney(x, [], [tip('c', { tripId: 't', tipVia: 'contant' }), tip('b', { tripId: 't', tipVia: 'bank', amount: 30 }), tip('u', { tripId: 't', currency: 'USD', amount: 10 }), tip('ander', { tripId: 'x' })], '2026-10-30')
    expect(money.salary).toEqual({ state: 'te-ontvangen', amount: 1000, currency: 'EUR' })
    expect(money.tips.contant.eur).toBe(50)
    expect(money.tips.bank.eur).toBe(30)
    expect(money.tips.onbekend).toEqual({ eur: 0, other: { USD: 10 } })
    // Een onbekende waarde van een nieuwere versie telt als onbekend en breekt niets.
    const future = tripMoney(x, [], [tip('n', { tripId: 't', tipVia: 'paypal' as never })], '2026-10-30')
    expect(future.tips.onbekend.eur).toBe(50)
  })
})
