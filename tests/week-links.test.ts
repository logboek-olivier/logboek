import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { studentInTripToevoegen, studentVanDeelnemer } from '../src/domain/training'
import { violations } from '../src/domain/invariants'
import { NO_FILTER, studentGroups } from '../src/model/student-groups'
import type { Leg, Student, Trip, WeekPlan } from '../src/model/types'
import { participantsWithoutStudent, planWeek, startWeek, studentWeek, syncParticipants, type WeekInput } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put } from './helpers/schrijf'
import { periodeBewerken } from '../src/domain/trips'

// Studenten en planningen horen bij een week. Oudere data (zonder weekId/tripId) wordt gekoppeld aan de week waarin
// de datum valt, zonder te schrijven; anders "zonder week". Alle gegevens zijn verzonnen.

const TOKEN = 'github_pat_WEEKLINKS_0123456789abcdefghijklmnopqrstuvwxyz'
const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device() {
  const db = await openLogboekDb(`logboek-weeklinks-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const week: Trip = { id: 'w1', name: 'Week 44', type: 'training-geven', startDate: '2026-10-26', endDate: '2026-11-01', updatedAt: NOW, deletedAt: null }
const oldTrip: Trip = { id: 't-oud', name: 'Nepboot mei 2026', updatedAt: NOW, deletedAt: null }
const leg: Leg = {
  id: 'l1', tripId: 't-oud', date: '2026-05-10', fromPlace: 'A', fromCountry: 'NL', toPlace: 'B', toCountry: 'NL', role: 'instructeur', boat: 'Nepboot',
  nmInland: 0, nmSea: 5, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: NOW, deletedAt: null,
}

/** Student zoals de huidige versie hem schrijft: zonder weekId. */
function oldStudent(id: string, startedAt?: string): Student {
  return { id, firstName: 'Nep', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, archivedAt: null, updatedAt: NOW, deletedAt: null, ...(startedAt ? { startedAt } : {}) }
}

/** Planning zoals de huidige versie hem schrijft: tripId optioneel. */
function oldPlan(id: string, startDate: string, tripId?: string): WeekPlan {
  return { id, title: 'Nepplan', startDate, dayCount: 3, groups: [], days: [], updatedAt: NOW, deletedAt: null, ...(tripId ? { tripId } : {}) }
}

describe('koppelen aan een week (migratie zonder schrijven)', () => {
  it('studenten: opgeslagen weekId, anders de week van de begindatum (ook een afgeleide week uit dagen), anders zonder week', () => {
    const trips = [week, oldTrip]
    expect(studentWeek({ ...oldStudent('a'), weekId: 'w1' }, trips, [leg])).toBe('w1')
    expect(studentWeek(oldStudent('b', '2026-10-28'), trips, [leg])).toBe('w1')
    expect(studentWeek(oldStudent('c', '2026-05-10'), trips, [leg])).toBe('t-oud')
    expect(studentWeek(oldStudent('d', '2025-01-01'), trips, [leg])).toBeNull()
    expect(studentWeek(oldStudent('e'), trips, [leg])).toBeNull()
    // Een verwijderde week telt niet.
    expect(studentWeek({ ...oldStudent('f', '2025-01-01'), weekId: 'weg' }, trips, [leg])).toBeNull()
  })

  it('planningen: opgeslagen tripId, anders de week van de startdatum, anders zonder week', () => {
    expect(planWeek(oldPlan('p1', '2026-01-01', 'w1'), [week], [])).toBe('w1')
    expect(planWeek(oldPlan('p2', '2026-10-30'), [week], [])).toBe('w1')
    expect(planWeek(oldPlan('p3', '2026-12-01'), [week], [])).toBeNull()
  })
})

describe('deelnemers en studenten', () => {
  const input: WeekInput = {
    name: 'Nepweek',
    type: 'training-geven',
    startDate: '2026-10-26',
    dayCount: 7,
    boat: 'Nepboot',
    boatModel: 'Nepmodel 40',
    boatLengthFt: 40,
    base: 'Nepbasis',
    charter: '',
    area: '',
    participants: [{ firstName: 'Nepanna', level: 'gemiddeld', curriculumId: 'seed-asa-101' }, { firstName: 'Nepbram' }],
    note: '',
  }

  it('een deelnemer met cursus krijgt een student met hetzelfde id; bijwerken past naam en niveau aan en houdt de voortgang', async () => {
    const store = await device()
    const trip = await inTx(store, startWeek, input, 'nl')
    const anna = trip.participants!.find((p) => p.firstName === 'Nepanna')!
    const student = store.list('students.json.enc').find((s) => s.id === anna.id)!
    expect(student).toMatchObject({ firstName: 'Nepanna', level: 'gemiddeld', curriculumId: 'seed-asa-101', weekId: trip.id, startedAt: '2026-10-26' })
    // In een trip waarin Olivier les geeft, is ook Nepbram (zonder cursus) een student; een cursus kiezen kan later.
    expect(store.list('students.json.enc')).toHaveLength(2)
    expect(store.list('students.json.enc').find((s) => s.firstName === 'Nepbram')).toMatchObject({ curriculumId: '', weekId: trip.id })

    await put(store, 'students.json.enc', { ...student, progress: { t1: { status: 'beheerst', updatedAt: NOW } } })
    await periodeBewerken(store, store.list('trips.json.enc')[0]!, { ...input, participants: [{ id: anna.id, firstName: 'Anna-Nep', level: 'gevorderd', curriculumId: 'seed-asa-101' }] }, 'nl')
    const after = store.list('students.json.enc').find((s) => s.id === anna.id)!
    expect(after).toMatchObject({ firstName: 'Anna-Nep', level: 'gevorderd', progress: { t1: { status: 'beheerst' } } })
    // Nogmaals synchroniseren zonder wijziging schrijft niets nieuws.
    const updatedAt = after.updatedAt
    await inTx(store, syncParticipants, store.list('trips.json.enc')[0]!)
    expect(store.list('students.json.enc').find((s) => s.id === anna.id)!.updatedAt).toBe(updatedAt)
  })

  it('een deelnemer in twee trips (uitgangspunt 4): de andere trip opslaan verhuist zijn student niet', async () => {
    const store = await device()
    const p = { id: 'p-twee', firstName: 'Neptwee', curriculumId: 'seed-asa-101', level: 'beginner' as const }
    const a: Trip = { id: 'a', name: 'Nep A', startDate: '2026-10-01', endDate: '2026-10-07', participants: [p], updatedAt: NOW, deletedAt: null }
    const b: Trip = { id: 'b', name: 'Nep B', startDate: '2026-10-10', endDate: '2026-10-14', participants: [p], updatedAt: NOW, deletedAt: null }
    await put(store, 'trips.json.enc', a)
    await inTx(store, syncParticipants, a)
    await put(store, 'trips.json.enc', b)
    await inTx(store, syncParticipants, b)
    expect(store.list('students.json.enc').find((x) => x.id === p.id)!.weekId).toBe('a')
    // Zonder trip (zijn trip is weg): dan hoort hij bij de trip die opgeslagen wordt.
    await put(store, 'trips.json.enc', { ...a, deletedAt: NOW, updatedAt: new Date().toISOString() })
    await inTx(store, syncParticipants, b)
    expect(store.list('students.json.enc').find((x) => x.id === p.id)!.weekId).toBe('b')
  })

  it('een student toegevoegd in Deze week komt bij de deelnemers', async () => {
    const store = await device()
    const trip = await inTx(store, startWeek, { ...input, participants: [] }, 'nl')
    // Zoals in Deze trip: student toevoegen zet hem ook bij de deelnemers (studentInTripToevoegen).
    const { result: student } = await studentInTripToevoegen(store, { firstName: 'Nepcees', curriculumId: 'seed-asa-101', level: 'beginner', startedAt: '2026-10-26' }, trip.id)
    const saved = store.list('trips.json.enc')[0]!
    expect(saved.participants).toEqual([{ id: student.id, firstName: 'Nepcees', level: 'beginner', curriculumId: 'seed-asa-101' }])
    expect(student.weekId).toBe(trip.id)
  })
})

// Studentenarchief (november 2026): een deelnemer van een trip waarin Olivier les geeft, is altijd een student, ook
// zonder gekozen cursus en ook na het afronden van de trip. Verzonnen namen.
describe('deelnemers van een lestrip zijn studenten, ook zonder cursus', () => {
  it('opslaan maakt de student zonder cursus; een gewiste student komt niet terug; een andere trip zonder cursus niet', async () => {
    const store = await device()
    const teaching: Trip = { ...week, closedAt: '2026-11-02', participants: [{ id: 'p-a', firstName: 'Nepanna' }, { id: 'p-b', firstName: 'Nepbart', curriculumId: 'seed-asa-101' }] }
    const charter: Trip = { id: 'c1', name: 'Nepcharter', type: 'skipper-charter', startDate: '2026-11-03', endDate: '2026-11-09', participants: [{ id: 'g-1', firstName: 'Nepgast' }], updatedAt: NOW, deletedAt: null }
    await put(store, 'trips.json.enc', teaching)
    await put(store, 'trips.json.enc', charter)
    // Van vóór deze versie (of nog niet opnieuw opgeslagen): de archieflijst noemt ze, zonder iets op te slaan.
    expect(participantsWithoutStudent(store.list('trips.json.enc'), store.get('students.json.enc')).map((x) => x.participant.id)).toEqual(['p-a', 'p-b'])
    await inTx(store, syncParticipants, teaching)
    expect(store.list('students.json.enc').map((s) => [s.id, s.curriculumId, s.weekId])).toEqual([
      ['p-a', '', 'w1'],
      ['p-b', 'seed-asa-101', 'w1'],
    ])
    await inTx(store, syncParticipants, charter)
    expect(store.list('students.json.enc').map((s) => s.id)).not.toContain('g-1')
    expect(participantsWithoutStudent(store.list('trips.json.enc'), store.get('students.json.enc'))).toEqual([])
    // Gewist (regel 14): niet vanzelf terug, ook niet via de tik in het archief.
    await put(store, 'students.json.enc', { id: 'p-a', firstName: '', curriculumId: '', level: 'beginner', progress: {}, archivedAt: null, updatedAt: NOW, deletedAt: NOW })
    await inTx(store, syncParticipants, teaching)
    await studentVanDeelnemer(store, teaching, teaching.participants![0]!)
    expect(store.list('students.json.enc').map((s) => s.id)).toEqual(['p-b'])
  })

  it('een tik in het archief maakt de student van een deelnemer, met zijn trip; het archief zet hem bij die trip', async () => {
    const store = await device()
    const teaching: Trip = { ...week, participants: [{ id: 'p-c', firstName: 'Nepcor', level: 'gevorderd' }] }
    await put(store, 'trips.json.enc', teaching)
    const pending = participantsWithoutStudent(store.list('trips.json.enc'), store.get('students.json.enc'))
    const groups = studentGroups(store.list('students.json.enc'), store.list('trips.json.enc'), [], null, NO_FILTER, pending)
    expect(groups.map((g) => [g.trip?.id, g.pending.map((p) => p.firstName)])).toEqual([['w1', ['Nepcor']]])
    const undo = await studentVanDeelnemer(store, teaching, teaching.participants![0]!)
    expect(store.list('students.json.enc')).toEqual([expect.objectContaining({ id: 'p-c', firstName: 'Nepcor', curriculumId: '', level: 'gevorderd', weekId: 'w1', startedAt: '2026-10-26' })])
    await undo()
    expect(store.list('students.json.enc')).toEqual([])
  })

  it('zelf toevoegen zonder cursus aan een trip: de student en de deelnemer; een cursus kiezen kan later', async () => {
    const store = await device()
    await put(store, 'trips.json.enc', week)
    const { result } = await studentInTripToevoegen(store, { firstName: 'Nepdirk Achternaam', curriculumId: '', level: 'beginner', startedAt: '2026-10-26', note: 'Nepnotitie\nTweede regel' }, 'w1')
    expect(result).toMatchObject({ firstName: 'Nepdirk', curriculumId: '', weekId: 'w1', note: 'Nepnotitie\nTweede regel' })
    expect(store.list('trips.json.enc')[0]!.participants!.map((p) => p.firstName)).toEqual(['Nepdirk'])
    expect(violations(store).map((v) => v.rule)).not.toContain('student-zonder-cursus')
  })
})
