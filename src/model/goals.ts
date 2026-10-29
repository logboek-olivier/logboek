import type { Store } from '../storage/store'
import { tripOrganisation } from './counters'
import { active, totalNm } from './derive'
import { addDays, isEarned, isIncome, mondayOf } from './money'
import { eurValue, type RatesFile } from './rates'
import { ryaYachtmasterOffshore } from './stats'
import { newId, type Goal, type GoalMetric, type Leg, type Milestone, type Organisation, type Session, type Skill, type Transaction, type Trip } from './types'
import { weekView } from './weeks'

// Doelen en skills (Meer → Doelen, snel loggen via + → Skill). Jaardoelen vullen zichzelf uit de app: nm in het jaar,
// trips bij een organisatie, de Yachtmaster-voortgang (eisen gehaald van de zeven) en de inkomsten in euro. Losse
// doelen meet Olivier zelf (gewicht, keer sporten per week): elke meting is een sessie met `goalId`. Skills
// (kitesurfen, vissen, kreeft vangen, adem inhouden) hebben sessies met minuten en/of een waarde, een trend en
// mijlpalen. Sessies zijn losse records (sessions.json.enc), zodat twee apparaten elkaars sessies nooit overschrijven.

export interface GoalData {
  legs: readonly Leg[]
  trips: readonly Trip[]
  transactions: readonly Transaction[]
  rates: RatesFile | null
}

/** De waarde van een zelfvullend doel in zijn jaar. */
export function autoValue(goal: Pick<Goal, 'metric' | 'year' | 'organisation'>, data: GoalData): number {
  const year = String(goal.year ?? new Date().getFullYear())
  const inYear = (date: string | undefined) => !!date && date.startsWith(`${year}-`)
  switch (goal.metric) {
    case 'nm':
      return Math.round(active(data.legs).filter((l) => inYear(l.date)).reduce((n, l) => n + totalNm(l), 0) * 10) / 10
    case 'trips':
      // Een trip telt in het jaar waarin hij begint, bij de organisatie van de trip (ook uit de naam, zoals de teller).
      return active(data.trips).filter((trip) => {
        const org: Organisation | null = trip.organisation ?? tripOrganisation(trip)
        return (!goal.organisation || org === goal.organisation) && inYear(weekView(trip, data.legs).startDate)
      }).length
    case 'yachtmaster':
      // Over alle dagen, net als in Statistieken: hoeveel van de eisen gehaald zijn.
      return ryaYachtmasterOffshore(data.legs).filter((item) => item.done).length
    case 'inkomsten':
      return Math.round(active(data.transactions).filter((tx) => isIncome(tx.kind) && isEarned(tx.kind) && inYear(tx.date)).reduce((sum, tx) => sum + (eurValue(tx, data.rates)?.eur ?? 0), 0) * 100) / 100
    default:
      return 0
  }
}

export const YACHTMASTER_ITEMS = 7

export interface GoalProgress {
  /** Huidige waarde; null bij een meetdoel zonder metingen. */
  current: number | null
  /** Eerste meting (meetdoel). */
  start: number | null
  target: number
  /** Voortgang 0–1. */
  share: number
  done: boolean
  /** Laatste meting (meetdoel). */
  lastDate: string | null
}

/** De metingen van een doel, oudste eerst. */
export function measurements(goal: Goal, sessions: readonly Session[]): Session[] {
  return active(sessions)
    .filter((s) => s.goalId === goal.id && typeof s.value === 'number')
    .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt))
}

export function goalProgress(goal: Goal, sessions: readonly Session[], data: GoalData): GoalProgress {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)
  if (goal.kind === 'auto') {
    const current = autoValue(goal, data)
    return { current, start: null, target: goal.target, share: clamp(goal.target > 0 ? current / goal.target : 0), done: current >= goal.target, lastDate: null }
  }
  const list = measurements(goal, sessions)
  const first = list[0]?.value ?? null
  const last = list.at(-1)
  const current = last?.value ?? null
  if (current === null || first === null) return { current: null, start: null, target: goal.target, share: 0, done: false, lastDate: null }
  const lower = goal.lower ?? goal.target < first
  const done = lower ? current <= goal.target : current >= goal.target
  // Van de eerste meting naar het doel; begint de eerste meting al op het doel, dan telt alleen of het gehaald is.
  const span = goal.target - first
  const share = done ? 1 : span === 0 ? 0 : clamp((current - first) / span)
  return { current, start: first, target: goal.target, share, done, lastDate: last?.date ?? null }
}

// ---------- Skills ----------

export interface SkillStats {
  sessions: number
  minutes: number
  /** Hoogste waarde (best) of de som van de waarden; null zonder waarden. */
  value: number | null
  last: string | null
  /** Minuten per week, de laatste acht weken (maandag als begin), oudste eerst. */
  weeks: { start: string; minutes: number; sessions: number }[]
  /** Laatste vier weken tegenover de vier daarvoor (minuten, anders aantal sessies). */
  trend: 'op' | 'af' | 'gelijk' | null
  milestonesDone: number
}

export function skillSessions(skill: Skill, sessions: readonly Session[]): Session[] {
  return active(sessions)
    .filter((s) => s.skillId === skill.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
}

export function skillStats(skill: Skill, sessions: readonly Session[], today: string): SkillStats {
  const own = skillSessions(skill, sessions)
  const minutes = own.reduce((n, s) => n + (s.minutes ?? 0), 0)
  const values = own.map((s) => s.value).filter((v): v is number => typeof v === 'number')
  const value = values.length === 0 ? null : skill.best ? Math.max(...values) : Math.round(values.reduce((n, v) => n + v, 0) * 10) / 10
  const thisMonday = mondayOf(today)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(thisMonday, -7 * (7 - i))
    const end = addDays(start, 6)
    const inWeek = own.filter((s) => s.date >= start && s.date <= end)
    return { start, minutes: inWeek.reduce((n, s) => n + (s.minutes ?? 0), 0), sessions: inWeek.length }
  })
  const sum = (from: string, to: string, key: 'minutes' | 'sessions') => {
    const inRange = own.filter((s) => s.date > from && s.date <= to)
    return key === 'minutes' ? inRange.reduce((n, s) => n + (s.minutes ?? 0), 0) : inRange.length
  }
  const key = minutes > 0 ? 'minutes' : 'sessions'
  const recent = sum(addDays(today, -28), today, key)
  const before = sum(addDays(today, -56), addDays(today, -28), key)
  const trend = recent === 0 && before === 0 ? null : recent > before ? 'op' : recent < before ? 'af' : 'gelijk'
  return { sessions: own.length, minutes, value, last: own[0]?.date ?? null, weeks, trend, milestonesDone: skill.milestones.filter((m) => m.doneAt).length }
}

// ---------- Voorstellen ----------

export interface SkillSuggestion {
  key: 'kitesurfen' | 'vissen' | 'kreeft' | 'adem'
  valueUnit?: { nl: string; en: string }
  best?: boolean
}

/** Skills om met één tik toe te voegen (de naam komt uit de vertalingen, in de taal van dat moment). */
export const SKILL_SUGGESTIONS: readonly SkillSuggestion[] = [
  { key: 'kitesurfen' },
  { key: 'vissen', valueUnit: { nl: 'vissen', en: 'fish' } },
  { key: 'kreeft', valueUnit: { nl: 'kreeften', en: 'lobsters' } },
  { key: 'adem', valueUnit: { nl: 's', en: 's' }, best: true },
]

export interface GoalSuggestion {
  key: 'afvallen' | 'sporten'
  unit: { nl: string; en: string }
  lower: boolean
  /** Afstand tot het doel vanaf de huidige waarde (afvallen: 5 kilo eraf); anders een vast doel. */
  delta?: number
  target?: number
}

export const GOAL_SUGGESTIONS: readonly GoalSuggestion[] = [
  { key: 'afvallen', unit: { nl: 'kg', en: 'kg' }, lower: true, delta: 5 },
  { key: 'sporten', unit: { nl: 'keer per week', en: 'times a week' }, lower: false, target: 3 },
]

/** Standaarddoel per soort zelfvullend doel. */
export function defaultTarget(metric: GoalMetric): number {
  return metric === 'nm' ? 2500 : metric === 'trips' ? 10 : metric === 'yachtmaster' ? YACHTMASTER_ITEMS : 10000
}

// ---------- Opslaan ----------

/** "78,4", "78.4", "1.500" → getal; leeg of ongeldig → null. Nul mag (een sessie zonder vangst). */
export function parseValue(text: string): number | null {
  const cleaned = text.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function cleanText(value: string, max = 80): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

export async function saveGoal(store: Store, goal: Omit<Goal, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string | undefined }): Promise<Goal> {
  const record: Goal = { ...goal, id: goal.id ?? newId(), title: cleanText(goal.title), updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('goals.json.enc', record)
  return record
}

export async function saveSkill(store: Store, skill: Omit<Skill, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string | undefined }): Promise<Skill> {
  const record: Skill = {
    ...skill,
    id: skill.id ?? newId(),
    name: cleanText(skill.name),
    milestones: skill.milestones.map((m) => ({ ...m, title: cleanText(m.title) })).filter((m) => m.title),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }
  await store.put('skills.json.enc', record)
  return record
}

export function newMilestone(title: string): Milestone {
  return { id: newId(), title: cleanText(title), doneAt: null }
}

/** Een mijlpaal afvinken of weer openzetten (de skill krijgt een nieuwe updatedAt). */
export async function toggleMilestone(store: Store, skill: Skill, milestoneId: string, today: string): Promise<void> {
  const milestones = skill.milestones.map((m) => (m.id === milestoneId ? { ...m, doneAt: m.doneAt ? null : today } : m))
  await store.put('skills.json.enc', { ...skill, milestones, updatedAt: new Date().toISOString() })
}

/** Eén sessie bij een skill of één meting bij een doel. Lege of negatieve getallen vallen weg. */
export async function logSession(store: Store, input: { date: string; skillId?: string; goalId?: string; minutes?: number | null; value?: number | null; note?: string }): Promise<Session> {
  const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  const note = cleanText(input.note ?? '', 300)
  const record: Session = {
    id: newId(),
    date: input.date,
    ...(input.skillId ? { skillId: input.skillId } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(ok(input.minutes) ? { minutes: Math.round(input.minutes) } : {}),
    ...(ok(input.value) ? { value: Math.round(input.value * 100) / 100 } : {}),
    ...(note ? { note } : {}),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }
  await store.put('sessions.json.enc', record)
  return record
}
