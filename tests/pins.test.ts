import { describe, expect, it } from 'vitest'
import { countryBox, distanceToCountryNm } from '../src/model/countries'
import { defaultFromPlace, nearestKnownPlace, pinQuestion, placeCountry } from '../src/model/places'
import type { Leg, Place } from '../src/model/types'

// PR C: pins en plaatsen logisch. Een pin koppelen of vervangen gebeurt nooit stil; Van komt nooit uit een andere trip.
// Verzonnen plaatsen; de coördinaten zijn openbare kaartpunten (Southampton, Tortola).

const T0 = '2026-01-01T00:00:00.000Z'
const leg = (id: string, tripId: string, date: string, from: string, to: string, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId,
  date,
  fromPlace: from,
  fromCountry: '',
  toPlace: to,
  toCountry: '',
  role: 'schipper',
  boat: '',
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
const place = (id: string, name: string, lat: number, lon: number, country?: string): Place => ({ id, name, lat, lon, ...(country ? { country } : {}), updatedAt: T0, deletedAt: null })

const SOUTHAMPTON = { lat: 50.89, lon: -1.39 }
const TORTOLA = { lat: 18.42, lon: -64.62 }

describe('Landen', () => {
  it('kent landen in het Nederlands, Engels en als afkorting', () => {
    expect(countryBox('Engeland')).toEqual(countryBox('UK'))
    expect(countryBox('Kroatië')).toEqual(countryBox('croatia'))
    expect(countryBox('BVI')).not.toBeNull()
    expect(countryBox('Nepland')).toBeNull()
  })

  it('afstand tot een land: 0 erin, duizenden mijlen van Engeland naar de BVI', () => {
    expect(distanceToCountryNm('Engeland', SOUTHAMPTON)).toBe(0)
    expect(distanceToCountryNm('Engeland', TORTOLA)).toBeGreaterThan(3000)
    expect(distanceToCountryNm('Nepland', TORTOLA)).toBeNull()
  })
})

describe('Pin koppelen of vervangen: nooit stil', () => {
  const legs = [leg('l1', 't1', '2025-06-01', 'Nephaven', 'Shamrock Quay Southampton', { toCountry: 'Engeland' })]

  it('ver van het land van de plaats: eerst de vraag "Dit ligt ver van Engeland"', () => {
    expect(placeCountry(legs, [], 'Shamrock Quay Southampton')).toBe('Engeland')
    expect(pinQuestion(legs, [], 'Shamrock Quay Southampton', TORTOLA)).toEqual({ name: 'Shamrock Quay Southampton', existing: null, moveNm: null, farFrom: 'Engeland' })
    expect(pinQuestion(legs, [], 'Shamrock Quay Southampton', SOUTHAMPTON)).toBeNull()
  })

  it('een plaats die al een pin heeft: eerst "Pin van X verplaatsen?" met oud en nieuw; een kleine correctie niet', () => {
    const places = [place('p1', 'Nepbaai', 18.44, -64.55)]
    const q = pinQuestion([], places, 'nepbaai', { lat: 18.3, lon: -64.8 })
    expect(q?.existing?.id).toBe('p1')
    expect(q?.moveNm).toBeGreaterThan(10)
    expect(q?.farFrom).toBeNull()
    expect(pinQuestion([], places, 'Nepbaai', { lat: 18.4401, lon: -64.5501 })).toBeNull()
  })

  it('een nieuwe plaats zonder bekend land: niets te vragen', () => {
    expect(pinQuestion([], [], 'Nieuwe nepplaats', TORTOLA)).toBeNull()
  })
})

describe('Van, standaard', () => {
  const legs = [
    leg('a1', 'oud', '2025-06-01', 'Nephaven', 'Shamrock Quay Southampton'),
    leg('b1', 'bvi', '2026-10-20', 'Nepbasis', 'Nepbaai'),
    leg('b2', 'bvi', '2026-10-21', 'Nepbaai', 'Nepeiland'),
  ]

  it('de Naar van de vorige dag binnen dezelfde trip', () => {
    expect(defaultFromPlace(legs, { id: 'bvi', base: 'Nepbasis' }, '2026-10-22')).toBe('Nepeiland')
    // Een eerdere datum binnen de trip: de dag ervoor.
    expect(defaultFromPlace(legs, { id: 'bvi', base: 'Nepbasis' }, '2026-10-20')).toBe('Nepbaai')
  })

  it('zonder vorige dag de basis van de trip; zonder trip of basis leeg, nooit een plaats uit een andere trip', () => {
    expect(defaultFromPlace(legs, { id: 'nieuw', base: 'Nepmarina' }, '2026-10-28')).toBe('Nepmarina')
    expect(defaultFromPlace(legs, { id: 'nieuw' }, '2026-10-28')).toBe('')
    expect(defaultFromPlace(legs, null, '2026-10-28')).toBe('')
  })

  it('via GPS: alleen een bekende plaats in de buurt', () => {
    const places = [place('p1', 'Nepbaai', 18.44, -64.55), place('p2', 'Shamrock Quay Southampton', SOUTHAMPTON.lat, SOUTHAMPTON.lon)]
    expect(nearestKnownPlace(places, { lat: 18.45, lon: -64.56 }, 15)?.name).toBe('Nepbaai')
    expect(nearestKnownPlace(places, { lat: 12.0, lon: -61.7 }, 15)).toBeNull()
  })
})
