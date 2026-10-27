import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { addStudent } from '../src/model/students'
import type { Leg, Student, Trip, WeekPlan } from '../src/model/types'
import { addParticipant, planWeek, startWeek, studentWeek, syncParticipants, updateWeek, type WeekInput } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

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
    const trip = await startWeek(store, input, 'nl')
    const anna = trip.participants!.find((p) => p.firstName === 'Nepanna')!
    const student = store.list('students.json.enc').find((s) => s.id === anna.id)!
    expect(student).toMatchObject({ firstName: 'Nepanna', level: 'gemiddeld', curriculumId: 'seed-asa-101', weekId: trip.id, startedAt: '2026-10-26' })
    expect(store.list('students.json.enc')).toHaveLength(1)

    await store.put('students.json.enc', { ...student, progress: { t1: { status: 'beheerst', updatedAt: NOW } } })
    await updateWeek(store, store.list('trips.json.enc')[0]!, { ...input, participants: [{ id: anna.id, firstName: 'Anna-Nep', level: 'gevorderd', curriculumId: 'seed-asa-101' }] }, 'nl')
    const after = store.list('students.json.enc').find((s) => s.id === anna.id)!
    expect(after).toMatchObject({ firstName: 'Anna-Nep', level: 'gevorderd', progress: { t1: { status: 'beheerst' } } })
    // Nogmaals synchroniseren zonder wijziging schrijft niets nieuws.
    const updatedAt = after.updatedAt
    await syncParticipants(store, store.list('trips.json.enc')[0]!)
    expect(store.list('students.json.enc').find((s) => s.id === anna.id)!.updatedAt).toBe(updatedAt)
  })

  it('een student toegevoegd in Deze week komt bij de deelnemers', async () => {
    const store = await device()
    const trip = await startWeek(store, { ...input, participants: [] }, 'nl')
    const student = await addStudent(store, { firstName: 'Nepcees', curriculumId: 'seed-asa-101', level: 'beginner', startedAt: '2026-10-26' }, trip.id)
    await addParticipant(store, trip, student)
    const saved = store.list('trips.json.enc')[0]!
    expect(saved.participants).toEqual([{ id: student.id, firstName: 'Nepcees', level: 'beginner', curriculumId: 'seed-asa-101' }])
    expect(student.weekId).toBe(trip.id)
  })
})
