import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { findPlace, greatCircleNm, knownPlaceNames, nearestPlace, placeKey, savePlace, suggestDistance } from '../src/model/places'
import type { Leg, Place } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Afstandsvoorstel uit eerdere dagen op dezelfde route, en plaatsen op de kaart. Alle gegevens zijn verzonnen.

const NOW = '2026-10-26T10:00:00.000Z'

function leg(id: string, date: string, from: string, to: string, nm: number, extra: Partial<Leg> = {}): Leg {
  return {
    id, tripId: 't', date, fromPlace: from, fromCountry: '', toPlace: to, toCountry: '', role: 'schipper', boat: 'Nepboot',
    nmInland: 0, nmSea: nm, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: NOW, deletedAt: null, ...extra,
  }
}

const place = (id: string, name: string, lat: number, lon: number): Place => ({ id, name, lat, lon, updatedAt: NOW, deletedAt: null })

describe('afstandsvoorstel', () => {
  it('gemiddelde van de laatste vijf keer dezelfde route, in beide richtingen, zonder hoofdletters of accenten', () => {
    const legs = [
      leg('1', '2026-01-01', 'Nepstad', 'Nephaven', 100), // valt buiten de laatste vijf
      leg('2', '2026-02-01', 'Nepstad', 'Nephaven', 20),
      leg('3', '2026-03-01', 'Nephaven', 'Nepstad', 22),
      leg('4', '2026-04-01', 'nepstad ', 'NEPHAVEN', 18),
      leg('5', '2026-05-01', 'Nepstád', 'Nephaven', 21),
      leg('6', '2026-06-01', 'Nepstad', 'Nephaven', 19, { nmTidal: 0 }),
      leg('7', '2026-07-01', 'Nepstad', 'Andere haven', 50),
      leg('8', '2026-08-01', 'Nepstad', 'Nephaven', 99, { deletedAt: NOW }),
    ]
    expect(suggestDistance(legs, 'Nepstad', 'Nephaven')).toEqual({ nm: 20, count: 5 })
    expect(suggestDistance(legs, 'Nephaven', 'Nepstad')).toEqual({ nm: 20, count: 5 })
    expect(suggestDistance(legs, 'Nepstad', 'Andere haven')).toEqual({ nm: 50, count: 1 })
    expect(suggestDistance(legs, 'Nepstad', 'Onbekend')).toBeNull()
    expect(suggestDistance(legs, 'Nepstad', 'Nepstad')).toBeNull()
    expect(placeKey('  Sint-Barthélemy ')).toBe('sint barthelemy')
  })

  it('hemelsbreed en de dichtstbijzijnde bekende plaats', () => {
    const barths = place('a', 'Nepbarths', 17.9, -62.85)
    const statia = place('b', 'Nepstatia', 17.48, -62.98)
    expect(greatCircleNm(barths, statia)).toBeCloseTo(26, 0)
    expect(nearestPlace([barths, statia], { lat: 17.905, lon: -62.851 })?.id).toBe('a')
    expect(nearestPlace([barths, statia], { lat: 17.7, lon: -62.9 })).toBeNull()
    expect(findPlace([barths], 'nepbarths')?.id).toBe('a')
  })

  it('plaatsnamen uit eerdere dagen en de kaart, meest gebruikt eerst; opslaan houdt het id bij dezelfde naam', async () => {
    const names = knownPlaceNames([leg('1', '2026-01-01', 'Nepstad', 'Nephaven', 1), leg('2', '2026-01-02', 'Nephaven', 'Nepdorp', 1)], [place('p', 'Nepeiland', 1, 1)])
    expect(names[0]).toBe('Nephaven')
    expect(names).toContain('Nepeiland')

    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const store = await Store.open(await openLogboekDb('logboek-places-1'), masterKey, new GithubClient('github_pat_PLACES_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
    const first = await savePlace(store, ' Nephaven ', { lat: 17.123456789, lon: -62.1 })
    const again = await savePlace(store, 'nephaven', { lat: 17.2, lon: -62.2 })
    expect(again.id).toBe(first.id)
    expect(store.list('places.json.enc')).toHaveLength(1)
    expect(first.lat).toBe(17.12346)
  })
})
