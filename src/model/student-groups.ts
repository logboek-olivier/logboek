import { activeStudents } from './students'
import { participantRole, studentWeek, wantsStudent, weekView } from './weeks'
import { norm } from './guests'
import { active } from './derive'
import type { Leg, Participant, PersonRole, Student, Trip } from './types'

// Personen (Meer → Personen, eerder Studentenarchief): álle studenten en de andere mensen van een trip (gast, crew,
// medezeiler, schipper, overig), per trip, de lopende trip bovenaan, daarna de nieuwste trips; studenten zonder trip
// apart onderaan. Zoeken op voornaam, filteren op rol, cursus en resultaat (cursus en resultaat alleen bij studenten).

export type ResultFilter = 'alle' | 'geslaagd' | 'gezakt' | 'geen-examen'
export const RESULT_FILTERS: readonly ResultFilter[] = ['alle', 'geslaagd', 'gezakt', 'geen-examen']

export interface StudentFilter {
  query: string
  /** 'alle' = iedereen. */
  role: PersonRole | 'alle'
  /** '' = alle cursussen */
  curriculumId: string
  result: ResultFilter
}

export const NO_FILTER: StudentFilter = { query: '', role: 'alle', curriculumId: '', result: 'alle' }

export interface StudentGroup {
  /** null = zonder trip */
  trip: Trip | null
  /** De lopende trip. */
  current: boolean
  startDate: string
  students: Student[]
  /** Deelnemers die nog geen student hebben (een tik maakt de student). */
  pending: Participant[]
  /** De andere mensen van de trip (geen student), met hun rol. */
  people: { participant: Participant; role: PersonRole }[]
}

export function matchesResult(s: Student, result: ResultFilter): boolean {
  if (result === 'alle') return true
  if (result === 'geen-examen') return !s.exam
  return !!s.exam && s.exam.passed === (result === 'geslaagd')
}

/** Zoeken zonder hoofdletters en accenten, op een deel van de voornaam ("nic" vindt Nick en Nicole). */
export function matches(s: Student, filter: StudentFilter): boolean {
  const q = norm(filter.query)
  if (q && !norm(s.firstName).includes(q)) return false
  if (filter.curriculumId && s.curriculumId !== filter.curriculumId) return false
  return matchesResult(s, filter.result)
}

/** Niet-gearchiveerde studenten per trip, lopende trip eerst, daarna nieuwste eerst; zonder trip als laatste groep. */
export function studentGroups(
  students: readonly Student[],
  trips: readonly Trip[],
  legs: readonly Leg[],
  currentTripId: string | null,
  filter: StudentFilter = NO_FILTER,
  pending: readonly { trip: Trip; participant: Participant }[] = [],
): StudentGroup[] {
  const byTrip = new Map<string | null, { students: Student[]; pending: Participant[]; people: { participant: Participant; role: PersonRole }[] }>()
  const at = (id: string | null) => byTrip.get(id) ?? byTrip.set(id, { students: [], pending: [], people: [] }).get(id)!
  const studentsWanted = filter.role === 'alle' || filter.role === 'student'
  // Cursus en resultaat gelden alleen voor studenten: met zo'n filter staan de andere mensen er niet.
  const othersWanted = filter.role !== 'student' && filter.curriculumId === '' && filter.result === 'alle'
  for (const s of activeStudents(students)) {
    if (!studentsWanted || !matches(s, filter)) continue
    at(studentWeek(s, trips, legs)).students.push(s)
  }
  // Een deelnemer zonder student: zoeken op voornaam en filteren op cursus; nog geen examen.
  const q = norm(filter.query)
  for (const { trip, participant: p } of pending) {
    if (!studentsWanted) continue
    if (q && !norm(p.firstName).includes(q)) continue
    if (filter.curriculumId && p.curriculumId !== filter.curriculumId) continue
    if (filter.result === 'geslaagd' || filter.result === 'gezakt') continue
    at(trip.id).pending.push(p)
  }
  // De andere mensen: elke deelnemer zonder student die er ook geen hoort te zijn (een gewiste student telt als student).
  if (othersWanted) {
    const known = new Set(students.map((s) => s.id))
    for (const trip of active(trips)) {
      for (const p of trip.participants ?? []) {
        if (known.has(p.id) || wantsStudent(p, trip)) continue
        const role = participantRole(p, trip, false)
        if (filter.role !== 'alle' && role !== filter.role) continue
        if (q && !norm(p.firstName).includes(q)) continue
        at(trip.id).people.push({ participant: p, role })
      }
    }
  }
  const groups: StudentGroup[] = []
  for (const [id, list] of byTrip) {
    const trip = id ? (trips.find((x) => x.id === id) ?? null) : null
    groups.push({
      trip,
      current: !!id && id === currentTripId,
      startDate: trip ? weekView(trip, legs).startDate : '',
      students: [...list.students].sort((a, b) => a.firstName.localeCompare(b.firstName)),
      pending: [...list.pending].sort((a, b) => a.firstName.localeCompare(b.firstName)),
      people: [...list.people].sort((a, b) => a.participant.firstName.localeCompare(b.participant.firstName)),
    })
  }
  return groups.sort((a, b) => {
    if (!a.trip !== !b.trip) return a.trip ? -1 : 1
    if (a.current !== b.current) return a.current ? -1 : 1
    return b.startDate.localeCompare(a.startDate)
  })
}
