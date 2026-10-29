import { activeStudents } from './students'
import { studentWeek, weekView } from './weeks'
import { norm } from './guests'
import type { Leg, Student, Trip } from './types'

// Studentenarchief (Meer → Studentenarchief): álle studenten, per trip, de lopende trip bovenaan, daarna de nieuwste
// trips; studenten zonder trip apart onderaan. Zoeken op voornaam, filteren op cursus en op resultaat.

export type ResultFilter = 'alle' | 'geslaagd' | 'gezakt' | 'geen-examen'
export const RESULT_FILTERS: readonly ResultFilter[] = ['alle', 'geslaagd', 'gezakt', 'geen-examen']

export interface StudentFilter {
  query: string
  /** '' = alle cursussen */
  curriculumId: string
  result: ResultFilter
}

export const NO_FILTER: StudentFilter = { query: '', curriculumId: '', result: 'alle' }

export interface StudentGroup {
  /** null = zonder trip */
  trip: Trip | null
  /** De lopende trip. */
  current: boolean
  startDate: string
  students: Student[]
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
export function studentGroups(students: readonly Student[], trips: readonly Trip[], legs: readonly Leg[], currentTripId: string | null, filter: StudentFilter = NO_FILTER): StudentGroup[] {
  const byTrip = new Map<string | null, Student[]>()
  for (const s of activeStudents(students)) {
    if (!matches(s, filter)) continue
    const id = studentWeek(s, trips, legs)
    const list = byTrip.get(id) ?? []
    list.push(s)
    byTrip.set(id, list)
  }
  const groups: StudentGroup[] = []
  for (const [id, list] of byTrip) {
    const trip = id ? (trips.find((x) => x.id === id) ?? null) : null
    groups.push({
      trip,
      current: !!id && id === currentTripId,
      startDate: trip ? weekView(trip, legs).startDate : '',
      students: [...list].sort((a, b) => a.firstName.localeCompare(b.firstName)),
    })
  }
  return groups.sort((a, b) => {
    if (!a.trip !== !b.trip) return a.trip ? -1 : 1
    if (a.current !== b.current) return a.current ? -1 : 1
    return b.startDate.localeCompare(a.startDate)
  })
}
