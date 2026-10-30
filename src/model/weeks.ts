import { translate, type Lang } from '../i18n'
import { endedFor } from './trip-dates'
import type { Store } from '../storage/store'
import { active, compareLegs, round1, totalNm, tripForDate } from './derive'
import { followTrip, tripRange } from './calendar'
import { MAX_COUNTRY, MAX_TAG } from './guests'
import type { Undo } from './edit'
import { addDays } from './money'
import { currentSettings, saveSettings } from './settings'
import { cleanSalary, withSalaryDefault } from './salary'
import { firstNameOnly, newId, todayIso, type TripSalary, type BoatKind, type Leg, type Organisation, type Participant, type PlannedLeg, type Role, type Settings, type Student, type StudentLevel, type Trip, type WeekPlan, type WeekReview, type WeekType } from './types'

// Trips (in de code nog "week"): een tocht van elke lengte met type, datums, boot (naam, model, lengte, soort, basis,
// charterbedrijf), gebied, organisatie, deelnemers en review. Oudere tochten hebben alleen een naam; dan worden type
// (voorstel uit de naam) en datums (uit de dagen) afgeleid zonder iets op te slaan.

export const DEFAULT_WEEK_DAYS = 7
export const MAX_WEEK_DAYS = 120
export const FEET_PER_METRE = 3.28084
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

/** Standaardnaam van een trip: basis en maand, bijvoorbeeld "Nanny Cay okt 2026"; zonder basis "Trip okt 2026". */
export function defaultWeekName(startDate: string, lang: Lang, base = ''): string {
  const [y, m] = startDate.split('-').map(Number)
  const month = new Date(Date.UTC(y!, (m ?? 1) - 1, 15)).toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return translate(lang, 'trip.defaultName', { place: base.trim() || translate(lang, 'field.trip'), month: month.replace('.', '') })
}

/** Lengte in meters (één decimaal) bij een lengte in voet. */
export function feetToMetres(ft: number): number {
  return Math.round((ft / FEET_PER_METRE) * 10) / 10
}

export interface BoatProfile {
  boatModel?: string
  boatLengthFt?: number
  boatKind?: BoatKind
  base?: string
  charter?: string
}

/** De bootgegevens van de laatste trip met deze boot, om een nieuwe trip met één keuze in te vullen. */
export function boatProfile(trips: readonly Trip[], boat: string, exceptId?: string): BoatProfile | null {
  const name = boat.trim().toLowerCase()
  if (!name) return null
  const match = active(trips)
    .filter((t) => t.id !== exceptId && t.boat?.trim().toLowerCase() === name && (t.boatModel || t.boatLengthFt || t.base))
    .sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0]
  if (!match) return null
  return {
    ...(match.boatModel ? { boatModel: match.boatModel } : {}),
    ...(match.boatLengthFt ? { boatLengthFt: match.boatLengthFt } : {}),
    ...(match.boatKind ? { boatKind: match.boatKind } : {}),
    ...(match.base ? { base: match.base } : {}),
    ...(match.charter ? { charter: match.charter } : {}),
  }
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

/**
 * De lopende trip: de trip die Olivier als lopend heeft gestart, anders de trip waarin vandaag valt (vooraf ingevoerde
 * trips worden zo vanzelf lopend). Afgeronde trips nooit.
 */
export function activeWeek(trips: readonly Trip[], settings: Settings, today: string = todayIso()): Trip | null {
  const open = trips.filter((t) => t.deletedAt === null && !t.closedAt)
  const chosen = settings.activeWeekId ? open.find((t) => t.id === settings.activeWeekId) : undefined
  if (chosen) return chosen
  const inside = open.find((t) => t.startDate && t.endDate && t.startDate <= today && today <= t.endDate)
  if (inside) return inside
  // Een trip uit Toevoegen → Dag (datums volgen de dagen) blijft drie dagen na de laatste gelogde dag lopend, zodat
  // hij 's ochtends vóór het loggen nog in Deze trip staat. Een trip met eigen datums waarin vandaag valt, gaat voor.
  return open.find((t) => t.datesFromDays && t.startDate && t.endDate && t.startDate <= today && today <= endedFor(t, t.endDate)) ?? null
}

/** Komende trips (start na vandaag), eerstvolgende eerst. */
export function upcomingTrips(trips: readonly Trip[], today: string = todayIso()): Trip[] {
  return active(trips)
    .filter((t) => !t.closedAt && !!t.startDate && t.startDate > today)
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))
}

/** Dagen binnen de trip (tot en met vandaag) zonder gelogde dag, oudste eerst. */
export function missingDays(view: WeekView, today: string = todayIso()): string[] {
  if (!view.startDate || !view.endDate) return []
  const logged = new Set(view.legs.map((l) => l.date))
  const result: string[] = []
  for (let d = view.startDate; d <= view.endDate && d <= today; d = addDays(d, 1)) if (!logged.has(d)) result.push(d)
  return result
}

/** Voorbij de einddatum en nog niet afgerond: Deze week vraagt om "Week afronden". */
export function needsClosing(week: WeekView, today: string): boolean {
  // Volgen de datums de dagen, dan is de trip pas voorbij als er drie dagen geen dag bijkwam.
  return !week.trip.closedAt && !!week.endDate && endedFor(week.trip, week.endDate) < today
}

/** Eerdere boten, gebieden, bases en charterbedrijven, nieuwste eerst, voor suggesties. */
export function suggestions(trips: readonly Trip[], legs: readonly Leg[]): { boats: string[]; areas: string[]; bases: string[]; charters: string[] } {
  const boats = new Set<string>()
  const areas = new Set<string>()
  const bases = new Set<string>()
  const charters = new Set<string>()
  const sorted = [...active(trips)].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  for (const t of sorted) {
    if (t.boat) boats.add(t.boat)
    if (t.area) areas.add(t.area)
    if (t.base) bases.add(t.base)
    if (t.charter) charters.add(t.charter)
  }
  for (const l of [...active(legs)].sort(compareLegs).reverse()) if (l.boat) boats.add(l.boat)
  const top = (set: Set<string>) => [...set].slice(0, 20)
  return { boats: top(boats), areas: top(areas), bases: top(bases), charters: top(charters) }
}

// ---------- Opslaan ----------

export interface ParticipantInput {
  id?: string
  firstName: string
  level?: StudentLevel
  curriculumId?: string
  country?: string
  tag?: string
  guestId?: string
}

export interface WeekInput {
  name: string
  type: WeekType
  startDate: string
  dayCount: number
  boat: string
  boatModel: string
  /** Lengte in voet. */
  boatLengthFt: number | null
  boatKind?: BoatKind
  base: string
  charter: string
  area: string
  organisation?: Organisation
  participants: ParticipantInput[]
  note: string
  /** Geplande etappes (sjabloon of vorige trip); ontbreekt het, dan blijft een bestaande planning staan. */
  route?: PlannedLeg[]
  /**
   * Salaris zoals in het bewerkscherm gekozen; null = weggehaald. Ontbreekt het, dan geldt het standaardbedrag van de
   * organisatie (alleen zonder eigen of ontvangen salaris, src/model/salary.ts).
   */
  salary?: TripSalary | null
}

/** Geplande etappes: korte plaatsnamen, hoogstens 120 dagen. */
export function cleanRoute(route: readonly PlannedLeg[]): PlannedLeg[] {
  return route
    .filter((r) => Number.isInteger(r.day) && r.day >= 0 && r.day < MAX_WEEK_DAYS && (r.from.trim() || r.to.trim()))
    .slice(0, MAX_WEEK_DAYS)
    .map((r) => ({ day: r.day, from: r.from.trim().slice(0, 80), to: r.to.trim().slice(0, 80), ...(r.nm !== undefined && Number.isFinite(r.nm) && r.nm >= 0 ? { nm: r.nm } : {}) }))
}

/** Alleen voornaam, niveau, cursus, land, kort kenmerk en de koppeling met een eerdere gast; lege regels vallen weg (regel 14). */
export function cleanParticipants(rows: readonly ParticipantInput[]): Participant[] {
  return rows
    .map((r) => ({ ...r, firstName: firstNameOnly(r.firstName).slice(0, 40) }))
    .filter((r) => r.firstName !== '')
    .map((r) => {
      const country = (r.country ?? '').trim().slice(0, MAX_COUNTRY)
      const tag = (r.tag ?? '').trim().slice(0, MAX_TAG)
      return {
        id: r.id ?? newId(),
        firstName: r.firstName,
        ...(r.level ? { level: r.level } : {}),
        ...(r.curriculumId ? { curriculumId: r.curriculumId } : {}),
        ...(country ? { country } : {}),
        ...(tag ? { tag } : {}),
        ...(r.guestId ? { guestId: r.guestId } : {}),
      }
    })
}

export function weekFields(input: WeekInput, lang: Lang): Omit<Trip, 'id' | 'updatedAt' | 'deletedAt'> {
  const days = Math.max(1, Math.min(MAX_WEEK_DAYS, Math.round(input.dayCount) || DEFAULT_WEEK_DAYS))
  const text = (v: string) => v.trim().slice(0, MAX_TEXT)
  const length = input.boatLengthFt !== null && Number.isFinite(input.boatLengthFt) && input.boatLengthFt > 0 ? Math.round(input.boatLengthFt * 10) / 10 : null
  // Zonder startdatum geen datums; de trip krijgt ze dan uit de dagen.
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
  return {
    name: text(input.name) || defaultWeekName(dated ? input.startDate : todayIso(), lang, input.base),
    type: input.type,
    ...(dated ? { startDate: input.startDate, endDate: addDays(input.startDate, days - 1) } : {}),
    ...(text(input.boat) ? { boat: text(input.boat) } : {}),
    ...(text(input.boatModel) ? { boatModel: text(input.boatModel) } : {}),
    ...(length !== null ? { boatLengthFt: length } : {}),
    ...(input.boatKind ? { boatKind: input.boatKind } : {}),
    ...(text(input.base) ? { base: text(input.base) } : {}),
    ...(text(input.charter) ? { charter: text(input.charter) } : {}),
    ...(text(input.area) ? { area: text(input.area) } : {}),
    ...(input.organisation ? { organisation: input.organisation } : {}),
    participants: cleanParticipants(input.participants),
    ...(input.note.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
    ...(input.route && input.route.length > 0 ? { route: cleanRoute(input.route) } : {}),
  }
}

/** Nieuwe trip: opslaan maakt hem lopend als vandaag erin valt; eerdere en komende trips laten de lopende staan. */
export async function startWeek(store: Store, input: WeekInput, lang: Lang, today: string = todayIso()): Promise<Trip> {
  const fields: Trip = { id: newId(), ...weekFields(input, lang), updatedAt: new Date().toISOString(), deletedAt: null }
  const settings = currentSettings(store.list('settings.json.enc'))
  const trip = input.salary ? { ...fields, salary: cleanSalary(input.salary) } : input.salary === null ? fields : withSalaryDefault(fields, settings, undefined, store.list('legs.json.enc'), today)
  await store.put('trips.json.enc', trip)
  // De agenda volgt direct: zelf ingestelde dagen in de nieuwe trip maken plaats voor werk.
  await followTrip(store, trip.id, null, tripRange(trip, store.list('legs.json.enc')))
  await syncParticipants(store, trip)
  const current = !!trip.startDate && !!trip.endDate && trip.startDate <= today && today <= trip.endDate
  await saveSettings(store, { ...(current ? { activeWeekId: trip.id } : {}), ...(trip.boat ? { lastBoat: trip.boat } : {}) })
  void store.sync()
  return trip
}

/** Bestaande week bijwerken; review en afronding blijven staan. */
export async function updateWeek(store: Store, trip: Trip, input: WeekInput, lang: Lang): Promise<void> {
  const { startDate: _s, endDate: _e, boat: _b, boatModel: _m, boatLengthFt: _l, boatKind: _k, base: _ba, charter: _c, area: _a, organisation: _o, note: _n, route, ...rest } = trip
  void [_s, _e, _b, _m, _l, _k, _ba, _c, _a, _o, _n]
  // Zonder route in de invoer blijft de bestaande planning; een lege lijst wist hem.
  const keep = input.route === undefined && route ? { route } : {}
  const merged: Trip = { ...rest, ...keep, ...weekFields(input, lang), updatedAt: new Date().toISOString() }
  // Salaris: wat in het bewerkscherm staat; anders volgt een standaardbedrag de (nieuwe) organisatie.
  const { salary: _old, ...withoutSalary } = merged
  void _old
  const next: Trip =
    input.salary === undefined
      ? withSalaryDefault(merged, currentSettings(store.list('settings.json.enc')), trip, store.list('legs.json.enc'), todayIso())
      : input.salary === null
        ? withoutSalary
        : { ...merged, salary: cleanSalary(input.salary) }
  // Zelf andere datums gekozen: die staan voortaan vast en volgen de dagen niet meer.
  if (next.datesFromDays && (next.startDate !== trip.startDate || next.endDate !== trip.endDate)) delete next.datesFromDays
  const legs = store.list('legs.json.enc')
  await store.put('trips.json.enc', next)
  // Verlengen of verplaatsen: de agenda volgt direct.
  await followTrip(store, trip.id, tripRange(trip, legs), tripRange(next, legs))
  await syncParticipants(store, next)
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
  const rating = review.rating !== undefined && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 10 ? review.rating : undefined
  const lesson = review.lesson?.trim().slice(0, 300)
  const cleanReview: WeekReview = {
    quotes,
    ...(review.score !== undefined && Number.isFinite(review.score) ? { score: review.score } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(lesson ? { lesson } : {}),
  }
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

// ---------- Studenten en planningen bij een week ----------

/**
 * De week van een student of planning: het opgeslagen weekId/tripId, anders de week waarin de datum valt
 * (migratie zonder schrijven: oudere studenten en planningen hebben geen week). Null = "zonder week".
 */
export function studentWeek(student: Student, trips: readonly Trip[], legs: readonly Leg[]): string | null {
  if (student.weekId && trips.some((t) => t.id === student.weekId && t.deletedAt === null)) return student.weekId
  return student.startedAt ? (tripForDate(trips, legs, student.startedAt)?.id ?? null) : null
}

export function planWeek(plan: WeekPlan, trips: readonly Trip[], legs: readonly Leg[]): string | null {
  if (plan.tripId && trips.some((t) => t.id === plan.tripId && t.deletedAt === null)) return plan.tripId
  return tripForDate(trips, legs, plan.startDate)?.id ?? null
}

/**
 * Deelnemers met een cursus krijgen een student (zelfde id) voor hun checklist; een bestaande student krijgt de
 * nieuwe voornaam, cursus en niveau. Een deelnemer die van de week verdwijnt, houdt zijn student (en voortgang).
 */
export async function syncParticipants(store: Store, trip: Trip): Promise<void> {
  const students = store.get('students.json.enc')
  const now = new Date().toISOString()
  const changed: Student[] = []
  for (const p of trip.participants ?? []) {
    if (!p.curriculumId) continue
    const existing = students.find((s) => s.id === p.id)
    if (!existing) {
      changed.push({
        id: p.id,
        firstName: p.firstName,
        curriculumId: p.curriculumId,
        level: p.level ?? 'beginner',
        progress: {},
        archivedAt: null,
        weekId: trip.id,
        ...(trip.startDate ? { startedAt: trip.startDate } : {}),
        updatedAt: now,
        deletedAt: null,
      })
    } else if (existing.deletedAt === null) {
      const next = { ...existing, firstName: p.firstName, curriculumId: p.curriculumId, level: p.level ?? existing.level, weekId: trip.id }
      if (JSON.stringify(next) !== JSON.stringify(existing)) changed.push({ ...next, updatedAt: now })
    }
  }
  if (changed.length > 0) await store.putMany('students.json.enc', changed)
}

/** Een student die in Deze week wordt toegevoegd, komt ook bij de deelnemers van de week. */
export async function addParticipant(store: Store, trip: Trip, student: Student): Promise<void> {
  const participants = trip.participants ?? []
  if (participants.some((p) => p.id === student.id)) return
  const participant: Participant = { id: student.id, firstName: student.firstName, level: student.level, curriculumId: student.curriculumId }
  await store.put('trips.json.enc', { ...trip, participants: [...participants, participant], updatedAt: new Date().toISOString() })
}

/** De laatste trip die vóór of op `date` begint (voor naam- en typevoorstel van een nieuwe trip); anders de laatste. */
export function latestTripBefore(trips: readonly Trip[], legs: readonly Leg[], date: string): Trip | null {
  const dated = active(trips)
    .map((trip) => ({ trip, start: weekView(trip, legs).startDate }))
    .filter((x) => x.start)
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
  return (dated.find((x) => x.start <= date) ?? dated.at(-1))?.trip ?? null
}

/**
 * Naamvoorstel uit de vorige trip: eindigt die op een getal ("Yacht week 7", "Sailing Virgins week 2"), dan het
 * volgende getal; anders "<basis> <maand jaar>".
 */
export function suggestTripName(previous: Trip | null, startDate: string, lang: Lang): string {
  const m = previous ? /^(.*?)(\d+)(\s*)$/.exec(previous.name.trim()) : null
  if (m) return `${m[1]}${Number(m[2]) + 1}`
  return defaultWeekName(startDate, lang, previous?.base ?? '')
}

/** Eerste vrije dag vanaf vandaag: valt vandaag in een trip, dan de dag na die trip. */
export function nextFreeDay(trips: readonly Trip[], legs: readonly Leg[], today: string): string {
  let day = today
  for (let i = 0; i < 10; i++) {
    const inside = active(trips)
      .map((trip) => weekView(trip, legs))
      .find((v) => v.startDate && v.endDate && v.startDate <= day && day <= v.endDate)
    if (!inside) return day
    day = addDays(inside.endDate, 1)
  }
  return day
}
