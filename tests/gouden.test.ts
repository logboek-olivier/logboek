import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { mijlenImporteren } from '../src/domain/importeren'
import { terugzetten } from '../src/domain/prullenbak'
import { periodeVerwijderen, periodeVervangen, samenvoegen } from '../src/domain/trips'
import { movedAway, trashItems } from '../src/model/trash'
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

describe('gouden dataset: prullenbak van vóór de geschiedenis', () => {
  /** Zoals de vorige versie: verwijderingen zonder regel in de geschiedenis. */
  async function forgetHistory(s: Store): Promise<void> {
    const entries = s.get('history.json.enc').map((e) => ({ ...e, at: '2099-01-01T00:00:00.000Z', deletedAt: '2099-01-01T00:00:00.000Z' }))
    await putMany(s, 'history.json.enc', entries)
  }

  it('een trip die met "Meenemen naar trip …" verwijderd werd, terugzetten met wat aangevinkt staat: alles weer zoals vóór het verwijderen', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = [...active(s.get('trips.json.enc'))].sort((a, b) => (tripRange(a, s.get('legs.json.enc'))!.start < tripRange(b, s.get('legs.json.enc'))!.start ? -1 : 1))
    // Deelnemers met een cursus (studenten) bij een paar trips.
    const withPeople = [trips[19]!, trips[20]!, trips[21]!]
    for (const [i, t] of withPeople.entries()) {
      const pid = `p-${i}`
      await putMany(s, 'trips.json.enc', [{ ...t, participants: [{ id: pid, firstName: `Nep${i}`, curriculumId: 'seed-asa-101', level: 'beginner' }] }])
      await putMany(s, 'students.json.enc', [{ id: pid, firstName: `Nep${i}`, curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, weekId: t.id, updatedAt: new Date().toISOString(), deletedAt: null }])
    }
    const before = relations(s)
    const studentsBefore = active(s.get('students.json.enc')).map((x) => `${x.firstName} → ${s.get('trips.json.enc').find((t) => t.id === x.weekId)?.name}`).sort()
    // Per ongeluk verwijderd, dagen mee naar de trip ernaast (zoals de vorige versie dat deed).
    await periodeVerwijderen(s, s.get('trips.json.enc').find((t) => t.id === trips[20]!.id)!, s.get('trips.json.enc').find((t) => t.id === trips[21]!.id)!)
    await forgetHistory(s)
    const item = trashItems(s).find((i) => i.kind === 'periode')!
    expect(item).toBeTruthy()
    // Terugzetten met wat de prullenbak vooraf aanvinkt.
    await terugzetten(s, item.key, movedAway(s, item).map((m) => m.record.id))
    expect(relations(s)).toEqual(before)
    expect(active(s.get('students.json.enc')).map((x) => `${x.firstName} → ${s.get('trips.json.enc').find((t) => t.id === x.weekId)?.name}`).sort()).toEqual(studentsBefore)
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

describe('gouden dataset: samenvoegen of vervangen van vóór de geschiedenis, terugzetten', () => {
  async function forgetHistory(s: Store): Promise<void> {
    const entries = s.get('history.json.enc').map((e) => ({ ...e, at: '2099-01-01T00:00:00.000Z', deletedAt: '2099-01-01T00:00:00.000Z' }))
    await putMany(s, 'history.json.enc', entries)
  }
  const studentsOf = (s: Store) => active(s.get('students.json.enc')).map((x) => `${x.firstName} → ${s.get('trips.json.enc').find((t) => t.id === x.weekId)?.name}`).sort()
  const participantsOf = (s: Store) => active(s.get('trips.json.enc')).map((t) => `${t.name}: ${(t.participants ?? []).map((p) => p.firstName).sort().join(',')}`).sort()

  for (const how of ['samenvoegen', 'vervangen'] as const) {
    it(`${how}: terugzetten zet dagen en deelnemers terug bij hun eigen trip`, async () => {
      const s = await store()
      await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
      const legs = s.get('legs.json.enc')
      const trips = [...active(s.get('trips.json.enc'))].sort((a, b) => (tripRange(a, legs)!.start < tripRange(b, legs)!.start ? -1 : 1))
      for (const [i, t] of [trips[11]!, trips[12]!].entries()) {
        const pid = `q-${i}`
        await putMany(s, 'trips.json.enc', [{ ...s.get('trips.json.enc').find((x) => x.id === t.id)!, participants: [{ id: pid, firstName: `Nepq${i}`, curriculumId: 'seed-asa-101', level: 'beginner' }] }])
        await putMany(s, 'students.json.enc', [{ id: pid, firstName: `Nepq${i}`, curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, weekId: t.id, updatedAt: new Date().toISOString(), deletedAt: null }])
      }
      const before = relations(s)
      const sBefore = studentsOf(s)
      const pBefore = participantsOf(s)
      const keep = s.get('trips.json.enc').find((x) => x.id === trips[11]!.id)!
      const other = s.get('trips.json.enc').find((x) => x.id === trips[12]!.id)!
      if (how === 'samenvoegen') await samenvoegen(s, keep, other)
      else await periodeVervangen(s, keep, other)
      await forgetHistory(s)
      const item = trashItems(s).find((i) => i.kind === 'periode')!
      await terugzetten(s, item.key, movedAway(s, item).map((m) => m.record.id))
      expect(relations(s).legs).toEqual(before.legs)
      expect(studentsOf(s)).toEqual(sBefore)
      expect(relations(s).ranges).toEqual(before.ranges)
      expect(participantsOf(s)).toEqual(pBefore)
    })
  }
})
