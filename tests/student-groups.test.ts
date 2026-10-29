import { describe, expect, it } from 'vitest'
import { NO_FILTER, studentGroups } from '../src/model/student-groups'
import type { Student, Trip } from '../src/model/types'

// PR D: het studentenarchief toont álle studenten per trip, de lopende trip bovenaan (die ontbrak), zonder trip apart;
// zoeken op naam en filteren op cursus en resultaat. Verzonnen voornamen.

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, startDate: string, endDate: string): Trip => ({ id, name: `Nep ${id}`, startDate, endDate, updatedAt: T0, deletedAt: null })
const student = (id: string, firstName: string, extra: Partial<Student> = {}): Student => ({
  id,
  firstName,
  curriculumId: 'seed-asa-101',
  level: 'beginner',
  progress: {},
  updatedAt: T0,
  deletedAt: null,
  ...extra,
})

const trips = [trip('old', '2026-06-01', '2026-06-07'), trip('now', '2026-11-01', '2026-11-14'), trip('later', '2026-12-01', '2026-12-07')]
const students = [
  student('a', 'Nepanna', { weekId: 'now' }),
  student('b', 'Nepbram', { weekId: 'old', exam: { date: '2026-06-07', passed: true } }),
  student('c', 'Nepcees', { weekId: 'old', curriculumId: 'seed-asa-103', exam: { date: '2026-06-07', passed: false } }),
  student('d', 'Nepdirk'),
  student('e', 'Nepedith', { weekId: 'later' }),
  student('f', 'Nepfrits', { weekId: 'now', archivedAt: '2026-11-02' }),
  student('g', 'Nepgijs', { weekId: 'now', deletedAt: T0 }),
]

describe('studenten per trip', () => {
  it('alle studenten, lopende trip bovenaan, dan nieuwste, zonder trip als laatste; gearchiveerd en gewist niet', () => {
    const groups = studentGroups(students, trips, [], 'now')
    expect(groups.map((g) => g.trip?.id ?? null)).toEqual(['now', 'later', 'old', null])
    expect(groups[0]!.current).toBe(true)
    expect(groups[0]!.students.map((s) => s.firstName)).toEqual(['Nepanna'])
    expect(groups[2]!.students.map((s) => s.firstName)).toEqual(['Nepbram', 'Nepcees'])
    expect(groups[3]!.students.map((s) => s.firstName)).toEqual(['Nepdirk'])
  })

  it('zoeken op een deel van de naam (zonder hoofdletters of accenten), filteren op cursus en resultaat', () => {
    const names = (f: Partial<typeof NO_FILTER>) => studentGroups(students, trips, [], 'now', { ...NO_FILTER, ...f }).flatMap((g) => g.students.map((s) => s.firstName))
    expect(names({ query: 'BRA' })).toEqual(['Nepbram'])
    expect(names({ query: 'népc' })).toEqual(['Nepcees'])
    expect(names({ curriculumId: 'seed-asa-103' })).toEqual(['Nepcees'])
    expect(names({ result: 'geslaagd' })).toEqual(['Nepbram'])
    expect(names({ result: 'gezakt' })).toEqual(['Nepcees'])
    expect(names({ result: 'geen-examen' })).toEqual(['Nepanna', 'Nepedith', 'Nepdirk'])
    // Een trip zonder treffers verdwijnt uit de lijst.
    expect(studentGroups(students, trips, [], 'now', { ...NO_FILTER, query: 'bram' }).map((g) => g.trip?.id)).toEqual(['old'])
  })
})
