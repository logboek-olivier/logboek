import type { Store } from '../storage/store'
import { dayInfo, type CalendarIndex } from './calendar'
import { totalNm } from './derive'
import { addDays } from './money'
import type { Student, WeekClosing } from './types'
import { isoWeek } from './weeks'

// Weekafsluiting (Vandaag op zondag, terug te lezen in de agenda op de dagkaart van de zondag): een automatische
// samenvatting van de week (maandag tot en met zondag), een cijfer 1–10 en één zin. De samenvatting wordt elke keer
// uitgerekend uit de dagen, de agenda en de studenten; opgeslagen worden alleen het cijfer en de zin
// (`weekreviews.json.enc`, één record per ISO-week; het id volgt uit de week, zodat twee apparaten dezelfde week
// samenvoegen). Geen bedragen en geen namen van studenten: Vandaag staat ook open als studenten meekijken.

export const LESSON_MAX = 200

export function mondayOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(date, -weekday)
}

export function sundayOf(date: string): string {
  return addDays(mondayOf(date), 6)
}

export function isSundayDate(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 0
}

/** ISO-week van een datum als "2026-W44" (het jaar van de donderdag van die week). */
export function weekKey(date: string): string {
  const thursday = addDays(mondayOf(date), 3)
  return `${thursday.slice(0, 4)}-W${String(isoWeek(date)).padStart(2, '0')}`
}

export function weekClosingId(date: string): string {
  return `week:${weekKey(date)}`
}

export interface WeekSummary {
  /** Maandag en zondag. */
  start: string
  end: string
  /** Dagen met minstens één gelogde etappe. */
  sailingDays: number
  nm: number
  nightHours: number
  /** Namen van de trips met dagen of werk in deze week. */
  trips: string[]
  /** Dagsoorten uit de agenda. */
  werk: number
  rust: number
  reis: number
  /** Verschillende plaatsen waar Olivier aankwam. */
  places: number
  /** Studenten met een examen in deze week, en hoeveel daarvan slaagden. */
  exams: number
  passed: number
}

export function weekSummary(index: CalendarIndex, students: readonly Student[], date: string, today: string): WeekSummary {
  const start = mondayOf(date)
  const end = addDays(start, 6)
  const sum: WeekSummary = { start, end, sailingDays: 0, nm: 0, nightHours: 0, trips: [], werk: 0, rust: 0, reis: 0, places: 0, exams: 0, passed: 0 }
  const trips = new Set<string>()
  const places = new Set<string>()
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const legs = index.legsByDate.get(d) ?? []
    if (legs.length > 0) sum.sailingDays++
    for (const leg of legs) {
      sum.nm += totalNm(leg)
      sum.nightHours += leg.nightHours || 0
      if (leg.toPlace.trim()) places.add(leg.toPlace.trim().toLowerCase())
    }
    const info = dayInfo(index, d, today)
    if (info.type === 'werk') sum.werk++
    if (info.type === 'rust') sum.rust++
    if (info.type === 'reis') sum.reis++
    for (const v of info.trips) trips.add(v.trip.name)
  }
  for (const s of students) {
    if (s.deletedAt || !s.exam) continue
    if (s.exam.date >= start && s.exam.date <= end) {
      sum.exams++
      if (s.exam.passed) sum.passed++
    }
  }
  sum.nm = Math.round(sum.nm * 10) / 10
  sum.nightHours = Math.round(sum.nightHours * 10) / 10
  sum.trips = [...trips]
  sum.places = places.size
  return sum
}

/** De afsluiting van de week waarin een datum valt (alleen met een cijfer of een zin), of null. */
export function closingFor(closings: readonly WeekClosing[], date: string): WeekClosing | null {
  const id = weekClosingId(date)
  return closings.find((r) => r.id === id && !r.deletedAt && (typeof r.rating === 'number' || (r.lesson ?? '').trim() !== '')) ?? null
}

/** Op zondag de week van vandaag; op maandag de week van gisteren als die nog niet is afgesloten. Anders niets. */
export function weekToClose(today: string, closings: readonly WeekClosing[]): string | null {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  if (weekday === 6) return closingFor(closings, today) ? null : today
  if (weekday === 0) {
    const sunday = addDays(today, -1)
    return closingFor(closings, sunday) ? null : sunday
  }
  return null
}

/** Een week is af te sluiten zodra hij begonnen is (de maandag is vandaag of eerder). */
export function canClose(date: string, today: string): boolean {
  return mondayOf(date) <= today
}

export function cleanClosing(input: { rating: number | null; lesson: string }): Pick<WeekClosing, 'rating' | 'lesson'> {
  const rating = input.rating !== null && Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 10 ? input.rating : undefined
  const lesson = input.lesson.trim().slice(0, LESSON_MAX)
  return { ...(rating !== undefined ? { rating } : {}), ...(lesson ? { lesson } : {}) }
}

/** Cijfer en zin opslaan voor de week van een datum (bestaat de afsluiting al, dan wordt hij bijgewerkt). */
export async function saveClosing(store: Store, date: string, input: { rating: number | null; lesson: string }): Promise<void> {
  const id = weekClosingId(date)
  const now = new Date().toISOString()
  const { rating, lesson } = cleanClosing(input)
  const existing = store.list('weekreviews.json.enc').find((r) => r.id === id)
  const record: WeekClosing = {
    ...(existing ?? {}),
    id,
    week: weekKey(date),
    start: mondayOf(date),
    updatedAt: now,
    deletedAt: null,
  }
  delete record.rating
  delete record.lesson
  await store.put('weekreviews.json.enc', { ...record, ...(rating !== undefined ? { rating } : {}), ...(lesson !== undefined ? { lesson } : {}) })
}
