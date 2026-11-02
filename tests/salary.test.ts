import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applySalaryDefault, salaryOutlook, salaryQuestions, saveSalaryDefaults, tipAverages } from '../src/model/salary'
import { setRates, type RatesFile } from '../src/model/rates'
import type { Transaction, Trip } from '../src/model/types'
import { salaryOf } from '../src/domain/geldmodel'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'
import { salarisLaterVragen, salarisOntvangen } from '../src/domain/geld'
import { instellingenOpslaan } from '../src/domain/instellingen'

// Salaris per tocht: één loon-transactie met een status (src/domain/geldmodel.ts). Het standaardbedrag per organisatie
// is een instelling: het vult alleen een komende tocht zonder salaris; een salaris dat er al staat (ander bedrag,
// ontvangen of geen) wordt nooit automatisch overschreven. Verzonnen data.

const TOKEN = 'github_pat_SALARY_0123456789abcdefghijklmnopqrstuvwxyzAB'
const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-11-10'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-salary-${++counter}`)
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
const SV = { amount: 1200, currency: 'EUR' as const }
/** Het salaris van een tocht als loon-transactie (standaard verwacht, het standaardbedrag van Sailing Virgins). */
const salary = (tripId: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `salaris:${tripId}`,
  date,
  kind: 'loon',
  ...SV,
  source: 'sailing-virgins',
  tripId,
  status: 'verwacht',
  updatedAt: T0,
  deletedAt: null,
  ...extra,
})
const sal = (s: Store, id: string) => salaryOf(id, s.list('transactions.json.enc'))

afterEach(() => setRates(null))

describe('standaardbedrag per organisatie', () => {
  it('vult alleen een komende tocht zonder salaris; een salaris dat er al staat blijft', async () => {
    const s = await store()
    await instellingenOpslaan(s, { salaryDefaults: { 'sailing-virgins': SV } })
    const a = trip('a', '2026-12-01', '2026-12-07')
    const b = trip('b', '2026-12-01', '2026-12-07')
    const c = trip('c', '2026-12-01', '2026-12-07', { organisation: 'eigen' })
    const past = trip('past', '2026-10-01', '2026-10-07')
    await putMany(s, 'trips.json.enc', [a, b, c, past])
    await put(s, 'transactions.json.enc', salary('b', '2026-12-07', { amount: 900, currency: 'USD' }))
    for (const x of [a, b, c, past]) await inTx(s, applySalaryDefault, x, undefined, '2026-10-30')
    expect(sal(s, 'a')).toMatchObject({ ...SV, status: 'verwacht', kind: 'loon', tripId: 'a' })
    expect(sal(s, 'b')).toMatchObject({ amount: 900, currency: 'USD' })
    expect(sal(s, 'c')).toBeUndefined()
    // Een voorbije tocht krijgt nooit vanzelf een salaris.
    expect(sal(s, 'past')).toBeUndefined()
    expect(s.list('transactions.json.enc').filter((x) => x.tripId === 'b')).toHaveLength(1)
  })

  it('andere organisatie: het standaardbedrag volgt, een ander bedrag of een ontvangen salaris niet', async () => {
    const s = await store()
    await instellingenOpslaan(s, { salaryDefaults: { 'sailing-virgins': SV, 'yacht-week': { amount: 800, currency: 'EUR' } } })
    const trips = ['std', 'eigen', 'own', 'got'].map((id) => trip(id, '2026-12-01', '2026-12-07'))
    await putMany(s, 'trips.json.enc', trips)
    await putMany(s, 'transactions.json.enc', [salary('std', '2026-12-07'), salary('eigen', '2026-12-07'), salary('own', '2026-12-07', { amount: 1500 }), salary('got', '2026-12-07', { status: 'ontvangen' })])
    const move = async (id: string, organisation: string) => {
      const next = { ...trips.find((x) => x.id === id)!, organisation }
      await put(s, 'trips.json.enc', next)
      await inTx(s, applySalaryDefault, next, 'sailing-virgins', '2026-10-30')
    }
    await move('std', 'yacht-week')
    expect(sal(s, 'std')).toMatchObject({ amount: 800, status: 'verwacht' })
    // Een organisatie zonder standaardbedrag: het verwachte standaardbedrag van de vorige organisatie vervalt (dat was nog
    // geen geld, en het hoort niet bij deze organisatie); een ander bedrag of een ontvangen salaris blijft.
    await move('eigen', 'eigen')
    expect(sal(s, 'eigen')).toBeUndefined()
    await move('own', 'yacht-week')
    expect(sal(s, 'own')).toMatchObject({ amount: 1500 })
    await move('got', 'yacht-week')
    expect(sal(s, 'got')).toMatchObject({ amount: 1200, status: 'ontvangen' })
  })

  it('opslaan: komende tochten zonder salaris krijgen het nieuwe bedrag; een salaris dat er al staat verandert niet', async () => {
    const s = await store()
    await instellingenOpslaan(s, { salaryDefaults: { 'sailing-virgins': SV } })
    await putMany(s, 'trips.json.enc', [
      trip('old', '2026-12-01', '2026-12-07'),
      trip('own', '2026-12-10', '2026-12-17'),
      trip('got', '2026-11-20', '2026-11-27'),
      trip('none', '2026-12-20', '2026-12-27'),
      trip('pastnone', '2026-10-01', '2026-10-07'),
    ])
    await putMany(s, 'transactions.json.enc', [salary('old', '2026-12-07'), salary('own', '2026-12-17', { amount: 1250 }), salary('got', '2026-11-27', { status: 'ontvangen' })])
    const n = await inTx(s, saveSalaryDefaults, { 'sailing-virgins': { amount: 1300, currency: 'EUR' } }, TODAY)
    expect(n).toBe(1)
    expect(sal(s, 'old')).toMatchObject({ amount: 1200 })
    expect(sal(s, 'own')).toMatchObject({ amount: 1250, status: 'verwacht' })
    expect(sal(s, 'got')).toMatchObject({ amount: 1200, status: 'ontvangen' })
    expect(sal(s, 'none')).toMatchObject({ amount: 1300, currency: 'EUR', status: 'verwacht' })
    // Voorbije tochten krijgen nooit vanzelf een verwacht salaris (anders vraagt Vandaag naar oude tochten).
    expect(sal(s, 'pastnone')).toBeUndefined()
    expect(s.list('settings.json.enc')[0]!.salaryDefaults).toEqual({ 'sailing-virgins': { amount: 1300, currency: 'EUR' } })
  })
})

describe('salaris ontvangen', () => {
  it('Vandaag vraagt na de einddatum, niet daarvoor en niet na "nog niet"', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('ended', '2026-11-01', '2026-11-07'), trip('running', '2026-11-08', '2026-11-14'), trip('endsToday', '2026-11-04', TODAY)])
    await putMany(s, 'transactions.json.enc', [salary('ended', '2026-11-07'), salary('running', '2026-11-14'), salary('endsToday', TODAY)])
    const asked = (date: string) => salaryQuestions(s.list('trips.json.enc'), [], date, s.list('transactions.json.enc')).map((x) => x.trip.id)
    expect(asked(TODAY)).toEqual(['ended'])
    const undo = await salarisLaterVragen(s, 'ended', TODAY)
    expect(asked(TODAY)).toEqual([])
    expect(asked('2026-11-17')).toContain('ended')
    await undo()
    expect(asked(TODAY)).toEqual(['ended'])
  })

  it('ja: het salaris van de tocht op ontvangen (ook met een ander bedrag); ongedaan maken zet alles terug', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('ended', '2026-11-01', '2026-11-07'))
    await put(s, 'transactions.json.enc', salary('ended', '2026-11-07'))
    const undo = await salarisOntvangen(s, 'ended', TODAY, { amount: 1180.5, currency: 'EUR' })
    const txs = s.list('transactions.json.enc')
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ id: 'salaris:ended', kind: 'loon', amount: 1180.5, currency: 'EUR', tripId: 'ended', source: 'sailing-virgins', date: TODAY, status: 'ontvangen' })
    expect(salaryQuestions(s.list('trips.json.enc'), [], TODAY, txs)).toEqual([])
    await undo()
    expect(s.list('transactions.json.enc')).toHaveLength(1)
    expect(sal(s, 'ended')).toMatchObject({ status: 'verwacht', amount: 1200, date: '2026-11-07' })
  })
})

describe('vooruitblik', () => {
  const rates: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-11-01'], rates: { USD: [1.25] } }
  const tx = (id: string, date: string, kind: Transaction['kind'], amount: number, tripId?: string): Transaction => ({
    id,
    date,
    kind,
    amount,
    currency: 'EUR',
    source: 'sailing-virgins',
    ...(tripId ? { tripId } : {}),
    updatedAt: T0,
    deletedAt: null,
  })

  it('per maand verwacht en ontvangen, tot het einde van de planning; fooi apart als schatting', () => {
    // De koersen zoals de app ze geladen heeft (getRates).
    setRates(rates)
    const trips = [
      trip('past1', '2026-10-01', '2026-10-07'),
      trip('past2', '2026-10-10', '2026-10-17'),
      trip('dec', '2026-12-01', '2026-12-07'),
      trip('feb', '2027-02-01', '2027-02-07'),
      trip('yw', '2027-01-03', '2027-01-09', { organisation: 'yacht-week' }),
    ]
    const transactions = [
      salary('past1', '2026-11-02', { status: 'ontvangen' }),
      salary('past2', '2026-10-17'),
      salary('dec', '2026-12-07', { amount: 1000, currency: 'USD' }),
      salary('feb', '2027-02-07'),
      tx('f1', '2026-10-05', 'fooi', 300, 'past1'),
      tx('f2', '2026-10-15', 'fooi', 100, 'past2'),
    ]
    const o = salaryOutlook(trips, [], transactions, TODAY, rates)
    expect(o.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'])
    expect(o.until).toBe('2027-02')
    // Oktober: past2 nog niet ontvangen. November: het ontvangen salaris. December: 1000 USD / 1,25 = 800 EUR.
    expect(o.months[0]!.expectedEur).toBe(1200)
    expect(o.months[1]!.receivedEur).toBe(1200)
    expect(o.months[2]!.expectedEur).toBe(800)
    expect(o.months[4]!.expectedEur).toBe(1200)
    expect(o.expectedEur).toBe(3200)
    // Gemiddelde fooi bij Sailing Virgins: (300 + 100) / 2 = 200 per tocht; geen gemiddelde voor Yacht Week.
    expect(tipAverages(trips, [], transactions, TODAY)).toEqual({ 'sailing-virgins': 200 })
    expect(o.months[2]!.tipEstimateEur).toBe(200)
    expect(o.months[3]!.tipEstimateEur).toBe(0)
    expect(o.tipEstimateEur).toBe(400)
  })

  it('zonder koersbestand: een salaris in een andere valuta apart, nooit omgerekend', () => {
    const trips = [trip('dec', '2026-12-01', '2026-12-07')]
    const o = salaryOutlook(trips, [], [salary('dec', '2026-12-07', { amount: 1000, currency: 'USD' })], TODAY, null)
    expect(o.expectedEur).toBe(0)
    expect(o.other).toEqual({ USD: 1000 })
  })
})
