import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Leg, Trip } from '../src/model/types'
import { activeWeek, needsClosing, weekView } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put, putMany } from './helpers/schrijf'
import { dagBewerken, dagLoggen, dagVerwijderen } from '../src/domain/dagen'

// Datums van een trip zijn gewone velden (CLAUDE.md, uitgangspunt 2): een dag erbij, verschoven, naar een andere trip
// of weg verandert ze nooit, en een trip zonder dagen blijft staan. Verzonnen data.

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

describe('Datums zijn gewone velden', () => {
  it('een dag erbij, verschoven, naar een andere trip of weg: de datums van de trips veranderen niet, en een trip zonder dagen blijft staan', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('a', { startDate: '2026-11-01', endDate: '2026-11-03' }), trip('b', { startDate: '2026-11-10', endDate: '2026-11-12' })])
    await putMany(s, 'legs.json.enc', [leg('l1', 'a', '2026-11-01'), leg('l2', 'a', '2026-11-03')])
    // Verschoven naar ver buiten de trip (een typfout): de trip rekt niet op.
    const l2 = s.list('legs.json.enc').find((l) => l.id === 'l2')!
    await dagBewerken(s, l2, patchOf(l2, '2027-11-03'), { id: 'a' })
    expect(get(s, 'a')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-03' })
    // Naar een andere trip, en weg: geen van beide trips verandert, en a blijft staan zonder dagen.
    const l1 = s.list('legs.json.enc').find((l) => l.id === 'l1')!
    await dagBewerken(s, l1, patchOf(l1, '2026-11-11'), { id: 'b' })
    const moved = s.list('legs.json.enc').find((l) => l.id === 'l2')!
    await dagVerwijderen(s, moved)
    expect(get(s, 'a')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-03' })
    expect(get(s, 'b')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-12' })
    expect(s.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['a', 'b'])
  })

  it('een dag loggen buiten elke trip maakt een nieuwe trip met die dag als begin en eind; gekozen trip: daar, zonder te verlengen', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('a', { startDate: '2026-11-01', endDate: '2026-11-03' }))
    const base = { fromPlace: 'Nephaven', toPlace: 'Nepdorp', role: 'schipper' as const, boat: 'Nepboot', water: 'zee' as const, nm: 10, nightHours: 0, wind: '', notes: '', newTripName: 'Nieuwe neptrip' }
    // Vlak na de trip, de trip voorgevuld (niet zelf gekozen): een nieuwe trip, de oude blijft zoals hij is.
    const { result: later } = await dagLoggen(s, { ...base, date: '2026-11-04', tripId: 'a' })
    expect(later.tripId).not.toBe('a')
    expect(get(s, later.tripId)).toMatchObject({ startDate: '2026-11-04', endDate: '2026-11-04' })
    expect(get(s, later.tripId).datesFromDays).toBeUndefined()
    // Zelf gekozen: bij die trip, en de datums blijven staan.
    const { result: chosen } = await dagLoggen(s, { ...base, date: '2026-11-05', tripId: 'a', explicit: true })
    expect(chosen.tripId).toBe('a')
    expect(get(s, 'a')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-03' })
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


  it('een geïmporteerde tocht zonder datums blijft zo; alleen een notitie wijzigen verandert geen datums', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('import'))
    await putMany(s, 'legs.json.enc', [{ ...leg('i1', 'import', '2025-06-01'), source: 'import' }, { ...leg('i2', 'import', '2025-06-03'), source: 'import' }])
    const i2 = s.list('legs.json.enc').find((l) => l.id === 'i2')!
    await dagBewerken(s, i2, patchOf(i2, '2025-06-04'), { id: 'import' })
    expect(get(s, 'import').startDate).toBeUndefined()
    expect(get(s, 'import').datesFromDays).toBeUndefined()

    await put(s, 'trips.json.enc', trip('dag', { startDate: '2026-11-01', endDate: '2026-11-01' }))
    await put(s, 'legs.json.enc', leg('d1', 'dag', '2026-11-01'))
    const d1 = s.list('legs.json.enc').find((l) => l.id === 'd1')!
    await dagBewerken(s, d1, { ...patchOf(d1, '2026-11-01'), notes: 'Nepnotitie' }, { id: 'dag' })
    expect(get(s, 'dag').updatedAt).toBe(T0)
  })


  it('lopend: drie dagen na de laatste gelogde dag nog; een trip met eigen datums waarin vandaag valt gaat voor', () => {
    const dag = trip('dag', { startDate: '2026-11-10', endDate: '2026-11-12', datesFromDays: true })
    expect(activeWeek([dag], DEFAULT_SETTINGS, '2026-11-15')?.id).toBe('dag')
    expect(activeWeek([dag], DEFAULT_SETTINGS, '2026-11-16')).toBeNull()
    const gepland = trip('gepland', { startDate: '2026-11-14', endDate: '2026-11-20' })
    expect(activeWeek([dag, gepland], DEFAULT_SETTINGS, '2026-11-14')?.id).toBe('gepland')
  })
})
