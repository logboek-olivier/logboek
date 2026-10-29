import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { resizeTrip } from '../src/model/calendar'
import { deleteLeg, updateLeg } from '../src/model/edit'
import { logPlanned } from '../src/model/routes'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import { datesFollowDays, followDays } from '../src/model/trip-dates'
import { deleteTripWith, mergeTrips } from '../src/model/trip-ops'
import type { CalendarDay, Leg, Trip } from '../src/model/types'
import { activeWeek, needsClosing, updateWeek, weekView } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// PR A: een trip die via Toevoegen → Dag is aangemaakt, kreeg geen datums (en stond dus niet in Deze trip). Begin en
// eind volgen nu de dagen, ook als er dagen bijkomen, verschuiven, naar een andere trip gaan of weggaan; zelf
// ingestelde datums blijven staan. Verzonnen data.

const TOKEN = 'github_pat_TRIPDATES_0123456789abcdefghijklmnopqrstuvwxyz'
const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-tripdates-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, updatedAt: T0, deletedAt: null, ...extra })
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
  source: 'manual',
  updatedAt: T0,
  deletedAt: null,
})
const patchOf = (l: Leg, date: string) => {
  const { id: _i, tripId: _t, updatedAt: _u, deletedAt: _d, source: _s, dateEstimated: _e, ...rest } = l
  void [_i, _t, _u, _d, _s, _e]
  return { ...rest, date }
}
const get = (s: Store, id: string) => s.list('trips.json.enc').find((t) => t.id === id)!

describe('Datums uit de dagen', () => {
  it('een trip vanuit Dag volgt zijn dagen: erbij, verschoven en weg (ook ongedaan maken)', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('dag', { startDate: '2026-11-10', endDate: '2026-11-10', datesFromDays: true }))
    await s.put('legs.json.enc', leg('l1', 'dag', '2026-11-10'))
    // Een dag erbij, twee dagen later.
    await s.put('legs.json.enc', leg('l2', 'dag', '2026-11-12'))
    await followDays(s, ['dag'])
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-12', datesFromDays: true })
    // De eerste dag een dag eerder.
    await updateLeg(s, s.list('legs.json.enc').find((l) => l.id === 'l1')!, patchOf(leg('l1', 'dag', '2026-11-10'), '2026-11-09'), { id: 'dag' })
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-12' })
    // De laatste dag weg: het eind schuift terug; ongedaan maken zet hem terug.
    const undo = await deleteLeg(s, s.list('legs.json.enc').find((l) => l.id === 'l2')!)
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-09' })
    await undo()
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-12' })
  })

  it('een oudere trip zonder datums krijgt ze bij de volgende dag; zelf ingestelde datums blijven staan', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('oud'))
    await s.put('trips.json.enc', trip('vast', { startDate: '2026-11-01', endDate: '2026-11-07' }))
    await s.putMany('legs.json.enc', [leg('a', 'oud', '2026-10-20'), leg('b', 'oud', '2026-10-22')])
    expect(datesFollowDays(get(s, 'oud'))).toBe(true)
    expect(datesFollowDays(get(s, 'vast'))).toBe(false)
    await logPlanned(s, get(s, 'oud'), { day: 0, from: 'Nephaven', to: 'Nepdorp' }, '2026-10-23', DEFAULT_SETTINGS)
    expect(get(s, 'oud')).toMatchObject({ startDate: '2026-10-20', endDate: '2026-10-23', datesFromDays: true })
    await logPlanned(s, get(s, 'vast'), { day: 0, from: 'Nephaven', to: 'Nepdorp' }, '2026-11-09', DEFAULT_SETTINGS)
    expect(get(s, 'vast')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(get(s, 'vast').datesFromDays).toBeUndefined()
  })

  it('een dag naar een andere trip: beide volgen hun dagen', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', { startDate: '2026-11-01', endDate: '2026-11-03', datesFromDays: true }), trip('b', { startDate: '2026-11-05', endDate: '2026-11-05', datesFromDays: true })])
    await s.putMany('legs.json.enc', [leg('a1', 'a', '2026-11-01'), leg('a2', 'a', '2026-11-03'), leg('b1', 'b', '2026-11-05')])
    const moving = s.list('legs.json.enc').find((l) => l.id === 'a2')!
    await updateLeg(s, moving, patchOf(moving, '2026-11-03'), { id: 'b' })
    expect(get(s, 'a')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-01' })
    expect(get(s, 'b')).toMatchObject({ startDate: '2026-11-03', endDate: '2026-11-05' })
  })

  it('zelf de datums kiezen (Trip bewerken of in de agenda) zet het volgen uit', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('dag', { startDate: '2026-11-10', endDate: '2026-11-11', datesFromDays: true }))
    await s.putMany('legs.json.enc', [leg('l1', 'dag', '2026-11-10'), leg('l2', 'dag', '2026-11-11')])
    // Bewerken zonder de datums te veranderen houdt het volgen aan.
    const base = { name: 'Nep dag', type: 'skipper-charter' as const, boat: '', boatModel: '', boatLengthFt: null, base: '', charter: '', area: '', participants: [], note: '' }
    await updateWeek(s, get(s, 'dag'), { ...base, startDate: '2026-11-10', dayCount: 2 }, 'nl')
    expect(get(s, 'dag').datesFromDays).toBe(true)
    await updateWeek(s, get(s, 'dag'), { ...base, startDate: '2026-11-10', dayCount: 7 }, 'nl')
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-16' })
    expect(get(s, 'dag').datesFromDays).toBeUndefined()
    // Een dag erbij verandert de gekozen datums niet meer.
    await s.put('legs.json.enc', leg('l3', 'dag', '2026-11-20'))
    await followDays(s, ['dag'])
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-16' })

    await s.put('trips.json.enc', trip('agenda', { startDate: '2026-12-01', endDate: '2026-12-01', datesFromDays: true }))
    await s.put('legs.json.enc', leg('x1', 'agenda', '2026-12-01'))
    await resizeTrip(s, { view: weekView(get(s, 'agenda'), s.list('legs.json.enc')), start: '2026-12-01', end: '2026-12-05' })
    expect(get(s, 'agenda')).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-05' })
    expect(get(s, 'agenda').datesFromDays).toBeUndefined()
  })

  it('samenvoegen en verwijderen met meenemen: de datums volgen de dagen alleen als dat voor beide gold', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [
      trip('dag', { startDate: '2026-11-10', endDate: '2026-11-11', datesFromDays: true }),
      trip('gepland', { startDate: '2026-11-08', endDate: '2026-11-21' }),
      trip('ander', { startDate: '2026-11-14', endDate: '2026-11-14', datesFromDays: true }),
    ])
    await s.putMany('legs.json.enc', [leg('d1', 'dag', '2026-11-10'), leg('d2', 'dag', '2026-11-11'), leg('n1', 'ander', '2026-11-14')])
    // Een trip uit Dag gaat op in een andere die ook de dagen volgt: dat blijft zo, met alle dagen.
    const undo = await deleteTripWith(s, get(s, 'ander'), get(s, 'dag'))
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-14', datesFromDays: true })
    await undo()
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-11' })
    // Samen met een geplande trip: de geplande datums staan vast.
    await mergeTrips(s, get(s, 'dag'), get(s, 'gepland'))
    expect(get(s, 'dag')).toMatchObject({ startDate: '2026-11-08', endDate: '2026-11-21' })
    expect(get(s, 'dag').datesFromDays).toBeUndefined()
  })

  it('lopend en afronden: een trip uit Dag is lopend; "voorbij" pas na drie dagen zonder nieuwe dag', async () => {
    const t = trip('dag', { startDate: '2026-11-10', endDate: '2026-11-12', datesFromDays: true })
    expect(activeWeek([t], DEFAULT_SETTINGS, '2026-11-12')?.id).toBe('dag')
    const view = weekView(t, [])
    expect(needsClosing(view, '2026-11-13')).toBe(false)
    expect(needsClosing(view, '2026-11-15')).toBe(false)
    expect(needsClosing(view, '2026-11-16')).toBe(true)
    // Een trip met eigen datums: de dag na het eind.
    expect(needsClosing(weekView(trip('vast', { startDate: '2026-11-10', endDate: '2026-11-12' }), []), '2026-11-13')).toBe(true)
  })

  it('de agenda volgt: zelf ingestelde dagen in de nieuwe periode maken plaats voor werk', async () => {
    const s = await store()
    const rust: CalendarDay = { id: 'dag:2026-11-12', date: '2026-11-12', type: 'rust', updatedAt: T0, deletedAt: null }
    await s.put('calendar.json.enc', rust)
    await s.put('trips.json.enc', trip('dag', { startDate: '2026-11-10', endDate: '2026-11-10', datesFromDays: true }))
    await s.putMany('legs.json.enc', [leg('l1', 'dag', '2026-11-10'), leg('l2', 'dag', '2026-11-13')])
    await followDays(s, ['dag'])
    expect(s.list('calendar.json.enc').find((d) => d.id === rust.id)).toBeUndefined()
  })
})
