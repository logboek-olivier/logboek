import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { boatList, deleteBoat, mergeBoat } from '../src/model/boats'
import { deletePlace, placeUses, removePin, renamePlace } from '../src/model/places'
import { changeParticipant, deleteTripWith, mergeTrips, replaceTrip, tripDependents, tripOverlaps } from '../src/model/trip-ops'
import type { Leg, Place, Student, Transaction, Trip, WeekPlan } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// PR B: alles bewerken en verwijderen, met ongedaan maken. Trips met hun dagen, inkomsten, deelnemers, studenten en
// planningen; overlappende trips; boten; plaatsen. Verzonnen data.

const TOKEN = 'github_pat_TRIPOPS_0123456789abcdefghijklmnopqrstuvwxyz'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-tripops-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, name: string, startDate?: string, endDate?: string, extra: Partial<Trip> = {}): Trip => ({ id, name, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...extra, updatedAt: T0, deletedAt: null })
const leg = (id: string, tripId: string, date: string, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nephaven',
  fromCountry: '',
  toPlace: 'Nepdorp',
  toCountry: '',
  role: 'schipper',
  boat: 'Nepboot (Nepmodel 40)',
  nmInland: 0,
  nmSea: 10,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  ...extra,
  updatedAt: T0,
  deletedAt: null,
})
const tx = (id: string, tripId: string): Transaction => ({ id, date: '2026-10-20', kind: 'fooi', amount: 50, currency: 'EUR', source: 'overig', tripId, updatedAt: T0, deletedAt: null })
const student = (id: string, weekId: string): Student => ({ id, firstName: 'Nepstudent', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, weekId, updatedAt: T0, deletedAt: null })
const plan = (id: string, tripId: string): WeekPlan => ({ id, title: 'Nepplan', startDate: '2026-10-20', dayCount: 3, tripId, groups: [], days: [], updatedAt: T0, deletedAt: null })

describe('Overlappende trips', () => {
  it('ziet trips op dezelfde dagen, maar niet een wisseldag of trips die aansluiten', () => {
    const trips = [
      trip('a', 'Nepacademy', '2026-10-18', '2026-10-24'),
      trip('b', 'Weel 44', '2026-10-25', '2026-10-31'),
      trip('c', 'Nepweek 2', '2026-10-28', '2026-11-03'),
      trip('d', 'Wisselweek', '2026-11-03', '2026-11-09'),
    ]
    const found = tripOverlaps(trips, [])
    expect(found.map((o) => [o.a.id, o.b.id, o.from, o.to])).toEqual([['b', 'c', '2026-10-28', '2026-10-31']])
  })

  it('een trip binnen een andere en een trip zonder datums met dagen erin', () => {
    const trips = [trip('a', 'Lang', '2026-10-01', '2026-10-20'), trip('b', 'Kort', '2026-10-05', '2026-10-05'), trip('c', 'Uit dagen')]
    const found = tripOverlaps(trips, [leg('l1', 'c', '2026-10-10'), leg('l2', 'c', '2026-10-12')])
    expect(found.map((o) => `${o.a.id}-${o.b.id}`).sort()).toEqual(['a-b', 'a-c'])
  })
})

describe('Trip verwijderen', () => {
  async function filled() {
    const s = await store()
    await s.putMany('trips.json.enc', [
      trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { participants: [{ id: 'p1', firstName: 'Nep' }] }),
      trip('b', 'Andere nepweek', '2026-10-25', '2026-10-31', { participants: [{ id: 'p2', firstName: 'Ander' }] }),
    ])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-10-18'), leg('l2', 'a', '2026-10-19'), leg('l3', 'b', '2026-10-25')])
    await s.put('transactions.json.enc', tx('t1', 'a'))
    await s.put('students.json.enc', student('p1', 'a'))
    await s.put('plans.json.enc', plan('pl1', 'a'))
    return s
  }

  it('"Meenemen naar trip …": dagen, inkomsten, deelnemers, studenten en planningen gaan mee; ongedaan maken zet alles terug', async () => {
    const s = await filled()
    const a = s.list('trips.json.enc').find((t) => t.id === 'a')!
    const b = s.list('trips.json.enc').find((t) => t.id === 'b')!
    expect(tripDependents(s, a)).toMatchObject({ legs: [{}, {}], transactions: [{}], participants: [{}], students: [{}], plans: [{}] })
    const undo = await deleteTripWith(s, a, b)
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['b'])
    expect(s.list('legs.json.enc').every((l) => l.tripId === 'b')).toBe(true)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe('b')
    expect(s.list('students.json.enc')[0]!.weekId).toBe('b')
    expect(s.list('plans.json.enc')[0]!.tripId).toBe('b')
    expect(s.list('trips.json.enc')[0]!.participants!.map((p) => p.id)).toEqual(['p2', 'p1'])
    await undo()
    expect(s.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['a', 'b'])
    expect(s.list('legs.json.enc').filter((l) => l.tripId === 'a')).toHaveLength(2)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe('a')
    expect(s.list('students.json.enc')[0]!.weekId).toBe('a')
    expect(s.list('trips.json.enc').find((t) => t.id === 'b')!.participants!.map((p) => p.id)).toEqual(['p2'])
  })

  it('"Ook verwijderen": alles gaat mee weg, studenten als geschoonde tombstone (regel 14); ongedaan maken zet alles terug', async () => {
    const s = await filled()
    const a = s.list('trips.json.enc').find((t) => t.id === 'a')!
    const undo = await deleteTripWith(s, a, null)
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['b'])
    expect(s.list('legs.json.enc').map((l) => l.id)).toEqual(['l3'])
    expect(s.list('transactions.json.enc')).toEqual([])
    expect(s.list('plans.json.enc')).toEqual([])
    expect(s.get('students.json.enc')[0]).toMatchObject({ id: 'p1', firstName: '', deletedAt: expect.any(String) })
    await undo()
    expect(s.list('legs.json.enc')).toHaveLength(3)
    expect(s.list('students.json.enc')[0]).toMatchObject({ id: 'p1', firstName: 'Nepstudent' })
    expect(s.list('transactions.json.enc')).toHaveLength(1)
  })
})

describe('Overlappende trips oplossen', () => {
  it('samenvoegen: de datums lopen over beide, lege velden aangevuld, alles van de andere trip erbij; ongedaan maken', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'Weel 44', '2026-10-25', '2026-10-31'), trip('b', 'Nepweek 2', '2026-10-28', '2026-11-03', { boat: 'Nepboot', area: 'BVI' })])
    await s.put('legs.json.enc', leg('l1', 'b', '2026-11-01'))
    const [a, b] = ['a', 'b'].map((id) => s.list('trips.json.enc').find((t) => t.id === id)!)
    const undo = await mergeTrips(s, a!, b!)
    const merged = s.list('trips.json.enc')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'a', name: 'Weel 44', startDate: '2026-10-25', endDate: '2026-11-03', boat: 'Nepboot', area: 'BVI' })
    expect(s.list('legs.json.enc')[0]!.tripId).toBe('a')
    expect(tripOverlaps(s.list('trips.json.enc'), s.list('legs.json.enc'))).toEqual([])
    await undo()
    expect(s.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['a', 'b'])
    expect(s.list('trips.json.enc').find((t) => t.id === 'a')).toMatchObject({ endDate: '2026-10-31' })
    expect(s.list('legs.json.enc')[0]!.tripId).toBe('b')
  })

  it('vervangen: de gekozen trip blijft zoals hij is; de dagen van de andere komen erbij', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'Echte week', '2026-10-25', '2026-10-31'), trip('b', 'Plaatshouder', '2026-10-28', '2026-11-03')])
    await s.put('legs.json.enc', leg('l1', 'b', '2026-10-29'))
    const [a, b] = ['a', 'b'].map((id) => s.list('trips.json.enc').find((t) => t.id === id)!)
    await replaceTrip(s, a!, b!)
    expect(s.list('trips.json.enc')).toEqual([expect.objectContaining({ id: 'a', startDate: '2026-10-25', endDate: '2026-10-31' })])
    expect(s.list('legs.json.enc')[0]!.tripId).toBe('a')
  })
})

describe('Deelnemer bewerken of verwijderen', () => {
  it('één deelnemer aanpassen of eruit halen, met ongedaan maken', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { participants: [{ id: 'p1', firstName: 'Nik' }, { id: 'p2', firstName: 'Sam' }] }))
    let a = s.list('trips.json.enc')[0]!
    await changeParticipant(s, a, 'p1', { id: 'p1', firstName: 'Nick', country: 'VS' })
    a = s.list('trips.json.enc')[0]!
    expect(a.participants).toEqual([{ id: 'p1', firstName: 'Nick', country: 'VS' }, { id: 'p2', firstName: 'Sam' }])
    const undo = await changeParticipant(s, a, 'p2', null)
    expect(s.list('trips.json.enc')[0]!.participants!.map((p) => p.id)).toEqual(['p1'])
    await undo()
    expect(s.list('trips.json.enc')[0]!.participants!.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('Boten', () => {
  it('een boot "xxx" verwijderen: trips en dagen houden geen boot meer; ongedaan maken', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { boat: 'xxx' }), trip('b', 'Andere', '2026-10-25', '2026-10-31', { boat: 'Nepboot', boatModel: 'Nepmodel 40' })])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-10-18', { boat: 'xxx' }), leg('l2', 'b', '2026-10-25')])
    const xxx = boatList(s.get('trips.json.enc'), s.get('legs.json.enc')).find((b) => b.name === 'xxx')!
    const undo = await deleteBoat(s, xxx)
    expect(boatList(s.get('trips.json.enc'), s.get('legs.json.enc')).map((b) => b.name)).toEqual(['Nepboot'])
    expect(s.list('legs.json.enc').find((l) => l.id === 'l1')!.boat).toBe('')
    await undo()
    expect(boatList(s.get('trips.json.enc'), s.get('legs.json.enc')).map((b) => b.name).sort()).toEqual(['Nepboot', 'xxx'])
  })

  it('samenvoegen met een andere boot: trips en dagen krijgen die boot, daarna is er één', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [
      trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { boat: 'Nepbot', boatModel: 'Nepmodel 40' }),
      trip('b', 'Andere', '2026-10-25', '2026-10-31', { boat: 'Nepboot', boatModel: 'Nepmodel 40', boatLengthFt: 40, boatKind: 'eenromp' }),
    ])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-10-18', { boat: 'Nepbot (Nepmodel 40)' }), leg('l2', 'b', '2026-10-25')])
    const boats = boatList(s.get('trips.json.enc'), s.get('legs.json.enc'))
    await mergeBoat(s, boats.find((b) => b.name === 'Nepbot')!, boats.find((b) => b.name === 'Nepboot')!)
    const after = boatList(s.get('trips.json.enc'), s.get('legs.json.enc'))
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ name: 'Nepboot', lengthFt: 40, kind: 'eenromp', tripIds: expect.arrayContaining(['a', 'b']) })
    expect(s.list('legs.json.enc').find((l) => l.id === 'l1')!.boat).toBe('Nepboot (Nepmodel 40)')
  })
})

describe('Plaatsen', () => {
  const place = (id: string, name: string): Place => ({ id, name, lat: 18.4, lon: -64.6, updatedAt: T0, deletedAt: null })

  it('hernoemen geldt voor de dagen en de pin; een bestaande naam voegt samen; ongedaan maken', async () => {
    const s = await store()
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-10-18', { toPlace: 'Nepdrop' }), leg('l2', 'a', '2026-10-19', { fromPlace: 'Nepdrop', toPlace: 'Nephaven' })])
    await s.put('places.json.enc', place('pl1', 'Nepdrop'))
    const use = placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Nepdrop')!
    const undo = await renamePlace(s, use, 'Nepplaats')
    expect(s.list('legs.json.enc').map((l) => [l.fromPlace, l.toPlace])).toEqual([
      ['Nephaven', 'Nepplaats'],
      ['Nepplaats', 'Nephaven'],
    ])
    expect(s.list('places.json.enc')[0]!.name).toBe('Nepplaats')
    await undo()
    expect(s.list('places.json.enc')[0]!.name).toBe('Nepdrop')
    // Hernoemen naar een bestaande naam: samenvoegen.
    const again = placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Nepdrop')!
    await renamePlace(s, again, 'nephaven')
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).map((u) => u.name)).toEqual(['Nephaven'])
  })

  it('pin weghalen houdt de naam; verwijderen alleen als geen dag de plaats gebruikt', async () => {
    const s = await store()
    await s.put('legs.json.enc', leg('l1', 'a', '2026-10-18', { toPlace: 'Shamrock Nepquay' }))
    await s.putMany('places.json.enc', [place('pl1', 'Shamrock Nepquay'), place('pl2', 'Losse nepplaats')])
    const uses = placeUses(s.get('legs.json.enc'), s.get('places.json.enc'))
    const used = uses.find((u) => u.name === 'Shamrock Nepquay')!
    await expect(deletePlace(s, used)).rejects.toThrow()
    const undo = await removePin(s, used)
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Shamrock Nepquay')!.place).toBeNull()
    await undo()
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Shamrock Nepquay')!.place).not.toBeNull()
    await deletePlace(s, uses.find((u) => u.name === 'Losse nepplaats')!)
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).map((u) => u.name)).not.toContain('Losse nepplaats')
  })
})
