import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  activeLabels,
  blocksForWeek,
  CERT_COURSES,
  coursesOf,
  doneFor,
  elementsFor,
  LESSON_BLOCKS,
  lessonBlock,
  openPerCourse,
  studentsFor,
  toggledBlock,
  toggledStudent,
  type LessonCourse,
  type LessonStudent,
} from '../src/model/lesweek'
import type { Trip } from '../src/model/types'
import { cleanParticipants } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'
import { lesblokAfvinken, lesblokStudentWisselen, lescursussenZetten } from '../src/domain/training'

// Lesweek: afvinken per blok. Alle namen zijn verzonnen.

const NOW = '2026-11-21T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
async function device() {
  return Store.open(await openLogboekDb(`logboek-lesweek-${++counter}`), masterKey, new GithubClient('github_pat_LESWEEK_0123456789abcdefghijklmnopqrstuvwx', new FakeGithub().fetch))
}
const student = (id: string, courses: LessonCourse[]): LessonStudent => ({ id, name: id, courses })
const s0 = student

// Hoofdstuk 8 van het idee: welke blokken bij welk certificaat horen. Afwijkend (november 2026, Olivier): T2 en P1
// (manoeuvreren op de motor) horen bij elk certificaat: maandagochtend begint altijd met manoeuvreren, ook voor beginners.
const TABLE: Record<string, string[]> = {
  '101': ['T1', 'T2', 'T3', 'T4', 'T5', 'K2', 'K3', 'P1', 'P2', 'P3', 'P4', 'P8', 'P9', 'D2'],
  '103': ['T1', 'T2', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T11', 'T12', 'K2', 'K3', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'D1', 'D2'],
  '104': ['T1', 'T2', 'T4', 'T5', 'T6', 'T7', 'T8', 'T11', 'T12', 'K1', 'K3', 'P1', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'D1', 'D2', 'D3'],
  '114': ['T1', 'T2', 'T3', 'T5', 'T6', 'T10', 'T11', 'T12', 'K3', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P8', 'P9', 'D1'],
}

describe('lesweek: blokken', () => {
  it('elk certificaat heeft precies de blokken uit de tabel, plus zijn examen', () => {
    for (const [course, ids] of Object.entries(TABLE)) {
      const got = LESSON_BLOCKS.filter((x) => x.courses.includes(course as LessonCourse)).map((x) => x.id)
      expect(got.sort()).toEqual([...ids, `examen-${course}`].sort())
    }
    // 106 volgt 104 met de nachttocht erbij; de extra uitdaging alleen de nachttocht.
    const c106 = LESSON_BLOCKS.filter((x) => x.courses.includes('106')).map((x) => x.id)
    expect(c106.sort()).toEqual([...TABLE['104']!, 'P10', 'examen-106'].sort())
    expect(LESSON_BLOCKS.filter((x) => x.courses.includes('plus')).map((x) => x.id)).toEqual(['P10'])
  })

  it('vaste id’s, beide talen, theorie en kort voor de groep, de rest per student', () => {
    expect(new Set(LESSON_BLOCKS.map((x) => x.id)).size).toBe(LESSON_BLOCKS.length)
    for (const x of LESSON_BLOCKS) {
      expect(x.title.nl && x.title.en).toBeTruthy()
      for (const e of x.elements) expect(e.text.nl && e.text.en).toBeTruthy()
      expect(x.kind).toBe(x.section === 'theorie' || x.section === 'kort' ? 'groep' : 'student')
    }
    expect(CERT_COURSES.every((c) => lessonBlock(`examen-${c}`))).toBe(true)
  })

  it('alleen de blokken van de cursussen in de week; studentblok alleen voor wie het geldt', () => {
    const week = [student('Nepa', ['101', '103']), student('Nepb', ['104', '114'])]
    const ids = blocksForWeek(week, {}).map((x) => x.id)
    expect(ids).toContain('T10')
    expect(ids).not.toContain('P10')
    expect(studentsFor(lessonBlock('P7')!, [s0('Nepa', ['101']), s0('Nepb', ['104'])]).map((s) => s.id)).toEqual(['Nepb'])
    expect(studentsFor(lessonBlock('P1')!, week).map((s) => s.id)).toEqual(['Nepa', 'Nepb'])
    expect(studentsFor(lessonBlock('P4')!, week).map((s) => s.id)).toEqual(['Nepa', 'Nepb'])
    expect(blocksForWeek([student('Nepc', ['101', '103'])], {}).map((x) => x.id)).not.toContain('D3')
  })

  it('monohull: 114 valt weg, schroefeffect erbij; labels volgen de cursussen', () => {
    const p = { courses: ['104', '114'] as LessonCourse[] }
    expect(coursesOf(p, { boatKind: 'eenromp' })).toEqual(['104'])
    expect(coursesOf(p, { boatKind: 'catamaran' })).toEqual(['104', '114'])
    expect(coursesOf(p, {})).toEqual(['104', '114'])
    const mono = activeLabels([student('Nepa', ['104'])], { boatKind: 'eenromp' })
    expect([...mono].sort()).toEqual(['104', 'mono'])
    const t2 = elementsFor(lessonBlock('T2')!, mono).map((e) => e.text.nl)
    expect(t2).toContain('Schroefeffect')
    expect(t2.some((x) => x.startsWith('Plaats van de motoren'))).toBe(false)
    expect(activeLabels([student('Nepa', ['101', '103'])], {}).size).toBe(0)
    expect(activeLabels([student('Nepa', ['104', 'plus'])], {}).has('star')).toBe(true)
  })
})

describe('lesweek: afvinken', () => {
  it('één tik = iedereen; een naam = nog niet; nog een tik = toch goed', () => {
    let checks = toggledBlock(undefined, 'P3', '2026-11-22')
    const trip = (): Pick<Trip, 'lessonChecks'> => ({ lessonChecks: checks })
    expect(doneFor(trip(), 'P3', 'a')).toBe(true)
    checks = toggledStudent(checks, 'P3', 'a', '2026-11-22')
    expect(doneFor(trip(), 'P3', 'a')).toBe(false)
    expect(doneFor(trip(), 'P3', 'b')).toBe(true)
    checks = toggledStudent(checks, 'P3', 'a', '2026-11-23')
    expect(checks.P3).toEqual({ at: '2026-11-22' })
    // Een naam aantikken bij een blok dat nog niet aan staat: gedaan voor de rest, deze nog niet.
    checks = toggledStudent(checks, 'P4', 'b', '2026-11-23')
    expect(checks.P4).toEqual({ at: '2026-11-23', open: ['b'] })
    // Uitvinken haalt ook "nog niet" weg.
    checks = toggledBlock(checks, 'P4', '2026-11-23')
    expect(checks.P4).toBeUndefined()
  })

  it('per cursus wat nog openstaat, met de namen van wie het nog niet kan', () => {
    const week = [student('Nepa', ['101', '103']), student('Nepb', ['101', '103'])]
    let checks = undefined as Trip['lessonChecks']
    for (const id of TABLE['101']!) checks = toggledBlock(checks, id, '2026-11-24')
    checks = toggledStudent(checks, 'P8', 'Nepb', '2026-11-24')
    const overview = openPerCourse({ lessonChecks: checks }, week)
    const c101 = overview.find((o) => o.course === '101')!
    expect(c101.total).toBe(15)
    expect(c101.open.map((o) => [o.block.id, o.names])).toEqual([
      ['P8', ['Nepb']],
      ['examen-101', []],
    ])
    expect(overview.map((o) => o.course)).toEqual(['101', '103'])
  })

  it('opdrachten op de trip, met ongedaan maken; cursussen blijven bij Trip bewerken', async () => {
    const store = await device()
    const t: Trip = { id: 't1', name: 'Nep lesweek', type: 'training-geven', boatKind: 'catamaran', participants: [{ id: 'p1', firstName: 'Nepa', role: 'student' }, { id: 'p2', firstName: 'Nepb', role: 'student' }], updatedAt: NOW, deletedAt: null }
    await put(store, 'trips.json.enc', t)
    await lescursussenZetten(store, 't1', 'p1', ['103', '101', '101'])
    await lescursussenZetten(store, 't1', 'p2', ['104', '114'])
    const trip = () => store.get('trips.json.enc').find((x) => x.id === 't1')!
    expect(trip().participants?.map((p) => p.courses)).toEqual([['101', '103'], ['104', '114']])
    const undo = await lesblokAfvinken(store, 't1', 'P4')
    await lesblokStudentWisselen(store, 't1', 'P4', 'p2')
    expect(trip().lessonChecks?.P4?.open).toEqual(['p2'])
    await lesblokAfvinken(store, 't1', 'T1')
    expect(Object.keys(trip().lessonChecks ?? {}).sort()).toEqual(['P4', 'T1'])
    await undo()
    expect(trip().lessonChecks?.P4).toEqual({ at: expect.any(String), open: ['p2'] })
    // Groepsblok heeft geen "nog niet"; onbekend blok of onbekende student: niets geschreven.
    await expect(lesblokStudentWisselen(store, 't1', 'T1', 'p1')).rejects.toThrow()
    await expect(lesblokStudentWisselen(store, 't1', 'P4', 'onbekend')).rejects.toThrow()
    await expect(lesblokAfvinken(store, 't1', 'X99')).rejects.toThrow()
    // Leeg = nog niet gekozen.
    await lescursussenZetten(store, 't1', 'p1', [])
    expect(trip().participants?.[0]).not.toHaveProperty('courses')
    // Trip bewerken bouwt de deelnemers opnieuw op: de cursussen blijven.
    expect(cleanParticipants(trip().participants ?? []).map((p) => p.courses)).toEqual([undefined, ['104', '114']])
  })
})
