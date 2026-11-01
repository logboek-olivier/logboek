import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { commit } from '../src/domain/commit'
import { logboekHerstellen, planSignature } from '../src/domain/herstel'
import { mijlenImporteren } from '../src/domain/importeren'
import { dagenNaarTrip, deelnemerVerwijderen, periodeSoortZetten, samenvoegen, periodeVervangen } from '../src/domain/trips'
import { geschiedenisOpruimen, terugzetten } from '../src/domain/prullenbak'
import type { Tx } from '../src/domain/tx'
import { parseMileageCsv } from '../src/import/mileage-csv'
import { tripRange } from '../src/model/calendar'
import { active } from '../src/model/derive'
import { backupLinks, compareWithBackup, isEmptyPlan, longImportTrips, planLinkRepair } from '../src/model/link-repair'
import { movedAway, trashItems } from '../src/model/trash'
import { followDays } from '../src/model/trip-dates'
import type { Leg, SyncRecord, Trip } from '../src/model/types'
import { addDays } from '../src/basis/datum'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { goldenCsv } from './helpers/gouden-dataset'
import { relations, totals } from './helpers/relaties'
import { putMany } from './helpers/schrijf'

// Logboek herstellen (src/model/link-repair.ts, src/domain/herstel.ts) op de gouden dataset: de schade zoals de vorige
// versie die maakte, het voorbeeld, één tik, en ongedaan maken.

const TOKEN = 'github_pat_HERSTEL_0123456789abcdefghijklmnopqrstuvwxyz'
const T2 = '2026-10-30T10:00:00.000Z'
let counter = 0

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return Store.open(await openLogboekDb(`logboek-herstel-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
}

async function forgetHistory(s: Store): Promise<void> {
  await putMany(s, 'history.json.enc', s.get('history.json.enc').map((e) => ({ ...e, at: '2099-01-01T00:00:00.000Z', deletedAt: '2099-01-01T00:00:00.000Z' })))
}

/** De trips van de gouden dataset op volgorde van begin. */
function ordered(s: Store): Trip[] {
  const legs = s.get('legs.json.enc')
  return [...active(s.get('trips.json.enc'))].sort((a, b) => (tripRange(a, legs)!.start < tripRange(b, legs)!.start ? -1 : 1))
}

const trip = (s: Store, id: string) => s.get('trips.json.enc').find((x) => x.id === id)!

/** Studenten (deelnemers met een cursus) bij twee trips. */
async function withPeople(s: Store, trips: readonly Trip[]): Promise<void> {
  for (const [i, t] of trips.entries()) {
    const pid = `h-${i}`
    await putMany(s, 'trips.json.enc', [{ ...trip(s, t.id), participants: [{ id: pid, firstName: `Neph${i}`, curriculumId: 'seed-asa-101', level: 'beginner' }] }])
    await putMany(s, 'students.json.enc', [{ id: pid, firstName: `Neph${i}`, curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, weekId: t.id, updatedAt: new Date().toISOString(), deletedAt: null }])
  }
}

/** Terugzetten zoals de vorige versie het deed: dagen en studenten terug, de overblijvende trip niet. */
async function oldRestore(s: Store): Promise<void> {
  const item = trashItems(s).find((i) => i.kind === 'periode')!
  const away = movedAway(s, item)
  await commit(s, 'terugzetten', async (tx: Tx) => {
    for (const { path, record } of item.legacy) {
      const current = tx.get(path).find((r) => r.id === record.id)
      if (current && current.deletedAt === record.deletedAt) await tx.put(path, { ...current, deletedAt: null, updatedAt: tx.now } as never)
    }
    const restored = item.legacy.find((r) => r.path === 'trips.json.enc')!.record
    for (const m of away) {
      const field = m.path === 'students.json.enc' ? 'weekId' : 'tripId'
      await tx.put(m.path, { ...m.record, [field]: restored.id, updatedAt: tx.now } as SyncRecord as never)
    }
    await followDays(tx, [restored.id, ...away.map((m) => m.tripId)])
  })
}

async function repaired(s: Store): Promise<() => Promise<void>> {
  const plan = planLinkRepair(s)
  const { result, undo } = await logboekHerstellen(s, planSignature(plan))
  expect(result.applied).toBe(true)
  return undo
}

describe('Logboek herstellen: samenvoegen of vervangen van vóór de geschiedenis, teruggezet met de vorige versie', () => {
  for (const how of ['samenvoegen', 'vervangen'] as const) {
    it(`${how}: datums, deelnemers en studenten weer bij hun eigen trip, ongedaan te maken`, async () => {
      const s = await store()
      await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
      const trips = ordered(s)
      await withPeople(s, [trips[11]!, trips[12]!])
      const before = relations(s)
      const sums = totals(s)
      if (how === 'samenvoegen') await samenvoegen(s, trip(s, trips[11]!.id), trip(s, trips[12]!.id))
      else await periodeVervangen(s, trip(s, trips[11]!.id), trip(s, trips[12]!.id))
      await forgetHistory(s)
      await oldRestore(s)
      const damaged = relations(s)
      // De schade: de overblijvende trip loopt over de teruggezette heen, en een deelnemer staat dubbel.
      expect(damaged).not.toEqual(before)

      const plan = planLinkRepair(s)
      expect(isEmptyPlan(plan)).toBe(false)
      const undo = await repaired(s)
      expect(relations(s)).toEqual(before)
      expect(totals(s)).toEqual(sums)
      // Nog een keer: niets meer te doen (idempotent).
      expect(isEmptyPlan(planLinkRepair(s))).toBe(true)
      // Ongedaan maken: weer zoals vóór het herstel.
      await undo()
      expect(relations(s)).toEqual(damaged)
    })
  }

  it('deelnemers die Olivier bij de verkeerde trip verwijderde: staan al bij hun eigen trip, niets dubbel terug', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    await withPeople(s, [trips[11]!, trips[12]!])
    const before = relations(s)
    await samenvoegen(s, trip(s, trips[11]!.id), trip(s, trips[12]!.id))
    await forgetHistory(s)
    await oldRestore(s)
    // De deelnemer van de teruggezette trip staat ook bij de overblijvende; Olivier haalt hem daar weg.
    await deelnemerVerwijderen(s, trip(s, trips[11]!.id), 'h-1')
    const plan = planLinkRepair(s)
    expect(plan.participants).toEqual([])
    expect(plan.alreadyHome.map((h) => [h.participant.id, h.at])).toEqual([['h-1', trips[12]!.id]])
    await repaired(s)
    expect(relations(s)).toEqual(before)
  })

  it('een deelnemer die verhuisde en bij de verkeerde trip verwijderd werd: terug bij de trip van zijn student', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    await withPeople(s, [trips[11]!, trips[12]!])
    const before = relations(s)
    // Verkeerd verhuisd (alleen de deelnemer, de student bleef), daarna bij de verkeerde trip verwijderd.
    await putMany(s, 'trips.json.enc', [
      { ...trip(s, trips[12]!.id), participants: [] },
      { ...trip(s, trips[11]!.id), participants: [...(trip(s, trips[11]!.id).participants ?? []), ...(trip(s, trips[12]!.id).participants ?? [])] },
    ])
    await deelnemerVerwijderen(s, trip(s, trips[11]!.id), 'h-1')
    const plan = planLinkRepair(s)
    expect(plan.participants.map((b) => [b.participant.id, b.from, b.to])).toEqual([['h-1', trips[11]!.id, trips[12]!.id]])
    await repaired(s)
    expect(relations(s)).toEqual(before)
  })
})

describe('Logboek herstellen: dagen bij de verkeerde trip', () => {
  /** Dagen van twee latere trips verkeerd aan een vroege trip gehangen door een terugzetten (met regel in de geschiedenis). */
  async function misplace(s: Store, target: Trip, victims: readonly Trip[]): Promise<void> {
    const ids = new Set(victims.map((v) => v.id))
    await commit(s, 'terugzetten', async (tx: Tx) => {
      for (const leg of tx.list('legs.json.enc')) if (ids.has(leg.tripId)) await tx.put('legs.json.enc', { ...leg, tripId: target.id, updatedAt: tx.now })
    })
  }

  it('geïmporteerd met vaste id\'s: het id zegt waar de dag hoort', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    const before = relations(s)
    await misplace(s, trips[5]!, [trips[9]!, trips[14]!])
    // Zo ontstaat een trip van maanden; Nakijken ziet hem.
    expect(longImportTrips(s).map((x) => x.trip.id)).toEqual([trips[5]!.id])
    const plan = planLinkRepair(s)
    expect(new Set(plan.legs.map((m) => m.why))).toEqual(new Set(['import']))
    await repaired(s)
    expect(relations(s)).toEqual(before)
    expect(longImportTrips(s)).toEqual([])
  })

  it('de geschiedenis alleen is geen bewijs voor een dag (een eigen verplaatsing of een juist terugzetten ziet er hetzelfde uit)', async () => {
    const s = await store()
    const old = parseMileageCsv(goldenCsv())
    await putMany(s, 'trips.json.enc', old.trips as Trip[])
    await putMany(s, 'legs.json.enc', old.legs as Leg[])
    const trips = ordered(s)
    await misplace(s, trips[20]!, [trips[24]!])
    const plan = planLinkRepair(s)
    expect(plan.legs).toEqual([])
    expect(plan.stillLong.map((t) => t.id)).toEqual([trips[20]!.id])
  })

  it('een dag waarvan het vaste id zijn trip bevestigt, blijft altijd staan, ook in een lange trip', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    // Een echte lange trip: de dagen van een latere tocht krijgen dezelfde trip in hun id (zoals een import van één lange tocht).
    const late = active(s.get('legs.json.enc')).filter((l) => l.tripId === trips[9]!.id)
    await putMany(s, 'legs.json.enc', late.map((l) => ({ ...l, updatedAt: T2, deletedAt: T2 })))
    await putMany(s, 'legs.json.enc', late.map((l) => ({ ...l, id: l.id.replace(`import:${trips[9]!.id}:`, `import:${trips[5]!.id}:`), tripId: trips[5]!.id })))
    expect(longImportTrips(s).map((x) => x.trip.id)).toContain(trips[5]!.id)
    expect(planLinkRepair(s).legs).toEqual([])
  })

  it('zonder bewijs verplaatst het herstel niets: de trip staat dan alleen in Nakijken', async () => {
    const s = await store()
    const old = parseMileageCsv(goldenCsv())
    await putMany(s, 'trips.json.enc', old.trips as Trip[])
    await putMany(s, 'legs.json.enc', old.legs as Leg[])
    const trips = ordered(s)
    // Zonder regel in de geschiedenis (een gewone schrijfactie in de test).
    const victims = new Set([trips[24]!.id])
    await putMany(s, 'legs.json.enc', active(s.get('legs.json.enc')).filter((l) => victims.has(l.tripId)).map((l) => ({ ...l, tripId: trips[20]!.id })))
    const plan = planLinkRepair(s)
    expect(plan.legs).toEqual([])
    expect(plan.stillLong.map((t) => t.id)).toEqual([trips[20]!.id])
  })

  it('met een back-up van vóór de schade als bewijs: ook dagen zonder vast id of geschiedenis gaan terug', async () => {
    const s = await store()
    const old = parseMileageCsv(goldenCsv())
    await putMany(s, 'trips.json.enc', old.trips as Trip[])
    await putMany(s, 'legs.json.enc', old.legs as Leg[])
    const trips = ordered(s)
    const before = relations(s)
    // De back-up van toen (alleen in het geheugen).
    const files = new Map<string, SyncRecord[]>([
      ['trips.json.enc', [...s.get('trips.json.enc')]],
      ['legs.json.enc', [...s.get('legs.json.enc')]],
    ])
    const victims = new Set([trips[24]!.id])
    await putMany(s, 'legs.json.enc', active(s.get('legs.json.enc')).filter((l) => victims.has(l.tripId)).map((l) => ({ ...l, tripId: trips[20]!.id })))
    const damaged = relations(s)
    // Vergelijken: de dagen staan nu bij een andere trip; er wordt niets geschreven.
    const comparison = compareWithBackup(s, files)
    expect(comparison.legs).toBeGreaterThan(0)
    expect(comparison.ranges.map((r) => r.trip.id)).toEqual(expect.arrayContaining([trips[20]!.id, trips[24]!.id]))
    expect(relations(s)).toEqual(damaged)
    const links = backupLinks(files)
    const plan = planLinkRepair(s, undefined, links)
    expect(new Set(plan.legs.map((m) => m.why))).toEqual(new Set(['back-up']))
    const { result } = await logboekHerstellen(s, planSignature(plan), links)
    expect(result.applied).toBe(true)
    expect(relations(s)).toEqual(before)
  })

  it('het voorbeeld klopt niet meer bij de tik (een ander apparaat): niets geschreven', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    await misplace(s, trips[5]!, [trips[9]!])
    const damaged = relations(s)
    const shown = planSignature(planLinkRepair(s))
    await misplace(s, trips[5]!, [trips[14]!])
    const after = relations(s)
    const { result } = await logboekHerstellen(s, shown)
    expect(result.applied).toBe(false)
    expect(relations(s)).toEqual(after)
    expect(after).not.toEqual(damaged)
  })
})

describe('Logboek herstellen: punten uit de review', () => {
  it('twee deelnemers dubbel, Olivier haalt er één weg bij de verkeerde trip: de teruggezette trip houdt ze allebei', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    await withPeople(s, [trips[11]!])
    const people = [
      { id: 'b-1', firstName: 'Nepb1', curriculumId: 'seed-asa-101', level: 'beginner' as const },
      { id: 'b-2', firstName: 'Nepb2', curriculumId: 'seed-asa-101', level: 'beginner' as const },
    ]
    await putMany(s, 'trips.json.enc', [{ ...trip(s, trips[12]!.id), participants: people }])
    await putMany(s, 'students.json.enc', people.map((p) => ({ ...p, progress: {}, weekId: trips[12]!.id, updatedAt: T2, deletedAt: null })))
    const before = relations(s)
    await samenvoegen(s, trip(s, trips[11]!.id), trip(s, trips[12]!.id))
    await forgetHistory(s)
    await oldRestore(s)
    await deelnemerVerwijderen(s, trip(s, trips[11]!.id), 'b-1')
    await repaired(s)
    expect(relations(s).participants).toEqual(before.participants)
    expect(relations(s).ranges).toEqual(before.ranges)
    expect(relations(s).legs).toEqual(before.legs)
  })

  it('datums die Olivier zelf instelde (een trip met eigen dagen over een andere trip heen): het herstel laat ze staan', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    const legs = s.get('legs.json.enc')
    // Een trip uit de planning, deels in de app gelogd (eigen dagen), loopt over een geïmporteerde tocht heen.
    const own = active(legs).filter((l) => l.tripId === trips[5]!.id).map((l) => ({ ...l, source: 'manual' as const }))
    await putMany(s, 'legs.json.enc', own)
    const later = tripRange(trips[6]!, legs)!
    await putMany(s, 'trips.json.enc', [{ ...trip(s, trips[5]!.id), startDate: tripRange(trips[5]!, legs)!.start, endDate: addDays(later.end, 2) }])
    expect(planLinkRepair(s).trips.map((f) => f.trip.id)).not.toContain(trips[5]!.id)
  })

  it('terugzetten vindt de overblijvende trip ook als die na het samenvoegen nog bewerkt werd', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    await withPeople(s, [trips[11]!, trips[12]!])
    const before = relations(s)
    await samenvoegen(s, trip(s, trips[11]!.id), trip(s, trips[12]!.id))
    await periodeSoortZetten(s, trip(s, trips[11]!.id), 'zelf-cruisen')
    await forgetHistory(s)
    const item = trashItems(s).find((i) => i.kind === 'periode')!
    await terugzetten(s, item.key, movedAway(s, item).map((m) => m.record.id))
    expect(relations(s)).toEqual(before)
  })

  it('samengevoegd en daarna de Excel opnieuw geïmporteerd: de deelnemers en studenten gaan naar de nieuwe trip, de datums terug', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    await withPeople(s, [trips[11]!, trips[12]!])
    const before = relations(s)
    await samenvoegen(s, trip(s, trips[11]!.id), trip(s, trips[12]!.id))
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const damaged = relations(s)
    expect(damaged).not.toEqual(before)
    const plan = planLinkRepair(s)
    expect(plan.moves.map((m) => m.participant.id)).toEqual(['h-1'])
    await repaired(s)
    expect(relations(s)).toEqual(before)
    expect(isEmptyPlan(planLinkRepair(s))).toBe(true)
  })

  it('opnieuw importeren laat een dag die Olivier zelf naar een andere trip zette, daar staan', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    const leg = active(s.get('legs.json.enc')).find((l) => l.tripId === trips[3]!.id)!
    await dagenNaarTrip(s, [leg], trip(s, trips[4]!.id))
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(s.get('legs.json.enc').find((l) => l.id === leg.id)!.tripId).toBe(trips[4]!.id)
  })

  it('opruimen na 30 dagen loopt nooit vast op de regels die op de geschiedenis leunen', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = ordered(s)
    const legs = s.get('legs.json.enc')
    // Olivier zette zelf datums over de volgende tocht heen (met regel in de geschiedenis) ...
    await commit(s, 'periodeBewerken', async (tx: Tx) => {
      await tx.put('trips.json.enc', { ...trip(s, trips[5]!.id), startDate: tripRange(trips[5]!, legs)!.start, endDate: tripRange(trips[6]!, legs)!.end, updatedAt: tx.now })
    })
    // ... en 31 dagen later ruimt de app de geschiedenis op.
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString()
    await putMany(s, 'history.json.enc', s.get('history.json.enc').map((e) => ({ ...e, at: old })))
    await expect(geschiedenisOpruimen(s)).resolves.toBeTypeOf('function')
  })
})
