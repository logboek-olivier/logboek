import { isBooked } from '../domain/geldmodel'
import type { Tx, Reader } from '../domain/tx'
import { applyChanges } from './changes'
import { active, compareLegs } from './derive'
import { allPeriods, periodAt, rangeDates, setStayDays, waterRanges, type Period } from './periods'
import { saveSettings, currentSettings } from './settings'
import { kindForType, typeForKind } from './trip-kind'
import { STAY_FROM_DAY } from './migrate-periods'
import { defaultWeekName, weekView } from './weeks'
import type { Lang } from '../i18n'
import { effectiveCurricula } from './curricula'
import type { CalendarDay, Claim, Curriculum, Leg, Organisation, Place, PlanGroup, Settings, StayKind, StayPeriod, Student, Transaction, Trip, WeekPlan, WeekType } from './types'
import { addDays } from '../basis/datum'

// Nakijken (Meer → Nakijken): twijfelgevallen en tegenstrijdigheden in het periodemodel, elk met één knop die het
// oplost (met ongedaan maken) en "Klopt zo" (onthouden in settings.reviewDismissed). Alleen zichtbaar als er iets is.

export type ReviewItem =
  /** Trip zonder zekere soort: de soorten als knoppen, met het voorstel eerst. */
  | { key: string; kind: 'soort'; trip: Trip; suggestion: WeekType }
  /** Werk zonder organisatie, met een voorstel uit de source van zijn inkomsten. */
  | { key: string; kind: 'organisatie'; trip: Trip; suggestion: Organisation | null }
  /** Werkdagen in de agenda zonder trip. */
  | { key: string; kind: 'werkdag-zonder-trip'; from: string; to: string }
  /** Agendadagen thuis, reis of rust zonder periode (bijvoorbeeld van een oudere versie op een ander apparaat). */
  | { key: string; kind: 'dag-zonder-periode'; stayKind: StayKind; from: string; to: string }
  /** Een investering van vóór het periodemodel zonder soort: opleiding of uitrusting? */
  | { key: string; kind: 'investering-soort'; tx: Transaction }
  /** Inkomen of uitgave zonder periode. */
  | { key: string; kind: 'geld-zonder-periode'; tx: Transaction; target: Period | null }
  /**
   * Gelogde dagen waarvan de trip weg is (verwijderd met "Geld en dagen behouden zonder periode"): de trip terugzetten of
   * een nieuwe trip voor deze dagen. Nooit vanzelf, en nooit voorgesteld naar een andere trip.
   */
  | { key: string; kind: 'dagen-zonder-trip'; tripId: string; tripName: string | null; legs: Leg[] }
  /** Een planning waarvan de trip weg is: de trip terugzetten, koppelen aan de trip van haar startdatum, of de koppeling weghalen. */
  | { key: string; kind: 'planning-zonder-trip'; plan: WeekPlan; tripName: string | null; target: Trip | null }
  /** Een declaratie waarvan de trip weg is (ook terugbetaald, anders is ze nergens zichtbaar). */
  | { key: string; kind: 'declaratie-zonder-trip'; claim: Claim; tripName: string | null; target: Trip | null }
  /** Een student met een cursus die niet meer bestaat: de cursussen van zijn trip eerst, dan de andere. */
  | { key: string; kind: 'student-zonder-cursus'; student: Student; tripName: string | null; choices: Curriculum[] }
  /** Een groep in een planning met een cursus die niet meer bestaat: de thema's hebben geen onderwerpen meer. */
  | { key: string; kind: 'planning-zonder-cursus'; plan: WeekPlan; group: PlanGroup; choices: Curriculum[] }

export interface ReviewInput {
  trips: readonly Trip[]
  /** Verwijderde trips (voor de naam bij dagen zonder trip). */
  removedTrips?: readonly Trip[]
  legs: readonly Leg[]
  stays: readonly StayPeriod[]
  calendar: readonly CalendarDay[]
  transactions: readonly Transaction[]
  places: readonly Place[]
  settings: Settings
  plans?: readonly WeekPlan[]
  claims?: readonly Claim[]
  students?: readonly Student[]
  /** Opgeslagen cursussen (eigen en bewerkte); de meegeleverde komen uit de code. */
  curricula?: readonly Curriculum[]
}

const ORG_FROM_SOURCE: Partial<Record<Transaction['source'], Organisation>> = { 'sailing-virgins': 'sailing-virgins', 'yacht-week': 'yacht-week' }

export function reviewItems(input: ReviewInput): ReviewItem[] {
  const dismissed = new Set(input.settings.reviewDismissed ?? [])
  const items: ReviewItem[] = []
  const legs = active(input.legs)
  const trips = active(input.trips)
  const periods = allPeriods(trips, legs, input.stays)
  const ranges = waterRanges(trips, legs)
  const inWater = (d: string) => ranges.some((r) => r.start <= d && d <= r.end)
  const views = trips.map((trip) => weekView(trip, legs))

  // Soort en organisatie.
  for (const view of views) {
    if (!view.kindSure) items.push({ key: `soort:${view.trip.id}`, kind: 'soort', trip: view.trip, suggestion: view.type === 'overig' && view.kind !== 'werk' ? typeForKind(view.kind) : view.type })
    else if (view.kind === 'werk' && !view.trip.organisation) {
      const sources = active(input.transactions)
        .filter((tx) => tx.tripId === view.trip.id)
        .map((tx) => ORG_FROM_SOURCE[tx.source])
        .filter((o): o is Organisation => !!o)
      items.push({ key: `organisatie:${view.trip.id}`, kind: 'organisatie', trip: view.trip, suggestion: sources[0] ?? null })
    }
  }

  // Agenda.
  const own = active(input.calendar).sort((a, b) => (a.date < b.date ? -1 : 1))
  const stays = periods.filter((p) => p.stay)
  const inStay = (d: string) => stays.some((p) => p.start <= d && d <= p.end)
  for (const run of runsOf(own.filter((d) => d.type === 'werk' && !inWater(d.date)), () => 'werk')) items.push({ key: `werkdag:${run.from}`, kind: 'werkdag-zonder-trip', from: run.from, to: run.to })
  for (const run of runsOf(own.filter((d) => STAY_FROM_DAY[d.type] && !inWater(d.date) && !inStay(d.date)), (d) => STAY_FROM_DAY[d.type]!)) {
    items.push({ key: `landdag:${run.from}`, kind: 'dag-zonder-periode', stayKind: run.value as StayKind, from: run.from, to: run.to })
  }

  // Geld zonder periode (declaraties volgen hun declaratie).
  const ids = new Set(periods.map((p) => p.id))
  const liveClaims = new Set(active(input.claims ?? []).map((c) => c.id))
  for (const tx of active(input.transactions)) {
    // Vaste lasten hangen aan de maand, geld van een eerder seizoen aan het seizoen (docs/PERIODEMODEL.md). Een verwacht
    // salaris zonder tocht of "geen salaris" is geen geld.
    if ((tx.claimId && liveClaims.has(tx.claimId)) || tx.fixedCostId || tx.season || (tx.tripId && ids.has(tx.tripId)) || !isBooked(tx)) continue
    items.push({ key: `geld:${tx.id}`, kind: 'geld-zonder-periode', tx, target: periodAt(periods, tx.date) })
  }

  // Dagen zonder trip: per verdwenen trip één punt (terugzetten of een nieuwe trip; nooit naar een andere trip voorgesteld).
  const byId = new Map(trips.map((trip) => [trip.id, trip]))
  const orphans = new Map<string, Leg[]>()
  for (const leg of legs) if (!byId.has(leg.tripId)) orphans.set(leg.tripId, [...(orphans.get(leg.tripId) ?? []), leg])
  for (const [tripId, list] of orphans) {
    const sorted = [...list].sort(compareLegs)
    const tripName = input.removedTrips?.find((x) => x.id === tripId)?.name ?? null
    items.push({ key: `dagen-zonder-trip:${tripId}`, kind: 'dagen-zonder-trip', tripId, tripName, legs: sorted })
  }

  // Planningen en declaraties waarvan de trip weg is ("Geld en dagen behouden zonder periode"); nooit stil verhuisd.
  const removedName = (tripId: string) => input.removedTrips?.find((x) => x.id === tripId)?.name ?? null
  const tripOn = (date: string) => trips.find((t) => t.startDate && t.endDate && t.startDate <= date && date <= t.endDate) ?? null
  for (const plan of active(input.plans ?? [])) {
    if (plan.tripId && !byId.has(plan.tripId)) items.push({ key: `planning:${plan.id}`, kind: 'planning-zonder-trip', plan, tripName: removedName(plan.tripId), target: tripOn(plan.startDate) })
  }
  for (const claim of active(input.claims ?? [])) {
    if (claim.tripId && !byId.has(claim.tripId)) items.push({ key: `declaratie:${claim.id}`, kind: 'declaratie-zonder-trip', claim, tripName: removedName(claim.tripId), target: tripOn(claim.date) })
  }

  // Studenten met een cursus die weg is (bijvoorbeeld verwijderd onder Meer → Cursussen).
  const courses = effectiveCurricula(input.curricula ?? [])
  const courseIds = new Set(courses.map((c) => c.id))
  for (const student of active(input.students ?? [])) {
    if (student.archivedAt || !student.curriculumId || courseIds.has(student.curriculumId)) continue
    const trip = student.weekId ? byId.get(student.weekId) : undefined
    const inTrip = new Set((trip?.participants ?? []).map((p) => p.curriculumId).filter((id): id is string => !!id && courseIds.has(id)))
    const choices = [...courses.filter((c) => inTrip.has(c.id)), ...courses.filter((c) => !inTrip.has(c.id))]
    items.push({ key: `cursus:${student.id}`, kind: 'student-zonder-cursus', student, tripName: trip?.name ?? null, choices })
  }

  for (const plan of active(input.plans ?? [])) {
    const trip = plan.tripId ? byId.get(plan.tripId) : undefined
    const inTrip = new Set((trip?.participants ?? []).map((p) => p.curriculumId).filter((id): id is string => !!id && courseIds.has(id)))
    for (const group of plan.groups) {
      if (!group.curriculumId || courseIds.has(group.curriculumId)) continue
      const choices = [...courses.filter((c) => inTrip.has(c.id)), ...courses.filter((c) => !inTrip.has(c.id))]
      items.push({ key: `planning-cursus:${plan.id}:${group.id}`, kind: 'planning-zonder-cursus', plan, group, choices })
    }
  }

  // Investeringen zonder soort (van vóór het periodemodel).
  for (const tx of active(input.transactions)) if (tx.kind === 'investering' && tx.category !== 'opleiding' && tx.category !== 'uitrusting') items.push({ key: `investering:${tx.id}`, kind: 'investering-soort', tx })

  return items.filter((item) => !dismissed.has(item.key))
}

function runsOf<T extends { date: string }>(list: readonly T[], value: (item: T) => string): { from: string; to: string; value: string }[] {
  const out: { from: string; to: string; value: string }[] = []
  for (const item of list) {
    const v = value(item)
    const last = out.at(-1)
    if (last && last.value === v && last.to === addDays(item.date, -1)) last.to = item.date
    else out.push({ from: item.date, to: item.date, value: v })
  }
  return out
}

export function reviewInput(store: Reader): ReviewInput {
  return {
    trips: store.list('trips.json.enc'),
    removedTrips: store.get('trips.json.enc').filter((x) => x.deletedAt !== null),
    legs: store.list('legs.json.enc'),
    stays: store.list('periods.json.enc'),
    calendar: store.list('calendar.json.enc'),
    transactions: store.list('transactions.json.enc'),
    places: store.list('places.json.enc'),
    settings: currentSettings(store.list('settings.json.enc')),
    plans: store.list('plans.json.enc'),
    claims: store.list('claims.json.enc'),
    students: store.list('students.json.enc'),
    curricula: store.get('curricula.json.enc'),
  }
}

// ---------- Oplossen ----------

/** "Klopt zo": het punt komt niet meer terug. */
export async function dismissReview(store: Tx, item: ReviewItem): Promise<void> {
  const before = currentSettings(store.list('settings.json.enc')).reviewDismissed ?? []
  await saveSettings(store, { reviewDismissed: [...before.filter((k) => k !== item.key), item.key].slice(-500) })
}

function changed<T extends { updatedAt: string }>(record: T, patch: Partial<T>): T {
  return { ...record, ...patch, updatedAt: new Date().toISOString() }
}

/** Soort van een trip vastleggen (met het type dat oudere versies lezen). */
export function setTripKind(store: Tx, trip: Trip, type: WeekType): Promise<void> {
  const kind = kindForType(type)
  return applyChanges(store, [{ path: 'trips.json.enc', before: trip, after: changed(trip, { kind, type: typeForKind(kind, type) }) }])
}

export function setTripOrganisation(store: Tx, trip: Trip, organisation: Organisation): Promise<void> {
  return applyChanges(store, [{ path: 'trips.json.enc', before: trip, after: changed(trip, { organisation }) }])
}

/** Werkdagen zonder trip: één trip over die dagen (soort werk, nog zonder organisatie). */
export async function makeTripFor(store: Tx, from: string, to: string, lang: Lang): Promise<void> {
  const now = new Date().toISOString()
  const trip: Trip = { id: crypto.randomUUID(), name: defaultWeekName(from, lang), kind: 'werk', type: 'overig', startDate: from, endDate: to, updatedAt: now, deletedAt: null }
  await applyChanges(store, [{ path: 'trips.json.enc', before: null, after: trip }])
}

/** Dagen naar een trip (de datums van die trip veranderen niet). */
export async function moveLegsTo(store: Tx, legs: readonly Leg[], target: Trip): Promise<void> {
  const current = store.list('legs.json.enc')
  await applyChanges(store, legs.flatMap((leg) => {
    const now = current.find((l) => l.id === leg.id)
    return now ? [{ path: 'legs.json.enc' as const, before: now, after: changed(now, { tripId: target.id }) }] : []
  }))
}

/** Dagen zonder trip: een nieuwe trip van hun eerste tot hun laatste dag (met de naam van de verdwenen trip als die bekend is). */
export async function tripForLegs(store: Tx, legs: readonly Leg[], name: string): Promise<void> {
  const sorted = [...legs].sort(compareLegs)
  const trip: Trip = { id: crypto.randomUUID(), name, startDate: sorted[0]!.date, endDate: sorted.at(-1)!.date, updatedAt: store.now, deletedAt: null }
  await applyChanges(store, [{ path: 'trips.json.enc', before: null, after: trip }])
  await moveLegsTo(store, legs, trip)
}

/** Agendadagen zonder periode: een periode van die soort over die dagen. */
export function makeStayFor(store: Tx, kind: StayKind, from: string, to: string): Promise<void> {
  return setStayDays(store, rangeDates(from, to), kind)
}

/**
 * Inkomen of uitgave zonder periode: koppelen aan de periode van de datum; is er geen, dan een thuisperiode op die dag
 * (die een aangrenzende thuisperiode verlengt).
 */
export async function fixMoneyWithoutPeriod(store: Tx, tx: Transaction, target: Period | null): Promise<void> {
  if (target) return applyChanges(store, [{ path: 'transactions.json.enc', before: tx, after: changed(tx, { tripId: target.id }) }])
  await setStayDays(store, [tx.date], 'thuis')
  const periods = allPeriods(store.list('trips.json.enc'), store.list('legs.json.enc'), store.list('periods.json.enc'))
  const now = periodAt(periods, tx.date)
  const current = store.list('transactions.json.enc').find((x) => x.id === tx.id) ?? tx
  if (now) await applyChanges(store, [{ path: 'transactions.json.enc', before: current, after: changed(current, { tripId: now.id }) }])
}

/** Alle voorstellen voor de soort in één keer overnemen (één opdracht, dus één keer ongedaan maken). */
export async function acceptAllKinds(store: Tx, items: readonly ReviewItem[]): Promise<void> {
  for (const item of items) {
    if (item.kind !== 'soort') continue
    const current = store.list('trips.json.enc').find((x) => x.id === item.trip.id)
    if (current) await setTripKind(store, current, item.suggestion)
  }
}

/** Soort van een investering vastleggen (opleiding of uitrusting). */
export function setInvestmentCategory(store: Tx, tx: Transaction, category: 'opleiding' | 'uitrusting'): Promise<void> {
  return applyChanges(store, [{ path: 'transactions.json.enc', before: tx, after: changed(tx, { category }) }])
}
