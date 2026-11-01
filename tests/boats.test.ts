import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMileageCsv } from '../src/import/mileage-csv'
import { boatList, parseShip, suggestKind, suggestLengthFt, uncheckedBoats } from '../src/model/boats'
import { collectGaps } from '../src/model/gaps'
import { currentSettings } from '../src/model/settings'
import type { Leg, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'
import { mijlenImporteren } from '../src/domain/importeren'
import { botenBevestigen, botenOverslaan } from '../src/domain/trips'

const TOKEN = 'github_pat_BOATS_0123456789abcdefghijklmnopqrstuvwxyz'
const NOW = '2026-10-26T10:00:00.000Z'
const csv = readFileSync(new URL('./fixtures/boten-nep.csv', import.meta.url), 'utf8')
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device() {
  const db = await openLogboekDb(`logboek-boats-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

describe('boten uit de kolom Schip', () => {
  it('"Naam (Model)", alleen een model of alleen een naam', () => {
    expect(parseShip('Nepzwaan (Nepteau SO 519)')).toEqual({ name: 'Nepzwaan', model: 'Nepteau SO 519' })
    expect(parseShip('Sportnep 680')).toEqual({ name: '', model: 'Sportnep 680' })
    expect(parseShip('Nepkoala X')).toEqual({ name: 'Nepkoala X', model: '' })
    expect(parseShip('  Neptrude  (nepship 26ft) ')).toEqual({ name: 'Neptrude', model: 'nepship 26ft' })
    expect(parseShip('(Nepgoon 42)')).toEqual({ name: '', model: 'Nepgoon 42' })
    expect(parseShip('')).toEqual({ name: '', model: '' })
  })

  it('lengtevoorstel uit het model: ft, meter, modelnummer; anders geen voorstel', () => {
    expect(suggestLengthFt('Nepaak 38ft')).toBe(38)
    expect(suggestLengthFt('Nepteau O 48 ft')).toBe(48)
    expect(suggestLengthFt('Nepgoon 42')).toBe(42)
    expect(suggestLengthFt('Nepanis 38.1')).toBe(38)
    expect(suggestLengthFt('Nepali 4.2')).toBe(42)
    expect(suggestLengthFt('Nepteau SO 519')).toBe(52)
    expect(suggestLengthFt('Sportnep 680')).toBe(22)
    expect(suggestLengthFt('Nepvaria 56 Cr')).toBe(56)
    expect(suggestLengthFt('Nepjacht 12 m')).toBe(39)
    expect(suggestLengthFt('Nepkoala X')).toBeNull()
    expect(suggestLengthFt('Nepvaria 2010')).toBeNull()
    expect(suggestKind('Lagoon 42')).toBe('catamaran')
    expect(suggestKind('Nepteau SO 519')).toBeUndefined()
  })

  it('import: naam en model op de trips, lengte nooit stil ingevuld; bevestigen en overslaan', async () => {
    const result = parseMileageCsv(csv, NOW)
    expect(result.trips).toHaveLength(8)
    expect(result.trips.every((t) => t.boatLengthFt === undefined)).toBe(true)
    expect(result.trips[0]).toMatchObject({ name: 'Neptocht 1', boat: 'Nepzwaan', boatModel: 'Nepteau SO 519' })
    expect(result.trips[1]).toMatchObject({ boatModel: 'Sportnep 680' })
    expect(result.trips[1]!.boat).toBeUndefined()
    expect(result.trips[2]).toMatchObject({ boat: 'Nepkoala X' })
    expect(result.legs[0]!.date).toBe('2025-01-03')

    const store = await device()
    await mijlenImporteren(store, result)
    const boats = boatList(store.get('trips.json.enc'), store.get('legs.json.enc'))
    expect(boats).toHaveLength(8)
    const settings = currentSettings(store.get('settings.json.enc'))
    expect(uncheckedBoats(boats, settings)).toHaveLength(8)
    const zwaan = boats.find((b) => b.name === 'Nepzwaan')!
    expect(zwaan.suggestedLengthFt).toBe(52)

    await botenBevestigen(store, boats, [{ key: zwaan.key, name: 'Nepzwaan', model: 'Nepteau SO 519', lengthFt: 50, kind: 'eenromp' }])
    const trip = store.get('trips.json.enc').find((t) => t.boat === 'Nepzwaan')!
    expect(trip).toMatchObject({ boatLengthFt: 50, boatKind: 'eenromp' })
    await botenOverslaan(store, boats.filter((b) => b.key !== zwaan.key))
    const after = boatList(store.get('trips.json.enc'), store.get('legs.json.enc'))
    expect(uncheckedBoats(after, currentSettings(store.get('settings.json.enc')))).toEqual([])
  })

  it('eerder geïmporteerde data (trips met alleen een naam) zonder opnieuw te importeren', async () => {
    const trip: Trip = { id: 'oud', name: 'Oude tocht', updatedAt: NOW, deletedAt: null }
    const leg: Leg = {
      id: 'l1', tripId: 'oud', date: '2024-05-01', fromPlace: 'A', fromCountry: '', toPlace: 'B', toCountry: '', role: 'schipper', boat: 'Nepvlinder (Nepgoon 42)',
      nmInland: 0, nmSea: 10, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: NOW, deletedAt: null,
    }
    const store = await device()
    await put(store, 'trips.json.enc', trip)
    await put(store, 'legs.json.enc', leg)
    const boats = boatList(store.get('trips.json.enc'), store.get('legs.json.enc'))
    expect(boats).toMatchObject([{ name: 'Nepvlinder', model: 'Nepgoon 42', suggestedLengthFt: 42, suggestedKind: undefined, tripIds: ['oud'] }])
    // Aanvullen op zondag stelt de naam uit de boot voor, niet de hele tekst.
    expect(collectGaps([trip], [leg]).find((g) => g.kind === 'trip' && g.field === 'boat')?.suggestion).toBe('Nepvlinder')
    await botenBevestigen(store, boats, [{ key: boats[0]!.key, name: 'Nepvlinder', model: 'Nepgoon 42', lengthFt: 42, kind: 'catamaran' }])
    expect(store.get('trips.json.enc')[0]).toMatchObject({ boat: 'Nepvlinder', boatModel: 'Nepgoon 42', boatLengthFt: 42, boatKind: 'catamaran' })
  })
})
