import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { allTopics } from '../src/model/curricula'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import {
  activeStudents,
  addStudent,
  archivedStudents,
  cleanInput,
  criticalOpen,
  deleteStudents,
  dueForArchive,
  lastActivity,
  nextStatus,
  progressFor,
  raiseStatus,
  saveStudents,
  scrubbed,
  setArchived,
  statusOf,
  weekOf,
  withStatus,
  type StudentInput,
} from '../src/model/students'
import type { Student } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

const TOKEN = 'github_pat_STUDENTS_0123456789abcdefghijklmnopqrstuvwxyz'
const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
afterEach(() => vi.restoreAllMocks())

async function device(github = new FakeGithub()) {
  const db = await openLogboekDb(`logboek-students-${++counter}`)
  return { github, store: await Store.open(db, masterKey, new GithubClient(TOKEN, github.fetch)) }
}

const asa101 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-101')!
const topics = allTopics(asa101)

function student(patch: Partial<Student> = {}): Student {
  return {
    id: 'st-1',
    firstName: 'Testa',
    curriculumId: asa101.id,
    level: 'beginner',
    startedAt: '2026-10-19',
    progress: {},
    archivedAt: null,
    updatedAt: NOW,
    deletedAt: null,
    ...patch,
  }
}

const input: StudentInput = { firstName: 'Fictiva', curriculumId: asa101.id, level: 'gemiddeld', startedAt: '2026-10-21' }

describe('voortgang', () => {
  it('één tik = volgende status, en na beheerst terug naar nieuw', () => {
    expect(nextStatus('nieuw')).toBe('geoefend')
    expect(nextStatus('geoefend')).toBe('beheerst')
    expect(nextStatus('beheerst')).toBe('nieuw')
    const s = withStatus(student(), topics[0]!.id, 'geoefend', NOW)
    expect(statusOf(s, topics[0]!.id)).toBe('geoefend')
    expect(statusOf(s, topics[1]!.id)).toBe('nieuw')
  })

  it('groepsafvinken verhoogt, maar verlaagt nooit', () => {
    const id = topics[0]!.id
    const mastered = withStatus(student(), id, 'beheerst', NOW)
    expect(raiseStatus(mastered, id, 'geoefend', NOW)).toBe(mastered)
    expect(statusOf(raiseStatus(student(), id, 'geoefend', NOW), id)).toBe('geoefend')
  })

  it('telt beheerst en geoefend; examenkritische onderwerpen op nieuw staan apart', () => {
    let s = student()
    s = withStatus(s, topics[0]!.id, 'beheerst', NOW)
    s = withStatus(s, topics[1]!.id, 'geoefend', NOW)
    const p = progressFor(s, topics)
    expect(p).toMatchObject({ total: topics.length, mastered: 1, practised: 1 })
    expect(p.share).toBeCloseTo(1.5 / topics.length)
    const critical = topics.filter((tp) => tp.examCritical)
    expect(criticalOpen(student(), asa101)).toHaveLength(critical.length)
    const done = withStatus(student(), critical[0]!.id, 'geoefend', NOW)
    expect(criticalOpen(done, asa101)).toHaveLength(critical.length - 1)
  })

  it('groepeert per week (maandag van de begindatum)', () => {
    expect(weekOf(student({ startedAt: '2026-10-25' }))).toBe('2026-10-19')
    expect(weekOf(student({ startedAt: '2026-10-26' }))).toBe('2026-10-26')
  })
})

describe('regel 14: alleen toegestane gegevens', () => {
  it('neemt alleen voornaam, cursus, niveau, begin, opmerking en examen over, ingekort', () => {
    const extra = { ...input, firstName: `  ${'x'.repeat(80)}  `, phone: '0600000000', email: 'a@b.c' } as StudentInput
    const out = cleanInput(extra)
    expect(Object.keys(out).sort()).toEqual(['curriculumId', 'firstName', 'level', 'startedAt'])
    expect(out.firstName).toHaveLength(40)
    const withExam = cleanInput({ ...input, note: ' ', exam: { date: '2026-10-30', passed: true, note: ' goed ' } })
    expect(withExam.note).toBeUndefined()
    expect(withExam.exam).toEqual({ date: '2026-10-30', passed: true, note: 'goed' })
  })

  it('wissen laat een tombstone zonder persoonsgegevens achter', () => {
    const s = withStatus(student({ note: 'opmerking', exam: { date: '2026-10-30', passed: false } }), topics[0]!.id, 'beheerst', NOW)
    const tomb = scrubbed(s, NOW)
    expect(tomb).toEqual({ id: 'st-1', firstName: '', curriculumId: '', level: 'beginner', progress: {}, archivedAt: null, updatedAt: NOW, deletedAt: NOW })
  })
})

describe('archiveren', () => {
  it('na 12 maanden zonder activiteit te archiveren; recente voortgang houdt de student actief', () => {
    const old = student({ id: 'oud', startedAt: '2025-09-01', updatedAt: '2025-09-01T00:00:00.000Z' })
    const recent = withStatus(student({ id: 'recent', startedAt: '2025-09-01', updatedAt: '2026-01-10T00:00:00.000Z' }), topics[0]!.id, 'geoefend', '2026-01-10T00:00:00.000Z')
    expect(lastActivity(recent)).toBe('2026-01-10')
    expect(dueForArchive([old, recent], '2026-10-26').map((s) => s.id)).toEqual(['oud'])
    expect(dueForArchive([old], '2026-08-31')).toEqual([])
    expect(dueForArchive([student({ id: 'gearch', startedAt: '2020-01-01', archivedAt: '2021-01-01' })], '2026-10-26')).toEqual([])
  })

  it('terugzetten uit het archief telt als activiteit: de student wordt niet direct opnieuw gearchiveerd', () => {
    const restored = student({ startedAt: '2024-01-01', archivedAt: null, updatedAt: '2026-10-26T09:00:00.000Z' })
    expect(dueForArchive([restored], '2026-10-26')).toEqual([])
  })
})

describe('opslag', () => {
  it('versleuteld naar GitHub; geen namen in verkeer of logs; archief en wissen met ongedaan maken', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')]
    const { github, store } = await device()
    expect(store.hasSynced()).toBe(false)
    const s = await addStudent(store, { ...input, note: 'Notitievlak' })
    await saveStudents(store, [withStatus(s, topics[0]!.id, 'beheerst', NOW)])
    await store.sync()
    expect(github.files.has('students.json.enc')).toBe(true)
    expect(store.hasSynced()).toBe(true)
    const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
    expect(wire).not.toContain('Fictiva')
    expect(wire).not.toContain('Notitievlak')

    await setArchived(store, store.get('students.json.enc'), '2026-10-26')
    expect(activeStudents(store.get('students.json.enc'))).toEqual([])
    expect(archivedStudents(store.get('students.json.enc'))).toHaveLength(1)

    const undo = await deleteStudents(store, archivedStudents(store.get('students.json.enc')))
    const tomb = store.get('students.json.enc')[0]!
    expect(tomb.firstName).toBe('')
    expect(tomb.deletedAt).not.toBeNull()
    await undo()
    expect(store.get('students.json.enc')[0]!.firstName).toBe('Fictiva')

    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('Fictiva')
  })

  it('een tweede apparaat ziet de voortgang; een logboek van de vorige versie (zonder studenten) opent gewoon', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    expect(a.store.get('students.json.enc')).toEqual([])
    const s = await addStudent(a.store, input)
    await saveStudents(a.store, [withStatus(s, topics[2]!.id, 'geoefend', NOW)])
    await a.store.sync()
    const b = await device(github)
    await b.store.sync()
    expect(statusOf(b.store.get('students.json.enc')[0]!, topics[2]!.id)).toBe('geoefend')
  })
})
