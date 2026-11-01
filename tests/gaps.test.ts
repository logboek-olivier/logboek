import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectGaps, isSunday, legGaps, tripGaps } from '../src/model/gaps'
import type { Leg, Trip } from '../src/model/types'
import { startWeek, type WeekInput } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, putMany } from './helpers/schrijf'
import { aanvullen } from '../src/domain/dagen'

const TOKEN = 'github_pat_GAPS_0123456789abcdefghijklmnopqrstuvwxyz'
const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device() {
  const db = await openLogboekDb(`logboek-gaps-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

function leg(id: string, tripId: string, date: string, from: string, to: string, boat = 'Nepboot (Nepmodel 40)'): Leg {
  return {
    id, tripId, date, fromPlace: from, fromCountry: '', toPlace: to, toCountry: '', role: 'schipper', boat,
    nmInland: 0, nmSea: 10, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: NOW, deletedAt: null,
  }
}
const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, updatedAt: NOW, deletedAt: null, ...extra })

describe('niets verplicht: onvolledig en aanvullen', () => {
  it('een trip zonder bootgegevens en een dag zonder plaats zijn onvolledig, nooit ongeldig', () => {
    expect(tripGaps(trip('a'), [])).toEqual(['boat', 'boatModel', 'boatLengthFt', 'base', 'startDate'])
    expect(tripGaps(trip('a'), [leg('l', 'a', '2026-01-01', 'A', 'B')])).toEqual(['boat', 'boatModel', 'boatLengthFt', 'base'])
    expect(tripGaps(trip('a', { boat: 'B', boatModel: 'M', boatLengthFt: 40, base: 'X', startDate: '2026-01-01' }), [])).toEqual([])
    expect(legGaps(leg('l', 'a', '2026-01-01', ' ', ''))).toEqual(['fromPlace', 'toPlace'])
  })

  it('model en lengte per boot (één antwoord voor alle trips), basis met voorstel uit de eerste dag, plaatsen uit de buurdagen', () => {
    const trips = [trip('a', { boat: 'Nepboot', startDate: '2026-01-01', base: 'Nephaven' }), trip('b', { boat: 'nepboot', startDate: '2026-02-01' })]
    const legs = [leg('1', 'b', '2026-02-01', 'Nepstart', 'Nepmidden'), leg('2', 'b', '2026-02-02', '', 'Nepeind')]
    const gaps = collectGaps(trips, legs)
    const model = gaps.find((g) => g.kind === 'boat' && g.field === 'boatModel')
    expect(model).toMatchObject({ kind: 'boat', tripIds: ['b', 'a'] })
    expect(gaps.filter((g) => g.kind === 'boat')).toHaveLength(2)
    expect(gaps.find((g) => g.kind === 'trip' && g.field === 'base')).toMatchObject({ suggestion: 'Nepstart' })
    expect(gaps.find((g) => g.kind === 'leg')).toMatchObject({ field: 'fromPlace', suggestion: 'Nepmidden' })
    // Zonder bootnaam eerst de naam, met de boot uit de dagen als voorstel.
    expect(collectGaps([trip('c')], [leg('3', 'c', '2026-03-01', 'A', 'B')]).find((g) => g.kind === 'trip' && g.field === 'boat')).toMatchObject({ suggestion: 'Nepboot' })
  })

  it('aanvullen schrijft alleen lege velden; een trip zonder bootgegevens en een dag zonder plaats worden gewoon opgeslagen', async () => {
    const store = await device()
    const empty: WeekInput = { name: '', type: 'overig', startDate: '', dayCount: 0, boat: '', boatModel: '', boatLengthFt: null, base: '', charter: '', area: '', participants: [], note: '' }
    const saved = await inTx(store, startWeek, empty, 'nl', '2026-10-28')
    expect(saved.name).toMatch(/^Trip /)
    expect(saved.startDate).toBeUndefined()
    await putMany(store, 'trips.json.enc', [trip('x', { boat: 'Nepboot' }), trip('y', { boat: 'Nepboot', boatLengthFt: 33 })])
    const gap = collectGaps(store.get('trips.json.enc'), []).find((g) => g.kind === 'boat' && g.field === 'boatLengthFt')!
    expect(gap.suggestion).toBe('33')
    await aanvullen(store, gap, 40)
    const after = store.get('trips.json.enc')
    expect(after.find((t) => t.id === 'x')?.boatLengthFt).toBe(40)
    expect(after.find((t) => t.id === 'y')?.boatLengthFt).toBe(33)
  })

  it('zondag', () => {
    expect(isSunday('2026-11-01')).toBe(true)
    expect(isSunday('2026-10-31')).toBe(false)
  })
})
