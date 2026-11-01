import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { mijlenImporteren } from '../src/domain/importeren'
import { parseMileageCsv } from '../src/import/mileage-csv'
import { tripRange } from '../src/model/calendar'
import { active } from '../src/model/derive'
import type { Leg, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { goldenCounts, goldenCsv } from './helpers/gouden-dataset'
import { putMany } from './helpers/schrijf'
import { relations } from './helpers/relaties'

// De gouden dataset (tests/helpers/gouden-dataset.ts): een verzonnen mijlenregistratie zoals die van Olivier. Elke
// migratie en elke bulkactie moet alle relaties (welke dag bij welke tocht) en totalen gelijk laten.

const TOKEN = 'github_pat_GOUDEN_0123456789abcdefghijklmnopqrstuvwxyz0'
let counter = 0

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return Store.open(await openLogboekDb(`logboek-gouden-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
}

describe('gouden dataset', () => {
  it('importeert als 33 tochten met hun dagen', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(active(s.get('trips.json.enc'))).toHaveLength(goldenCounts().trips)
    expect(active(s.get('legs.json.enc'))).toHaveLength(goldenCounts().legs)
    // Geen tocht langer dan 9 dagen.
    for (const t of active(s.get('trips.json.enc'))) {
      const r = tripRange(t, s.get('legs.json.enc'))!
      expect((Date.parse(r.end) - Date.parse(r.start)) / 86_400_000, t.name).toBeLessThan(10)
    }
  })

  it('opnieuw importeren (vaste id\'s) laat elke dag bij zijn tocht', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const before = relations(s)
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(relations(s)).toEqual(before)
  })

  it('een logboek van vóór de vaste id\'s (willekeurige id\'s) opnieuw importeren laat elke dag bij zijn tocht', async () => {
    const s = await store()
    // Zoals de vorige versie importeerde: willekeurige id's voor tochten en dagen.
    const old = parseMileageCsv(goldenCsv())
    await putMany(s, 'trips.json.enc', old.trips as Trip[])
    await putMany(s, 'legs.json.enc', old.legs as Leg[])
    const before = relations(s)
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(relations(s)).toEqual(before)
  })
})


describe('gouden dataset: opnieuw importeren met eigen wijzigingen', () => {
  it('trips met eigen soort, organisatie en datums, een gewijzigde Excel en een tweede apparaat: elke dag bij zijn tocht', async () => {
    const s = await store()
    const old = parseMileageCsv(goldenCsv())
    await putMany(s, 'trips.json.enc', old.trips as Trip[])
    await putMany(s, 'legs.json.enc', old.legs as Leg[])
    // Eigen wijzigingen zoals in Trip bewerken en Nakijken: soort, organisatie, en vaste datums uit de dagen.
    const edited = active(s.get('trips.json.enc')).map((t, i) => {
      const r = tripRange(t, s.get('legs.json.enc'))!
      return i % 3 === 0 ? { ...t, kind: 'werk' as const, type: 'training-geven' as const, organisation: 'sailing-virgins' as const } : i % 3 === 1 ? { ...t, startDate: r.start, endDate: r.end } : t
    })
    await putMany(s, 'trips.json.enc', edited)
    const before = relations(s)
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(relations(s)).toEqual(before)
    // Nog een keer (een tweede apparaat met hetzelfde bestand).
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(relations(s)).toEqual(before)
  })
})

