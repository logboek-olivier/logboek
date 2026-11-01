import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { boatList } from '../src/model/boats'
import { placeUses } from '../src/model/places'
import type { Leg, Place, Student, Transaction, Trip, WeekPlan } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put, putMany } from './helpers/schrijf'
import { pinVerwijderen, plaatsHernoemen, plaatsVerwijderen } from '../src/domain/plaatsen'
import { bootVerwijderen, botenSamenvoegen, deelnemerWijzigen, periodeVerwijderen } from '../src/domain/trips'

// PR B: alles bewerken en verwijderen, met ongedaan maken. Trips met hun dagen, inkomsten, deelnemers, studenten en
// planningen; boten; plaatsen. Verzonnen data.

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


describe('Trip verwijderen', () => {
  async function filled() {
    const s = await store()
    await putMany(s, 'trips.json.enc', [
      trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { participants: [{ id: 'p1', firstName: 'Nep' }] }),
      trip('b', 'Andere nepweek', '2026-10-25', '2026-10-31', { participants: [{ id: 'p2', firstName: 'Ander' }] }),
    ])
    await putMany(s, 'legs.json.enc', [leg('l1', 'a', '2026-10-18'), leg('l2', 'a', '2026-10-19'), leg('l3', 'b', '2026-10-25')])
    await put(s, 'transactions.json.enc', tx('t1', 'a'))
    await put(s, 'students.json.enc', student('p1', 'a'))
    await put(s, 'plans.json.enc', plan('pl1', 'a'))
    return s
  }


  it('"Alles naar de prullenbak": alles gaat mee weg, studenten met naam tot de prullenbak na 30 dagen opruimt (regel 14); ongedaan maken zet alles terug', async () => {
    const s = await filled()
    const a = s.list('trips.json.enc').find((t) => t.id === 'a')!
    const undo = await periodeVerwijderen(s, a, 'alles')
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['b'])
    expect(s.list('legs.json.enc').map((l) => l.id)).toEqual(['l3'])
    expect(s.list('transactions.json.enc')).toEqual([])
    expect(s.list('plans.json.enc')).toEqual([])
    expect(s.get('students.json.enc')[0]).toMatchObject({ id: 'p1', firstName: 'Nepstudent', deletedAt: expect.any(String) })
    await undo()
    expect(s.list('legs.json.enc')).toHaveLength(3)
    expect(s.list('students.json.enc')[0]).toMatchObject({ id: 'p1', firstName: 'Nepstudent' })
    expect(s.list('transactions.json.enc')).toHaveLength(1)
  })

  it('"Geld en dagen behouden zonder periode": alleen de trip gaat weg; terugzetten koppelt alles weer', async () => {
    const s = await filled()
    const a = s.list('trips.json.enc').find((t) => t.id === 'a')!
    const undo = await periodeVerwijderen(s, a, 'behouden')
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['b'])
    expect(s.list('legs.json.enc').filter((l) => l.tripId === 'a')).toHaveLength(2)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe('a')
    expect(s.list('students.json.enc')[0]).toMatchObject({ id: 'p1', firstName: 'Nepstudent', weekId: 'a' })
    await undo()
    expect(s.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['a', 'b'])
  })
})


describe('Deelnemer bewerken of verwijderen', () => {
  it('één deelnemer aanpassen of eruit halen, met ongedaan maken', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { participants: [{ id: 'p1', firstName: 'Nik' }, { id: 'p2', firstName: 'Sam' }] }))
    let a = s.list('trips.json.enc')[0]!
    await deelnemerWijzigen(s, a, 'p1', { id: 'p1', firstName: 'Nick', country: 'VS' })
    a = s.list('trips.json.enc')[0]!
    expect(a.participants).toEqual([{ id: 'p1', firstName: 'Nick', country: 'VS' }, { id: 'p2', firstName: 'Sam' }])
    const undo = await deelnemerWijzigen(s, a, 'p2', null)
    expect(s.list('trips.json.enc')[0]!.participants!.map((p) => p.id)).toEqual(['p1'])
    await undo()
    expect(s.list('trips.json.enc')[0]!.participants!.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('Boten', () => {
  it('een boot "xxx" verwijderen: trips en dagen houden geen boot meer; ongedaan maken', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { boat: 'xxx' }), trip('b', 'Andere', '2026-10-25', '2026-10-31', { boat: 'Nepboot', boatModel: 'Nepmodel 40' })])
    await putMany(s, 'legs.json.enc', [leg('l1', 'a', '2026-10-18', { boat: 'xxx' }), leg('l2', 'b', '2026-10-25')])
    const xxx = boatList(s.get('trips.json.enc'), s.get('legs.json.enc')).find((b) => b.name === 'xxx')!
    const undo = await bootVerwijderen(s, xxx)
    expect(boatList(s.get('trips.json.enc'), s.get('legs.json.enc')).map((b) => b.name)).toEqual(['Nepboot'])
    expect(s.list('legs.json.enc').find((l) => l.id === 'l1')!.boat).toBe('')
    await undo()
    expect(boatList(s.get('trips.json.enc'), s.get('legs.json.enc')).map((b) => b.name).sort()).toEqual(['Nepboot', 'xxx'])
  })

  it('samenvoegen met een andere boot: trips en dagen krijgen die boot, daarna is er één', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [
      trip('a', 'Nepweek', '2026-10-18', '2026-10-24', { boat: 'Nepbot', boatModel: 'Nepmodel 40' }),
      trip('b', 'Andere', '2026-10-25', '2026-10-31', { boat: 'Nepboot', boatModel: 'Nepmodel 40', boatLengthFt: 40, boatKind: 'eenromp' }),
    ])
    await putMany(s, 'legs.json.enc', [leg('l1', 'a', '2026-10-18', { boat: 'Nepbot (Nepmodel 40)' }), leg('l2', 'b', '2026-10-25')])
    const boats = boatList(s.get('trips.json.enc'), s.get('legs.json.enc'))
    await botenSamenvoegen(s, boats.find((b) => b.name === 'Nepbot')!, boats.find((b) => b.name === 'Nepboot')!)
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
    await putMany(s, 'legs.json.enc', [leg('l1', 'a', '2026-10-18', { toPlace: 'Nepdrop' }), leg('l2', 'a', '2026-10-19', { fromPlace: 'Nepdrop', toPlace: 'Nephaven' })])
    await put(s, 'places.json.enc', place('pl1', 'Nepdrop'))
    const use = placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Nepdrop')!
    const undo = await plaatsHernoemen(s, use, 'Nepplaats')
    expect(s.list('legs.json.enc').map((l) => [l.fromPlace, l.toPlace])).toEqual([
      ['Nephaven', 'Nepplaats'],
      ['Nepplaats', 'Nephaven'],
    ])
    expect(s.list('places.json.enc')[0]!.name).toBe('Nepplaats')
    await undo()
    expect(s.list('places.json.enc')[0]!.name).toBe('Nepdrop')
    // Hernoemen naar een bestaande naam: samenvoegen.
    const again = placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Nepdrop')!
    await plaatsHernoemen(s, again, 'nephaven')
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).map((u) => u.name)).toEqual(['Nephaven'])
  })

  it('pin weghalen houdt de naam; verwijderen alleen als geen dag de plaats gebruikt', async () => {
    const s = await store()
    await put(s, 'legs.json.enc', leg('l1', 'a', '2026-10-18', { toPlace: 'Shamrock Nepquay' }))
    await putMany(s, 'places.json.enc', [place('pl1', 'Shamrock Nepquay'), place('pl2', 'Losse nepplaats')])
    const uses = placeUses(s.get('legs.json.enc'), s.get('places.json.enc'))
    const used = uses.find((u) => u.name === 'Shamrock Nepquay')!
    await expect(plaatsVerwijderen(s, used)).rejects.toThrow()
    const undo = await pinVerwijderen(s, used)
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Shamrock Nepquay')!.place).toBeNull()
    await undo()
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).find((u) => u.name === 'Shamrock Nepquay')!.place).not.toBeNull()
    await plaatsVerwijderen(s, uses.find((u) => u.name === 'Losse nepplaats')!)
    expect(placeUses(s.get('legs.json.enc'), s.get('places.json.enc')).map((u) => u.name)).not.toContain('Losse nepplaats')
  })
})
