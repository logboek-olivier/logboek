import type { Tx } from '../domain/tx'
import { addDays } from '../basis/datum'
import { blocksForWeek, lessonBlock, type LessonStudent } from './lesweek'
import type { LessonPlan, LessonPlanDay, LessonSlot, Trip } from './types'

// Weekplanner van de lesweek (idee van Olivier, november 2026): per dag een ochtend- en een middagblok en "eind van de
// dag" (examens, rond 17–18 uur), globaal, geen minuten. Het voorstel volgt vaste regels (zondag het rondje over de
// boot, maandagochtend manoeuvreren op de motor, woensdag de motorcheck, examens 101 woensdag en 103/104/114 donderdag,
// man over boord vrijdagochtend) en past zich aan aan wind en steiger per dag. Daarna bewerkt Olivier het zelf; een
// nieuw voorstel komt alleen na een tik, en vervangt alleen vandaag en later (wat al gedaan is, wordt niet opnieuw
// ingepland). Het plan staat op de trip (`Trip.lessonPlan`); afvinken blijft `Trip.lessonChecks`.

export const SLOTS: readonly LessonSlot[] = ['ochtend', 'middag', 'avond']
export const MAX_PLAN_DAYS = 14

type DayTemplate = Record<LessonSlot, string[]>

/**
 * De standaardweek per weekdag (0 = zondag). Zondag (aan boord rond 14:00, uitvaren 15–16 uur): onderdelen van de boot
 * en knopen, meer niet. Maandag: manoeuvreren op de motor, zeil hijsen en mooring ball oppikken (november 2026, Olivier).
 */
const TEMPLATE: Record<number, DayTemplate> = {
  0: { ochtend: [], middag: ['T1', 'D2'], avond: [] },
  1: { ochtend: ['T2', 'P1'], middag: ['P2', 'P3'], avond: [] },
  2: { ochtend: ['T3', 'T4'], middag: ['T5', 'P4'], avond: [] },
  3: { ochtend: ['T6', 'T7', 'T12', 'P6'], middag: ['T8', 'P7'], avond: ['examen-101', 'P10'] },
  4: { ochtend: ['T9', 'P8'], middag: ['T10', 'T11', 'P5'], avond: ['examen-104', 'examen-114', 'examen-103'] },
  5: { ochtend: ['P9'], middag: [], avond: ['examen-106'] },
  6: { ochtend: [], middag: [], avond: [] },
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

function emptyDay(date: string, prev?: LessonPlanDay): LessonPlanDay {
  return { date, ...(prev?.wind ? { wind: prev.wind } : {}), ...(prev?.dock ? { dock: true } : {}), ochtend: [], middag: [], avond: [] }
}

/** De datums van de trip (hoogstens 14). */
export function planDates(trip: Pick<Trip, 'startDate' | 'endDate'>): string[] {
  if (!trip.startDate) return []
  const end = trip.endDate && trip.endDate >= trip.startDate ? trip.endDate : addDays(trip.startDate, 6)
  const dates: string[] = []
  for (let d = trip.startDate; d <= end && dates.length < MAX_PLAN_DAYS; d = addDays(d, 1)) dates.push(d)
  return dates
}

function remove(days: LessonPlanDay[], id: string): void {
  for (const d of days) for (const s of SLOTS) d[s] = d[s].filter((x) => x !== id)
}

function place(day: LessonPlanDay | undefined, slot: LessonSlot, ids: string[]): void {
  if (!day) return
  for (const id of ids) if (!day[slot].includes(id)) day[slot].push(id)
}

/** Lesdagen voor wind en steiger: maandag t/m donderdag (en vrijdag voor de steiger), in de volgorde van de trip. */
function teachDays(days: LessonPlanDay[], weekdays: readonly number[]): LessonPlanDay[] {
  return days.filter((d) => weekdays.includes(weekday(d.date)))
}

/**
 * Het voorstel voor de hele week, uit de standaardweek, de cursussen van de studenten en wind en steiger per dag.
 * `inputs` = de dagen zoals ze nu zijn (wind en steiger worden overgenomen). Alleen blokken die in deze week voorkomen.
 */
export function draftLessonPlan(trip: Pick<Trip, 'startDate' | 'endDate' | 'boatKind'>, students: readonly LessonStudent[], inputs: readonly LessonPlanDay[] = []): LessonPlanDay[] {
  const relevant = new Set(blocksForWeek(students, trip).map((b) => b.id))
  const days = planDates(trip).map((date) => {
    const day = emptyDay(date, inputs.find((x) => x.date === date))
    const tpl = TEMPLATE[weekday(date)]!
    for (const s of SLOTS) place(day, s, tpl[s])
    return day
  })
  // Veel wind: reven en bijliggen naar de eerste dag met veel wind (maandag t/m donderdag).
  const windy = teachDays(days, [1, 2, 3, 4]).find((d) => d.wind === 'veel')
  if (windy) {
    remove(days, 'T11')
    remove(days, 'P5')
    place(windy, 'middag', ['T11', 'P5'])
  }
  // Windstil: extra manoeuvreren op de motor; bij meer windstille dagen man over boord naar voren.
  const calm = teachDays(days, [1, 2, 3, 4]).filter((d) => d.wind === 'weinig')
  for (const d of calm) if (weekday(d.date) !== 1) place(d, 'middag', ['P1'])
  if (calm.length >= 2) {
    remove(days, 'P9')
    place(calm.find((d) => weekday(d.date) >= 2) ?? calm[0], 'ochtend', ['P9'])
  }
  // Steiger: het eerste dagdeel met een steiger (standaard donderdag).
  const dock = teachDays(days, [1, 2, 3, 4, 5]).find((d) => d.dock)
  if (dock) {
    remove(days, 'P8')
    place(dock, 'ochtend', ['P8'])
  }
  for (const d of days) for (const s of SLOTS) d[s] = d[s].filter((id) => relevant.has(id))
  return days
}

/** Blokken van de week die nergens in het plan staan (doorlopend en kort uitleggen tellen niet: die zijn de hele week). */
export function unplanned(plan: readonly LessonPlanDay[], students: readonly LessonStudent[], trip: Pick<Trip, 'boatKind'>): string[] {
  const planned = new Set(plan.flatMap((d) => SLOTS.flatMap((s) => d[s])))
  return blocksForWeek(students, trip)
    .filter((b) => b.section !== 'kort' && b.section !== 'doorlopend' && !planned.has(b.id))
    .map((b) => b.id)
}

/**
 * Theorie vóór het examen: per examen in het plan de groepsblokken van die cursus die pas na het examen of helemaal niet
 * gepland staan (en nog niet gedaan zijn).
 */
export function examGaps(plan: readonly LessonPlanDay[], checks: Trip['lessonChecks'], students: readonly LessonStudent[], trip: Pick<Trip, 'boatKind'>): { course: string; blocks: string[] }[] {
  const order: string[] = plan.flatMap((d) => SLOTS.flatMap((s) => d[s]))
  const relevant = new Set(blocksForWeek(students, trip).map((b) => b.id))
  const out: { course: string; blocks: string[] }[] = []
  for (const examId of order.filter((id) => id.startsWith('examen-'))) {
    const course = examId.slice('examen-'.length)
    const at = order.indexOf(examId)
    const theory = [...relevant].map((id) => lessonBlock(id)!).filter((b) => b.section === 'theorie' && b.courses.some((c) => c === course))
    const late = theory.filter((b) => !checks?.[b.id] && !order.slice(0, at).includes(b.id)).map((b) => b.id)
    if (late.length > 0) out.push({ course, blocks: late })
  }
  return out
}

/**
 * Nieuw voorstel voor vandaag en later: eerdere dagen blijven zoals ze zijn, wat al gedaan is of al eerder gepland stond,
 * wordt niet opnieuw ingepland (een gedaan blok blijft op zijn dag staan).
 */
export function redraftFrom(current: readonly LessonPlanDay[], trip: Pick<Trip, 'startDate' | 'endDate' | 'boatKind' | 'lessonChecks'>, students: readonly LessonStudent[], today: string): LessonPlanDay[] {
  const draft = draftLessonPlan(trip, students, current)
  const past = current.filter((d) => d.date < today)
  const keep = new Set([...past.flatMap((d) => SLOTS.flatMap((s) => d[s])), ...Object.keys(trip.lessonChecks ?? {}).filter((id) => !id.startsWith('examen-'))])
  return draft.map((d) => {
    const old = past.find((x) => x.date === d.date)
    if (old) return old
    // Wat op deze dag al gedaan is, blijft op zijn plek staan; de rest komt uit het voorstel.
    const was = current.find((x) => x.date === d.date)
    const next = { ...d }
    for (const s of SLOTS) next[s] = [...new Set([...(was?.[s] ?? []).filter((id) => trip.lessonChecks?.[id]), ...d[s].filter((id) => !keep.has(id))])]
    return next
  })
}

/** Vandaag in het plan, of null. */
export function planDay(plan: LessonPlan | undefined, date: string): LessonPlanDay | null {
  return plan?.days.find((d) => d.date === date) ?? null
}

// ---------------------------------------------------------------------------------------------------------------------
// Opdrachten (via src/domain/training.ts)

function liveTrip(store: Tx, tripId: string): Trip {
  const trip = store.get('trips.json.enc').find((x) => x.id === tripId && x.deletedAt === null)
  if (!trip) throw new Error('Trip bestaat niet')
  return trip
}

function validDays(days: readonly LessonPlanDay[]): LessonPlanDay[] {
  return days.slice(0, MAX_PLAN_DAYS).map((d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('Ongeldige datum')
    const clean = (ids: readonly string[]) => [...new Set(ids.filter((id) => lessonBlock(id)))]
    return { date: d.date, ...(d.wind === 'weinig' || d.wind === 'veel' ? { wind: d.wind } : {}), ...(d.dock ? { dock: true } : {}), ochtend: clean(d.ochtend), middag: clean(d.middag), avond: clean(d.avond) }
  })
}

/** Het hele plan opslaan (voorstel, nieuw voorstel of een bewerking). */
export async function saveLessonPlan(store: Tx, tripId: string, days: readonly LessonPlanDay[]): Promise<void> {
  const trip = liveTrip(store, tripId)
  await store.put('trips.json.enc', { ...trip, lessonPlan: { ...(trip.lessonPlan ?? {}), days: validDays(days) }, updatedAt: store.now })
}

/** Het plan weghalen (afvinken blijft staan). */
export async function deleteLessonPlan(store: Tx, tripId: string): Promise<void> {
  const trip = liveTrip(store, tripId)
  const { lessonPlan: _p, ...rest } = trip
  void _p
  await store.put('trips.json.enc', { ...rest, updatedAt: store.now })
}

/** Wind of steiger van één dag wijzigen; de blokken blijven waar ze staan (een nieuw voorstel komt pas na een tik). */
export function withDayInput(days: readonly LessonPlanDay[], date: string, patch: { wind?: LessonPlanDay['wind'] | null; dock?: boolean }): LessonPlanDay[] {
  return days.map((d) => {
    if (d.date !== date) return d
    const next: LessonPlanDay = { ...d }
    if (patch.wind !== undefined) {
      if (patch.wind) next.wind = patch.wind
      else delete next.wind
    }
    if (patch.dock !== undefined) {
      if (patch.dock) next.dock = true
      else delete next.dock
    }
    return next
  })
}

/** Een blok verplaatsen naar een andere dag en ander dagdeel (of weghalen met `to` = null). */
export function movedBlock(days: readonly LessonPlanDay[], id: string, from: { date: string; slot: LessonSlot }, to: { date: string; slot: LessonSlot } | null): LessonPlanDay[] {
  return days.map((d) => {
    const next = { ...d, ochtend: [...d.ochtend], middag: [...d.middag], avond: [...d.avond] }
    if (d.date === from.date) next[from.slot] = next[from.slot].filter((x) => x !== id)
    if (to && d.date === to.date && !next[to.slot].includes(id)) next[to.slot].push(id)
    return next
  })
}
