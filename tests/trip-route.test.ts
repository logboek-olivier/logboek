import { describe, expect, it } from 'vitest'
import { bestCandidate, type PinCandidate } from '../src/model/pin-suggest'
import { routeOf } from '../src/model/trip-route'
import type { Leg, Place } from '../src/model/types'

// PR B: de route van een trip op de kaart (genummerde stops, start en eind, plaatsen zonder pin apart) en het
// pinvoorstel uit de namen op de offline kaart. Verzonnen plaatsen; de OSM-namen hieronder zijn zelf ingevuld.

const T0 = '2026-01-01T00:00:00.000Z'
const leg = (id: string, date: string, from: string, to: string, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId: 't',
  date,
  fromPlace: from,
  fromCountry: '',
  toPlace: to,
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
  ...extra,
})
const place = (id: string, name: string, lat: number, lon: number): Place => ({ id, name, lat, lon, updatedAt: T0, deletedAt: null })

describe('Route van een trip', () => {
  const places = [place('a', 'Nephaven', 18.4, -64.6), place('b', 'Nepbaai', 18.45, -64.5)]

  it('stops in volgorde, genummerd, start en eind; heen en terug naar dezelfde haven telt twee keer', () => {
    const route = routeOf([leg('2', '2026-11-09', 'Nepbaai', 'Nepeiland', { nmSea: 12, nightHours: 2 }), leg('1', '2026-11-08', 'Nephaven', 'Nepbaai'), leg('3', '2026-11-10', 'Nepeiland', 'Nephaven')], places)
    expect(route.stops.map((s) => [s.n, s.name, s.kind, !!s.place])).toEqual([
      [1, 'Nephaven', 'start', true],
      [2, 'Nepbaai', 'stop', true],
      [3, 'Nepeiland', 'stop', false],
      [4, 'Nephaven', 'end', true],
    ])
    expect(route.unpinned).toEqual(['Nepeiland'])
    expect(route).toMatchObject({ nm: 32, days: 3, nightHours: 2 })
  })

  it('een dag die niet aansluit (andere Van) krijgt zijn eigen stop; zelfde plaats in andere spelling één keer', () => {
    const route = routeOf([leg('1', '2026-11-08', 'Nephaven', 'Tiha bay'), leg('2', '2026-11-09', 'Tihabay', 'Nepbaai'), leg('3', '2026-11-10', 'Nephaven', 'Nepdorp')], places)
    expect(route.stops.map((s) => s.name)).toEqual(['Nephaven', 'Tiha bay', 'Nepbaai', 'Nephaven', 'Nepdorp'])
    expect(route.unpinned).toEqual(['Tiha bay', 'Nepdorp'])
  })

  it('verwijderde dagen tellen niet; zonder dagen geen stops', () => {
    expect(routeOf([leg('1', '2026-11-08', 'Nephaven', 'Nepbaai', { deletedAt: T0 })], places).stops).toEqual([])
  })
})

describe('Pinvoorstel uit de namen op de offline kaart', () => {
  const c = (n: string, lat: number, lon: number, k: PinCandidate['label']['k'] = 'plaats', areaId = 'dalmatie'): PinCandidate => ({ label: { n, k, lat, lon }, areaId })
  const candidates = [c('Vis', 43.06, 16.18, 'plaats'), c('Vis', 43.04, 16.1, 'eiland'), c('Palmižana', 43.16, 16.4, 'haven'), c('Vis', 37.5, 24.9, 'dorp', 'saronisch')]

  it('dezelfde naam (zonder accenten); bij meer kandidaten de dichtstbijzijnde bij plaatsen van dezelfde dagen', () => {
    const hvar = place('h', 'Hvar', 43.17, 16.44)
    expect(bestCandidate('vis', candidates, [hvar], '')?.label).toMatchObject({ n: 'Vis', k: 'plaats', lat: 43.06 })
    const kythnos = place('k', 'Nepkythnos', 37.4, 24.4)
    expect(bestCandidate('Vis', candidates, [kythnos], '')?.areaId).toBe('saronisch')
    expect(bestCandidate('Palmizana', candidates, [], '')?.label.n).toBe('Palmižana')
  })

  it('een kleine spelvariant van een langere naam; korte namen alleen precies; anders niets', () => {
    expect(bestCandidate('Palimizana', candidates, [], '')?.label.n).toBe('Palmižana')
    expect(bestCandidate('Vos', candidates, [], '')).toBeNull()
    expect(bestCandidate('Nepnergens', candidates, [], '')).toBeNull()
    expect(bestCandidate('', candidates, [], '')).toBeNull()
  })

  it('zonder buren: in het land van de plaats, daarna een plaats of haven boven een eiland', () => {
    expect(bestCandidate('Vis', candidates, [], 'GR')?.areaId).toBe('saronisch')
    expect(bestCandidate('Vis', candidates.slice(0, 2), [], '')?.label.k).toBe('plaats')
  })
})
