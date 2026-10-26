import { translate, type Lang } from '../i18n'
import type { Store } from '../storage/store'
import { active, compareLegs, round1, totalNm } from './derive'
import type { Undo } from './edit'
import { addDays } from './money'
import { saveSettings } from './settings'
import { newId, type Leg, type Organisation, type Participant, type Role, type Settings, type StudentLevel, type Trip, type WeekReview, type WeekType } from './types'

// Weken: een tocht met type, datums, boot, gebied, organisatie, deelnemers en review. Oudere tochten hebben alleen een
// naam; dan worden type (voorstel uit de naam) en datums (uit de dagen) afgeleid zonder iets op te slaan.

export const DEFAULT_WEEK_DAYS = 7
export const MAX_WEEK_DAYS = 31
const MAX_TEXT = 120

/** ISO-weeknummer (maandag eerste dag, week 1 bevat de eerste donderdag). */
export function isoWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y!, m! - 1, d!))
  const weekday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - weekday + 3)
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((day.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

export function defaultWeekName(startDate: string, lang: Lang): string {
  return translate(lang, 'week.defaultName', { n: isoWeek(startDate) })
}

/** Voorstel voor het type uit de naam van een (geïmporteerde) tocht. */
export function suggestType(name: string): WeekType {
  if (/yacht\s*week/i.test(name)) return 'skipper-charter'
  if (/\bRYA\b/i.test(name)) return 'zelf-trainen'
  return 'overig'
}

/** De rol op een dag volgt standaard uit het type; bij "overig" de laatst gebruikte rol. */
export function roleForType(type: WeekType): Role | null {
  switch (type) {
    case 'training-geven':
      return 'instructeur'
    case 'skipper-charter':
    case 'zelf-cruisen':
    case 'delivery':
      return 'schipper'
    case 'zelf-trainen':
      return 'trainee'
    case 'overig':
      return null
  }
}

export interface WeekView {
  trip: Trip
  type: WeekType
  /** Het type is een voorstel (niet opgeslagen). */
  typeSuggested: boolean
  startDate: string
  endDate: string
  boat: string
  legs: Leg[]
  days: number
  nm: number
}

/** Een tocht als week, met afgeleide waarden waar velden ontbreken. */
export function weekView(trip: Trip, legs: readonly Leg[]): WeekView {
  const own = active(legs)
    .filter((l) => l.tripId === trip.id)
    .sort(compareLegs)
  const first = own[0]?.date
  const last = own.at(-1)?.date
  const startDate = trip.startDate ?? first ?? ''
  const endDate = trip.endDate ?? last ?? (startDate ? addDays(startDate, DEFAULT_WEEK_DAYS - 1) : '')
  return {
    trip,
    type: trip.type ?? suggestType(trip.name),
    typeSuggested: !trip.type,
    startDate,
    endDate,
    boat: trip.boat ?? own.at(-1)?.boat ?? '',
    legs: own,
    days: own.length,
    nm: round1(own.reduce((n, l) => n + totalNm(l), 0)),
  }
}

export function activeWeek(trips: readonly Trip[], settings: Settings): Trip | null {
  if (!settings.activeWeekId) return null
  return trips.find((t) => t.id === settings.activeWeekId && t.deletedAt === null && !t.closedAt) ?? null
}

/** Voorbij de einddatum en nog niet afgerond: Deze week vraagt om "Week afronden". */
export function needsClosing(week: WeekView, today: string): boolean {
  return !week.trip.closedAt && !!week.endDate && week.endDate < today
}

/** Eerdere boten en gebieden, nieuwste eerst, voor suggesties. */
export function suggestions(trips: readonly Trip[], legs: readonly Leg[]): { boats: string[]; areas: string[] } {
  const boats = new Set<string>()
  const areas = new Set<string>()
  const sorted = [...active(trips)].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  for (const t of sorted) {
    if (t.boat) boats.add(t.boat)
    if (t.area) areas.add(t.area)
  }
  for (const l of [...active(legs)].sort(compareLegs).reverse()) if (l.boat) boats.add(l.boat)
  return { boats: [...boats].slice(0, 20), areas: [...areas].slice(0, 20) }
}

// ---------- Opslaan ----------

export interface ParticipantInput {
  id?: string
  firstName: string
  level?: StudentLevel
  curriculumId?: string
}

export interface WeekInput {
  name: string
  type: WeekType
  startDate: string
  dayCount: number
  boat: string
  area: string
  organisation?: Organisation
  participants: ParticipantInput[]
  note: string
}

/** Alleen voornaam, niveau en cursus; lege regels vallen weg (regel 14). */
export function cleanParticipants(rows: readonly ParticipantInput[]): Participant[] {
  return rows
    .map((r) => ({ ...r, firstName: r.firstName.trim().slice(0, 40) }))
    .filter((r) => r.firstName !== '')
    .map((r) => ({
      id: r.id ?? newId(),
      firstName: r.firstName,
      ...(r.level ? { level: r.level } : {}),
      ...(r.curriculumId ? { curriculumId: r.curriculumId } : {}),
    }))
}

export function weekFields(input: WeekInput, lang: Lang): Omit<Trip, 'id' | 'updatedAt' | 'deletedAt'> {
  const days = Math.max(1, Math.min(MAX_WEEK_DAYS, Math.round(input.dayCount) || DEFAULT_WEEK_DAYS))
  const text = (v: string) => v.trim().slice(0, MAX_TEXT)
  return {
    name: text(input.name) || defaultWeekName(input.startDate, lang),
    type: input.type,
    startDate: input.startDate,
    endDate: addDays(input.startDate, days - 1),
    ...(text(input.boat) ? { boat: text(input.boat) } : {}),
    ...(text(input.area) ? { area: text(input.area) } : {}),
    ...(input.organisation ? { organisation: input.organisation } : {}),
    participants: cleanParticipants(input.participants),
    ...(input.note.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
  }
}

/** Nieuwe week: opslaan maakt hem actief. */
export async function startWeek(store: Store, input: WeekInput, lang: Lang): Promise<Trip> {
  const trip: Trip = { id: newId(), ...weekFields(input, lang), updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('trips.json.enc', trip)
  await saveSettings(store, { activeWeekId: trip.id, ...(trip.boat ? { lastBoat: trip.boat } : {}) })
  void store.sync()
  return trip
}

/** Bestaande week bijwerken; review en afronding blijven staan. */
export async function updateWeek(store: Store, trip: Trip, input: WeekInput, lang: Lang): Promise<void> {
  const { boat: _b, area: _a, organisation: _o, note: _n, ...rest } = trip
  void [_b, _a, _o, _n]
  await store.put('trips.json.enc', { ...rest, ...weekFields(input, lang), updatedAt: new Date().toISOString() })
  void store.sync()
}

export function dayCountOf(week: Pick<WeekView, 'startDate' | 'endDate'>): number {
  if (!week.startDate || !week.endDate) return DEFAULT_WEEK_DAYS
  const ms = Date.parse(`${week.endDate}T00:00:00Z`) - Date.parse(`${week.startDate}T00:00:00Z`)
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/** Week afronden: review opslaan, afgerond, en niet meer de lopende week. */
export async function closeWeek(store: Store, trip: Trip, review: WeekReview, today: string, settings: Settings): Promise<Undo> {
  const before = trip
  const quotes = review.quotes.map((q) => q.trim()).filter(Boolean).slice(0, 50)
  const cleanReview: WeekReview = { quotes, ...(review.score !== undefined && Number.isFinite(review.score) ? { score: review.score } : {}) }
  await store.put('trips.json.enc', { ...trip, review: cleanReview, closedAt: today, updatedAt: new Date().toISOString() })
  const wasActive = settings.activeWeekId === trip.id
  if (wasActive) await saveSettings(store, { activeWeekId: null })
  void store.sync()
  return async () => {
    await store.put('trips.json.enc', { ...before, updatedAt: new Date().toISOString() })
    if (wasActive) await saveSettings(store, { activeWeekId: trip.id })
    void store.sync()
  }
}
