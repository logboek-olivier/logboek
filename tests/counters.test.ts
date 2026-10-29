import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { answerDoubt, counterName, doubtfulTrips, nameAfterCounter, nameWithCounter, newTripName, nextNumber, orgFromName, saveFirstNumbers, tripCounters } from '../src/model/counters'
import { currentSettings, DEFAULT_SETTINGS } from '../src/model/settings'
import type { Leg, Settings, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// PR E: teller per organisatie. Elke trip van Sailing Virgins of Yacht Week krijgt zijn volgnummer op datum, ook
// geïmporteerde trips (uit de naam); een afkorting is twijfel en telt pas na "ja". Verzonnen trips.

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, name: string, startDate?: string, extra: Partial<Trip> = {}): Trip => ({ id, name, ...(startDate ? { startDate, endDate: startDate } : {}), updatedAt: T0, deletedAt: null, ...extra })
const leg = (id: string, tripId: string, date: string): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nephaven',
  fromCountry: '',
  toPlace: 'Nepdorp',
  toCountry: '',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 10,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'import',
  updatedAt: T0,
  deletedAt: null,
})
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra })

describe('Organisatie uit de naam', () => {
  it('de volledige naam is zeker, een afkorting als los woord is twijfel', () => {
    expect(orgFromName('Yacht week 7')).toEqual({ org: 'yacht-week', sure: true })
    expect(orgFromName('The Yacht Week Kroatië')).toEqual({ org: 'yacht-week', sure: true })
    expect(orgFromName('Sailing Virgins BVI')).toEqual({ org: 'sailing-virgins', sure: true })
    expect(orgFromName('SV BVI')).toEqual({ org: 'sailing-virgins', sure: false })
    expect(orgFromName('YW10')).toEqual({ org: 'yacht-week', sure: false })
    // Geen los woord: geen twijfel.
    expect(orgFromName('Sven en Nepboot')).toBeNull()
    expect(orgFromName('Nepweek Kroatië')).toBeNull()
  })
})

describe('Volgnummer per organisatie', () => {
  it('op datum, ook geïmporteerde trips zonder datum (uit de dagen), vanaf het beginnummer', () => {
    const trips = [
      trip('yw-b', 'Yacht week Nep', '2026-08-01'),
      trip('yw-a', 'Nepweek', '2026-06-01', { organisation: 'yacht-week' }),
      // Geïmporteerd: alleen een naam, de datum komt uit de dagen.
      trip('yw-imp', 'Yacht week 3'),
      trip('sv-a', 'Nepcursus', '2026-11-08', { organisation: 'sailing-virgins' }),
      // Een andere opgeslagen organisatie telt niet, ook niet met "Yacht week" in de naam.
      trip('eigen', 'Yacht week oefenen', '2026-07-01', { organisation: 'eigen' }),
      trip('verwijderd', 'Yacht week weg', '2026-05-01', { deletedAt: T0 }),
    ]
    const legs = [leg('l1', 'yw-imp', '2025-07-10')]
    const counters = tripCounters(trips, legs, settings())
    expect(counters.get('yw-imp')?.label).toBe('YW #1')
    expect(counters.get('yw-a')?.label).toBe('YW #2')
    expect(counters.get('yw-b')?.label).toBe('YW #3')
    expect(counters.get('sv-a')?.label).toBe('SV #1')
    expect(counters.has('eigen')).toBe(false)
    expect(counters.has('verwijderd')).toBe(false)

    // Beginnummer voor trips van vóór de app.
    const later = tripCounters(trips, legs, settings({ orgFirst: { 'yacht-week': 10 } }))
    expect(later.get('yw-imp')?.label).toBe('YW #10')
    expect(later.get('yw-b')?.label).toBe('YW #12')
    expect(later.get('sv-a')?.label).toBe('SV #1')
    // Een onzinnig beginnummer telt als 1.
    expect(tripCounters(trips, legs, settings({ orgFirst: { 'yacht-week': -3 } })).get('yw-imp')?.n).toBe(1)
  })

  it('het nummer voor een nieuwe trip volgt de trips vóór die datum', () => {
    const trips = [trip('a', 'Yacht week 1', '2026-06-01'), trip('b', 'Yacht week 2', '2026-08-01')]
    expect(nextNumber(trips, [], settings(), 'yacht-week', '2026-09-01')).toBe(3)
    expect(nextNumber(trips, [], settings(), 'yacht-week', '2026-07-01')).toBe(2)
    expect(nextNumber(trips, [], settings({ orgFirst: { 'sailing-virgins': 4 } }), 'sailing-virgins', '2026-09-01')).toBe(4)
  })

  it('naamvoorstel "SV #4 · BVI", anders het gewone voorstel', () => {
    expect(counterName('sailing-virgins', 4, 'BVI')).toBe('SV #4 · BVI')
    expect(counterName('yacht-week', 10, ' ')).toBe('YW #10')
    const trips = [trip('a', 'Nepcursus', '2026-06-01', { organisation: 'sailing-virgins' })]
    expect(newTripName(trips, [], settings({ orgFirst: { 'sailing-virgins': 3 } }), 'sailing-virgins', '2026-11-01', 'BVI', 'Nepbasis nov 2026')).toBe('SV #4 · BVI')
    expect(newTripName(trips, [], settings(), 'eigen', '2026-11-01', 'BVI', 'Nepbasis nov 2026')).toBe('Nepbasis nov 2026')
    expect(newTripName(trips, [], settings(), undefined, '2026-11-01', 'BVI', 'Nepbasis nov 2026')).toBe('Nepbasis nov 2026')
  })

  it('in de lijsten: teller voor de naam, nooit dubbel, en een opgeschoven nummer wint', () => {
    const counter = { org: 'sailing-virgins' as const, n: 5, label: 'SV #5' }
    expect(nameWithCounter(trip('a', 'BVI winter'), counter)).toBe('SV #5 · BVI winter')
    expect(nameWithCounter(trip('a', 'SV #5 · BVI'), counter)).toBe('SV #5 · BVI')
    // De naam kreeg "SV #4" als voorstel; daarna kwam er een eerdere trip bij.
    expect(nameWithCounter(trip('a', 'SV #4 · BVI'), counter)).toBe('SV #5 · BVI')
    expect(nameWithCounter(trip('a', 'Nepweek'), undefined)).toBe('Nepweek')
    // Alleen de afkorting, of met een eigen nummer zonder #.
    expect(nameWithCounter(trip('a', 'SV BVI'), counter)).toBe('SV #5 BVI')
    expect(nameWithCounter(trip('a', 'SV12'), counter)).toBe('SV #5')
    // Een andere organisatie of een woord dat met de letters begint, blijft staan.
    expect(nameWithCounter(trip('a', 'YW #2 BVI'), counter)).toBe('SV #5 · YW #2 BVI')
    expect(nameWithCounter(trip('a', 'SVEN'), counter)).toBe('SV #5 · SVEN')
    // In de kop staat de teller als label ervoor: de naam zonder eigen teller.
    expect(nameAfterCounter(trip('a', 'SV #4 · BVI'), counter)).toBe('BVI')
    expect(nameAfterCounter(trip('a', 'BVI winter'), counter)).toBe('BVI winter')
    expect(nameAfterCounter(trip('a', 'SV #4'), counter)).toBe('')
  })
})

describe('Twijfel bevestigen', () => {
  let masterKey: CryptoKey
  let counter = 0
  beforeAll(async () => {
    masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  })
  async function store(): Promise<Store> {
    const db = await openLogboekDb(`logboek-counters-${++counter}`)
    return Store.open(db, masterKey, new GithubClient('github_pat_COUNTERS_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
  }

  it('een afkorting telt pas na ja; nee wordt onthouden en niet meer gevraagd', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('sv1', 'SV BVI', '2026-03-01'))
    await s.put('trips.json.enc', trip('sv2', 'SV Nepweek', '2026-04-01'))
    await s.put('trips.json.enc', trip('zeker', 'Sailing Virgins Nep', '2026-05-01'))
    const now = () => currentSettings(s.get('settings.json.enc'))
    expect(doubtfulTrips(s.list('trips.json.enc'), now()).map((d) => d.trip.id)).toEqual(['sv1', 'sv2'])
    expect(tripCounters(s.list('trips.json.enc'), [], now()).get('zeker')?.label).toBe('SV #1')

    await answerDoubt(s, s.list('trips.json.enc').find((t) => t.id === 'sv1')!, 'sailing-virgins', true)
    expect(s.list('trips.json.enc').find((t) => t.id === 'sv1')?.organisation).toBe('sailing-virgins')
    await answerDoubt(s, s.list('trips.json.enc').find((t) => t.id === 'sv2')!, 'sailing-virgins', false)
    expect(doubtfulTrips(s.list('trips.json.enc'), now())).toEqual([])
    expect(now().orgAnswered).toEqual(['sv2'])
    const counters = tripCounters(s.list('trips.json.enc'), [], now())
    expect(counters.get('sv1')?.label).toBe('SV #1')
    expect(counters.get('zeker')?.label).toBe('SV #2')
    expect(counters.has('sv2')).toBe(false)
  })

  it('beginnummers: alleen hele getallen vanaf 1; onleesbare antwoorden in de instellingen breken niets', async () => {
    const s = await store()
    await saveFirstNumbers(s, { 'sailing-virgins': 4, 'yacht-week': 0 })
    expect(currentSettings(s.get('settings.json.enc')).orgFirst).toEqual({ 'sailing-virgins': 4 })
    const odd = settings({ orgAnswered: 5 as unknown as string[] })
    expect(doubtfulTrips([trip('a', 'YW Nep', '2026-01-01')], odd).map((d) => d.trip.id)).toEqual(['a'])
  })
})
