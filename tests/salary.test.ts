import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import { defaultChanges, salaryOutlook, salaryQuestions, saveSalaryDefaults, tipAverages, withSalaryDefault } from '../src/model/salary'
import type { RatesFile } from '../src/model/rates'
import type { Settings, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'
import { salarisLaterVragen, salarisOntvangen } from '../src/domain/geld'
import { instellingenOpslaan } from '../src/domain/instellingen'

// PR C: salaris per trip. Harde regel: een eigen bedrag of een ontvangen salaris wordt nooit automatisch
// overschreven; een gewijzigd standaardbedrag gaat alleen na "ja" naar trips met het oude bedrag. Verzonnen data.

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
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra })
const SV = { amount: 1200, currency: 'EUR' as const }
const get = (s: Store, id: string) => s.list('trips.json.enc').find((t) => t.id === id)!

describe('standaardbedrag per organisatie', () => {
  it('vult alleen een trip zonder salaris; eigen en ontvangen blijven staan', () => {
    const st = settings({ salaryDefaults: { 'sailing-virgins': SV } })
    expect(withSalaryDefault(trip('a', '2026-12-01', '2026-12-07'), st, undefined, [], '2026-10-30').salary).toEqual({ ...SV, status: 'verwacht', source: 'standaard' })
    const own = trip('b', '2026-12-01', '2026-12-07', { salary: { amount: 900, currency: 'USD', status: 'verwacht', source: 'eigen' } })
    expect(withSalaryDefault(own, st, undefined, [], '2026-10-30')).toBe(own)
    const other = trip('c', '2026-12-01', '2026-12-07', { organisation: 'eigen' })
    expect(withSalaryDefault(other, st, undefined, [], '2026-10-30').salary).toBeUndefined()
  })

  it('andere organisatie: het standaardbedrag volgt, een eigen bedrag niet', () => {
    const st = settings({ salaryDefaults: { 'sailing-virgins': SV, 'yacht-week': { amount: 800, currency: 'EUR' } } })
    const before = trip('a', '2026-12-01', '2026-12-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } })
    expect(withSalaryDefault({ ...before, organisation: 'yacht-week' }, st, before, [], '2026-10-30').salary?.amount).toBe(800)
    expect(withSalaryDefault({ ...before, organisation: 'eigen' }, st, before, [], '2026-10-30').salary).toBeUndefined()
    const own = { ...before, salary: { ...SV, amount: 1500, status: 'verwacht' as const, source: 'eigen' as const } }
    expect(withSalaryDefault({ ...own, organisation: 'yacht-week' }, st, own, [], '2026-10-30').salary?.amount).toBe(1500)
    const received = { ...before, salary: { ...SV, status: 'ontvangen' as const, source: 'standaard' as const } }
    expect(withSalaryDefault({ ...received, organisation: 'yacht-week' }, st, received, [], '2026-10-30').salary?.amount).toBe(1200)
  })

  it('nieuw standaardbedrag: de vraag noemt alleen komende trips met nog het oude bedrag', () => {
    const st = settings({ salaryDefaults: { 'sailing-virgins': SV } })
    const trips = [
      trip('old', '2026-12-01', '2026-12-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } }),
      trip('own', '2026-12-10', '2026-12-17', { salary: { ...SV, status: 'verwacht', source: 'eigen' } }),
      trip('got', '2026-11-20', '2026-11-27', { salary: { ...SV, status: 'ontvangen', source: 'standaard' } }),
      trip('past', '2026-10-01', '2026-10-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } }),
      trip('none', '2026-12-20', '2026-12-27'),
    ]
    const changes = defaultChanges(trips, [], st, { 'sailing-virgins': { amount: 1300, currency: 'EUR' } }, TODAY)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.stale.map((x) => x.id)).toEqual(['old'])
  })

  it('opslaan: zonder ja blijft het oude bedrag; met ja alleen de trips met het oude standaardbedrag', async () => {
    for (const yes of [false, true]) {
      const s = await store()
      await instellingenOpslaan(s, { salaryDefaults: { 'sailing-virgins': SV } })
      await putMany(s, 'trips.json.enc', [
        trip('old', '2026-12-01', '2026-12-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } }),
        trip('own', '2026-12-10', '2026-12-17', { salary: { amount: 1250, currency: 'EUR', status: 'verwacht', source: 'eigen' } }),
        trip('got', '2026-11-20', '2026-11-27', { salary: { ...SV, status: 'ontvangen', source: 'standaard' } }),
        trip('none', '2026-12-20', '2026-12-27'),
        trip('pastnone', '2026-10-01', '2026-10-07'),
      ])
      await inTx(s, saveSalaryDefaults, { 'sailing-virgins': { amount: 1300, currency: 'EUR' } }, yes, TODAY)
      expect(get(s, 'old').salary?.amount).toBe(yes ? 1300 : 1200)
      expect(get(s, 'own').salary).toEqual({ amount: 1250, currency: 'EUR', status: 'verwacht', source: 'eigen' })
      expect(get(s, 'got').salary?.amount).toBe(1200)
      expect(get(s, 'none').salary).toEqual({ amount: 1300, currency: 'EUR', status: 'verwacht', source: 'standaard' })
      // Voorbije trips krijgen nooit vanzelf een verwacht salaris (anders vraagt Vandaag naar oude trips).
      expect(get(s, 'pastnone').salary).toBeUndefined()
      expect(s.list('settings.json.enc')[0]!.salaryDefaults).toEqual({ 'sailing-virgins': { amount: 1300, currency: 'EUR' } })
    }
  })
})

describe('salaris ontvangen', () => {
  it('Vandaag vraagt na de einddatum, niet daarvoor en niet na "nog niet"', async () => {
    const s = await store()
    const ended = trip('ended', '2026-11-01', '2026-11-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } })
    await putMany(s, 'trips.json.enc', [ended, trip('running', '2026-11-08', '2026-11-14', { salary: { ...SV, status: 'verwacht', source: 'standaard' } }), trip('endsToday', '2026-11-04', TODAY, { salary: { ...SV, status: 'verwacht', source: 'standaard' } })])
    expect(salaryQuestions(s.list('trips.json.enc'), [], TODAY).map((x) => x.id)).toEqual(['ended'])
    const undo = await salarisLaterVragen(s, ended, TODAY)
    expect(salaryQuestions(s.list('trips.json.enc'), [], TODAY)).toEqual([])
    expect(salaryQuestions(s.list('trips.json.enc'), [], '2026-11-17').map((x) => x.id)).toContain('ended')
    await undo()
    expect(salaryQuestions(s.list('trips.json.enc'), [], TODAY).map((x) => x.id)).toEqual(['ended'])
  })

  it('ja: één inkomen bij de trip (ook met een ander bedrag), status ontvangen; ongedaan maken zet alles terug', async () => {
    const s = await store()
    const t = trip('ended', '2026-11-01', '2026-11-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } })
    await put(s, 'trips.json.enc', t)
    const undo = await salarisOntvangen(s, t, TODAY, { amount: 1180.5, currency: 'EUR' })
    const txs = s.list('transactions.json.enc').filter((x) => x.deletedAt === null)
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ kind: 'loon', amount: 1180.5, currency: 'EUR', tripId: 'ended', source: 'sailing-virgins', date: TODAY })
    expect(get(s, 'ended').salary).toMatchObject({ status: 'ontvangen', amount: 1200, transactionId: txs[0]!.id })
    expect(salaryQuestions(s.list('trips.json.enc'), [], TODAY)).toEqual([])
    await undo()
    expect(s.list('transactions.json.enc').filter((x) => x.deletedAt === null)).toHaveLength(0)
    expect(get(s, 'ended').salary?.status).toBe('verwacht')
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
    const trips = [
      trip('past1', '2026-10-01', '2026-10-07', { salary: { ...SV, status: 'ontvangen', source: 'standaard' } }),
      trip('past2', '2026-10-10', '2026-10-17', { salary: { ...SV, status: 'verwacht', source: 'standaard' } }),
      trip('dec', '2026-12-01', '2026-12-07', { salary: { amount: 1000, currency: 'USD', status: 'verwacht', source: 'eigen' } }),
      trip('feb', '2027-02-01', '2027-02-07', { salary: { ...SV, status: 'verwacht', source: 'standaard' } }),
      trip('yw', '2027-01-03', '2027-01-09', { organisation: 'yacht-week' }),
    ]
    const transactions = [tx('l1', '2026-11-02', 'loon', 1200, 'past1'), tx('f1', '2026-10-05', 'fooi', 300, 'past1'), tx('f2', '2026-10-15', 'fooi', 100, 'past2')]
    const o = salaryOutlook(trips, [], transactions, TODAY, rates)
    expect(o.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'])
    expect(o.until).toBe('2027-02')
    // Oktober: past2 nog niet ontvangen. November: het ontvangen loon. December: 1000 USD / 1,25 = 800 EUR.
    expect(o.months[0]!.expectedEur).toBe(1200)
    expect(o.months[1]!.receivedEur).toBe(1200)
    expect(o.months[2]!.expectedEur).toBe(800)
    expect(o.months[4]!.expectedEur).toBe(1200)
    expect(o.expectedEur).toBe(3200)
    // Gemiddelde fooi bij Sailing Virgins: (300 + 100) / 2 = 200 per trip; geen gemiddelde voor Yacht Week.
    expect(tipAverages(trips, [], transactions, TODAY)).toEqual({ 'sailing-virgins': 200 })
    expect(o.months[2]!.tipEstimateEur).toBe(200)
    expect(o.months[3]!.tipEstimateEur).toBe(0)
    expect(o.tipEstimateEur).toBe(400)
  })

  it('zonder koersbestand: een salaris in een andere valuta apart, nooit omgerekend', () => {
    const trips = [trip('dec', '2026-12-01', '2026-12-07', { salary: { amount: 1000, currency: 'USD', status: 'verwacht', source: 'eigen' } })]
    const o = salaryOutlook(trips, [], [], TODAY, null)
    expect(o.expectedEur).toBe(0)
    expect(o.other).toEqual({ USD: 1000 })
  })
})
