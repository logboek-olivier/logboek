import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { commit, type Written } from '../src/domain/commit'
import { applyImport } from '../src/import/apply'
import { parseMileageCsv } from '../src/import/mileage-csv'
import { tripRange } from '../src/model/calendar'
import { active } from '../src/model/derive'
import { bookFixedCosts } from '../src/model/fixed-bookings'
import { migratePeriods } from '../src/model/migrate-periods'
import { pruneTrash } from '../src/domain/prullenbak'
import type { CalendarDay, Leg, Student, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { goldenCsv, goldenDate, goldenTrips } from './helpers/gouden-dataset'
import { moneyLinks, relations, totals } from './helpers/relaties'
import { putMany } from './helpers/schrijf'
import type { Tx } from '../src/domain/tx'

// Eigenschappen van elke migratie en elke automatische stap op de gouden dataset (tests/helpers/gouden-dataset.ts), in
// willekeurige varianten (eigen soort, organisatie en datums, deelnemers en studenten, agendadagen, geld, vaste lasten,
// een logboek van vóór de vaste id's):
// - relaties en totalen zijn na afloop gelijk aan vooraf (elke dag, deelnemer, student en transactie houdt zijn trip);
// - idempotent: twee keer draaien = één keer (de tweede keer schrijft niets).
// Een vast zaad per variant: een fout is na te spelen. Meer varianten: GOUDEN=200 npx vitest run tests/migraties-gouden

const RUNS = Number(process.env.GOUDEN ?? 24)
const TOKEN = 'github_pat_GOUDENMIGRATIE_0123456789abcdefghijklmnopqrst'
let counter = 0

function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p }
}

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return Store.open(await openLogboekDb(`logboek-gouden-migratie-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const T = '2026-10-01T10:00:00.000Z'

/** Een variant van de gouden dataset zoals een echt logboek dat kan hebben. */
async function variant(seed: number): Promise<Store> {
  const r = random(seed)
  const s = await store()
  const parsed = parseMileageCsv(goldenCsv())
  if (r.chance(0.5)) {
    // Van vóór de vaste id's: willekeurige id's voor tochten en dagen.
    await putMany(s, 'trips.json.enc', parsed.trips as Trip[])
    await putMany(s, 'legs.json.enc', parsed.legs as Leg[])
  } else {
    await commit(s, 'test', (tx) => applyImport(tx, parsed))
  }
  const legs = s.get('legs.json.enc')
  const trips = [...active(s.get('trips.json.enc'))].sort((a, b) => (tripRange(a, legs)!.start < tripRange(b, legs)!.start ? -1 : 1))
  const edited: Trip[] = []
  const students: Student[] = []
  const money: Transaction[] = []
  for (const [i, trip] of trips.entries()) {
    const range = tripRange(trip, legs)!
    let next: Trip = trip
    if (r.chance(0.3)) next = { ...next, kind: 'werk', type: 'training-geven', organisation: r.chance(0.5) ? 'sailing-virgins' : 'yacht-week' }
    if (r.chance(0.3)) next = { ...next, startDate: range.start, endDate: addDays(range.end, r.int(3)) }
    if (r.chance(0.3)) {
      const people = Array.from({ length: 1 + r.int(3) }, (_, k) => ({ id: `g${seed}-${i}-${k}`, firstName: `Nepg${k}`, curriculumId: 'seed-asa-101', level: 'beginner' as const }))
      next = { ...next, participants: people }
      for (const p of people) students.push({ id: p.id, firstName: p.firstName, curriculumId: p.curriculumId, level: p.level, progress: {}, weekId: trip.id, startedAt: range.start, updatedAt: T, deletedAt: null })
    }
    if (r.chance(0.4)) money.push({ id: `fooi-${seed}-${i}`, date: range.end, kind: 'fooi', amount: 10 + r.int(90), currency: 'EUR', source: 'overig', tripId: trip.id, updatedAt: T, deletedAt: null })
    if (next !== trip) edited.push({ ...next, updatedAt: T })
  }
  await putMany(s, 'trips.json.enc', edited)
  await putMany(s, 'students.json.enc', students)
  // Agendadagen van vóór het periodemodel tussen de trips (thuis en reis), en een uitgave op zo'n dag zonder trip.
  const days: CalendarDay[] = []
  for (let i = 0; i + 1 < trips.length; i++) {
    if (!r.chance(0.4)) continue
    const end = tripRange(trips[i]!, legs)!.end
    const type = r.chance(0.5) ? 'thuis' : 'reis'
    for (let d = 2; d < 4; d++) days.push({ id: `dag:${addDays(end, d)}`, date: addDays(end, d), type, updatedAt: T, deletedAt: null })
    if (r.chance(0.5)) money.push({ id: `uitgave-${seed}-${i}`, date: addDays(end, 2), kind: 'kosten', amount: 5 + r.int(40), currency: 'EUR', source: 'overig', category: 'eten', updatedAt: T, deletedAt: null })
  }
  await putMany(s, 'calendar.json.enc', days)
  await putMany(s, 'transactions.json.enc', money)
  if (r.chance(0.5)) await putMany(s, 'fixedcosts.json.enc', [{ id: `vast-${seed}`, name: 'Nepabonnement', currency: 'EUR', amounts: [{ from: '2026-01', amount: 9 }], updatedAt: T, deletedAt: null }])
  await s.sync()
  return s
}

/** Alles wat er in het logboek staat (zonder tijden): voor "twee keer = één keer". */
function content(s: Store): string {
  const paths = ['trips.json.enc', 'legs.json.enc', 'transactions.json.enc', 'students.json.enc', 'calendar.json.enc', 'periods.json.enc', 'settings.json.enc', 'plans.json.enc'] as const
  return JSON.stringify(paths.map((p) => [p, active(s.get(p)).map((x) => ({ ...x, updatedAt: '' })).sort((a, b) => (a.id < b.id ? -1 : 1))]))
}

type Step = { name: string; run: (tx: Tx) => Promise<unknown> }

const IMPORT_CSV = goldenCsv()
const STEPS: Step[] = [
  { name: 'periodemodelMigreren', run: (tx) => migratePeriods(tx) },
  { name: 'vasteLastenBoeken', run: (tx) => bookFixedCosts(tx, '2026-11-01') },
  { name: 'geschiedenisOpruimen', run: (tx) => pruneTrash(tx) },
  { name: 'mijlenImporteren', run: (tx) => applyImport(tx, parseMileageCsv(IMPORT_CSV)) },

]

async function step(s: Store, st: Step): Promise<Written[]> {
  return (await commit(s, st.name, st.run)).written
}

describe('gouden dataset: elke migratie houdt relaties en totalen, en is idempotent', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`variant ${seed}`, async () => {
      const s = await variant(seed)
      const before = relations(s)
      const sums = totals(s)
      const money = moneyLinks(s)
      let migrated = false
      for (const st of STEPS) {
        const written = await step(s, st)
        if (st.name === 'periodemodelMigreren') migrated = written.length > 0
        // Excel importeren geeft elke geïmporteerde trip het begin en eind van zijn blok (uitgangspunt 1); verder blijft
        // elke relatie gelijk.
        if (st.name === 'mijlenImporteren') {
          expect({ ...relations(s), ranges: [] }, `${st.name} (zaad ${seed})`).toEqual({ ...before, ranges: [] })
          for (const golden of goldenTrips()) {
            const trip = active(s.get('trips.json.enc')).find((t) => t.startDate === goldenDate(golden, 0))
            expect(trip?.endDate, `${golden.name} (zaad ${seed})`).toBe(goldenDate(golden, golden.days.length - 1))
          }
        } else expect(relations(s), `${st.name} (zaad ${seed})`).toEqual(before)
        expect(totals(s), `${st.name} (zaad ${seed})`).toEqual(sums)
        // Elke transactie houdt zijn periode (nieuwe, zoals geboekte vaste lasten, tellen niet).
        const after = moneyLinks(s)
        for (const [id, trip] of money) expect(after.get(id), `${st.name}: geld ${id} (zaad ${seed})`).toBe(trip)
        const once = content(s)
        // Twee keer = één keer: de tweede keer verandert niets.
        await step(s, st)
        expect(content(s), `${st.name} twee keer (zaad ${seed})`).toEqual(once)
      }
      // De omzetting naar het periodemodel had iets te doen (agendadagen werden periodes), behalve zonder agendadagen.
      expect(migrated || active(s.get('calendar.json.enc')).length === 0, `omzetting (zaad ${seed})`).toBe(true)
      // En alles nog een keer in dezelfde volgorde: niets meer te doen.
      const settled = content(s)
      for (const st of STEPS) await step(s, st)
      expect(content(s), `alles nog een keer (zaad ${seed})`).toEqual(settled)
    })
  }
})

describe('proef op een kopie: een automatische stap die een koppeling verandert, schrijft niets', () => {
  it('een migratie die een dag naar een andere trip zet, wordt tegengehouden; het logboek blijft zoals het was', async () => {
    const s = await variant(7)
    const before = content(s)
    const legs = active(s.get('legs.json.enc'))
    const other = active(s.get('trips.json.enc')).find((t) => t.id !== legs[0]!.tripId)!
    await expect(
      commit(s, 'periodemodelMigreren', async (tx) => {
        await tx.put('legs.json.enc', { ...legs[0]!, tripId: other.id, updatedAt: tx.now })
      }),
    ).rejects.toThrow(/Relatie/)
    expect(content(s)).toEqual(before)
  })

  it('een migratie die een deelnemer van trip wisselt, wordt tegengehouden', async () => {
    const s = await variant(3)
    const withPeople = active(s.get('trips.json.enc')).find((t) => (t.participants ?? []).length > 0)!
    const other = active(s.get('trips.json.enc')).find((t) => t.id !== withPeople.id)!
    const before = content(s)
    await expect(
      commit(s, 'vasteLastenBoeken', async (tx) => {
        await tx.put('trips.json.enc', { ...withPeople, participants: [], updatedAt: tx.now })
        await tx.put('trips.json.enc', { ...other, participants: withPeople.participants, updatedAt: tx.now })
      }),
    ).rejects.toThrow(/Relatie/)
    expect(content(s)).toEqual(before)
  })

})
