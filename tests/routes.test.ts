import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import { logPlanned, plannedFor, plannedNm, previousTrip, routeLine, routeTemplates, tripRoute } from '../src/model/routes'
import type { Leg, Trip } from '../src/model/types'
import { startWeek, type WeekInput } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, putMany } from './helpers/schrijf'
import { periodeBewerken } from '../src/domain/trips'

// Route-sjablonen uit de historie en "Zoals gepland". Alle plaatsen zijn verzonnen.

const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
async function device() {
  return Store.open(await openLogboekDb(`logboek-routes-${++counter}`), masterKey, new GithubClient('github_pat_ROUTES_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
}

function leg(id: string, tripId: string, date: string, from: string, to: string, nm: number): Leg {
  return {
    id, tripId, date, fromPlace: from, fromCountry: 'Nepland', toPlace: to, toCountry: 'Nepland', role: 'schipper', boat: 'Nepboot',
    nmInland: 0, nmSea: nm, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: NOW, deletedAt: null,
  }
}
const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, updatedAt: NOW, deletedAt: null, ...extra })

const trips = [trip('juni'), trip('juli', { boat: 'Nepzon', area: 'Nepzee', organisation: 'yacht-week' }), trip('anders')]
const legs = [
  leg('1', 'juni', '2025-06-01', 'Nepsplit', 'Nepbol', 18),
  leg('2', 'juni', '2025-06-02', 'Nepbol', 'Nephvar', 15),
  leg('3', 'juni', '2025-06-04', 'Nephvar', 'Nepsplit', 25),
  leg('4', 'juli', '2025-07-06', 'Nepsplit', 'Nepbol', 22),
  leg('5', 'juli', '2025-07-07', 'Nepbol', 'Nepvis', 30),
  leg('6', 'juli', '2025-07-08', 'Nephvar', 'nepsplit', 25),
  leg('7', 'anders', '2025-08-01', 'Nepnoord', 'Nepzuid', 10),
  leg('8', 'anders', '2025-08-02', 'Nepzuid', 'Nepnoord', 10),
]

describe('route-sjablonen', () => {
  it('de etappes van een trip als planning, met rustdagen', () => {
    expect(tripRoute(trips[0]!, legs)).toEqual([
      { day: 0, from: 'Nepsplit', to: 'Nepbol', nm: 18 },
      { day: 1, from: 'Nepbol', to: 'Nephvar', nm: 15 },
      { day: 3, from: 'Nephvar', to: 'Nepsplit', nm: 25 },
    ])
    expect(routeLine(tripRoute(trips[0]!, legs))).toBe('Nepsplit → Nepbol → Nephvar → Nepsplit')
  })

  it('terugkerende routes uit de historie: de nieuwste trip is het sjabloon; een eenmalige route niet', () => {
    const templates = routeTemplates(trips, legs)
    expect(templates).toHaveLength(1)
    expect(templates[0]).toMatchObject({ id: 'juli', times: 2, label: 'Nepsplit → nepsplit' })
    expect(previousTrip(trips, legs, '2026-10-27')?.id).toBe('anders')
  })

  it('een trip uit een sjabloon bewaart de planning; bewerken zonder planning laat hem staan, wissen haalt hem weg', async () => {
    const store = await device()
    await putMany(store, 'legs.json.enc', legs)
    const input: WeekInput = {
      name: '', type: 'skipper-charter', startDate: '2026-10-27', dayCount: 4, boat: 'Nepzon', boatModel: '', boatLengthFt: null, base: 'Nepsplit',
      charter: '', area: 'Nepzee', participants: [], note: '', route: tripRoute(trips[1]!, legs),
    }
    const created = await inTx(store, startWeek, input, 'nl', '2026-10-27')
    expect(created.route).toHaveLength(3)
    // Vandaag (dag 0): Nepsplit → Nepbol, voorstel uit de laatste keren (18 en 22).
    const today = plannedFor(created, store.get('legs.json.enc'), '2026-10-27')!
    expect(today).toMatchObject({ from: 'Nepsplit', to: 'Nepbol' })
    expect(plannedNm(store.get('legs.json.enc'), today)).toBe(20)
    expect(plannedFor(created, legs, '2026-10-28')).toMatchObject({ to: 'Nepvis' })
    expect(plannedFor(created, legs, '2026-10-29')).toMatchObject({ from: 'Nephvar' })
    expect(plannedFor(created, legs, '2026-10-30')).toBeNull()

    const logged = await inTx(store, logPlanned, created, today, '2026-10-27', { ...DEFAULT_SETTINGS, lastWater: 'zee' })
    expect(logged).toMatchObject({ tripId: created.id, fromPlace: 'Nepsplit', toPlace: 'Nepbol', nmSea: 20, role: 'schipper', boat: 'Nepzon', source: 'manual' })
    expect(plannedFor(created, store.get('legs.json.enc'), '2026-10-27')).toBeNull()

    const { route: _r, ...withoutRoute } = input
    void _r
    await periodeBewerken(store, created, { ...withoutRoute, name: 'Nep hernoemd' }, 'nl')
    expect(store.get('trips.json.enc').find((t) => t.id === created.id)?.route).toHaveLength(3)
    await periodeBewerken(store, store.get('trips.json.enc').find((t) => t.id === created.id)!, { ...withoutRoute, route: [] }, 'nl')
    expect(store.get('trips.json.enc').find((t) => t.id === created.id)?.route).toBeUndefined()
  })
})
