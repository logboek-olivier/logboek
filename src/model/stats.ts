import type { Lang } from '../i18n'
import { boatKey, parseShip, suggestKind, tripShip } from './boats'
import { dayInfo, monthOf, tripRange, type CalendarIndex } from './calendar'
import { tripCounters, tripOrganisation } from './counters'
import { courseLabel, localized } from './curricula'
import { active, compareLegs, round1, totalNm, type WaterTotals } from './derive'
import { tipsPerCountry, tipsPerGuest, tipsPerTrip, tipsPerTripType, type GroupTips, type GuestTips } from './guests'
import { addDays, eurOf, isEarned, mondayOf, round2, tipsPerWeek, type WeekTips } from './money'
import { placeKey } from './places'
import { ROLES, type BoatKind, type CalendarDay, type Curriculum, type Leg, type Organisation, type Role, type Settings, type Student, type Transaction, type Trip } from './types'
import { dayCountOf, weekView } from './weeks'

// Statistieken (Meer → Statistieken): zeilen, werk, geld en instructeur over een periode, plus de voortgang naar RYA
// Yachtmaster Offshore. Alles afgeleid, niets opgeslagen; zonder netwerk.

export type PeriodKind = 'jaar' | 'seizoen' | 'alles' | 'eigen'

/** Een periode van dag tot en met dag (jjjj-mm-dd). */
export interface Period {
  from: string
  to: string
}

/** Een pauze van minstens vier weken zonder trip begint een nieuw seizoen. */
export const SEASON_GAP_DAYS = 28

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Dit seizoen begint bij de eerste trip na de laatste pauze van minstens vier weken zonder trip (tot vandaag). */
export function seasonStart(trips: readonly Trip[], legs: readonly Leg[], today: string): string | null {
  const ranges = active(trips)
    .map((t) => tripRange(t, legs))
    .filter((r): r is { start: string; end: string } => r !== null && r.start <= today)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  let start: string | null = null
  let end = ''
  for (const r of ranges) {
    if (start === null || r.start > addDays(end, SEASON_GAP_DAYS)) start = r.start
    if (r.end > end) end = r.end
  }
  return start
}

/** De eerste dag met gegevens (dag, trip of eigen agendadag), voor "Alles". */
export function firstDataDay(trips: readonly Trip[], legs: readonly Leg[], calendar: readonly CalendarDay[]): string | null {
  const days = [
    ...active(legs).map((l) => l.date),
    ...active(trips).map((t) => tripRange(t, legs)?.start ?? ''),
    ...active(calendar).map((c) => c.date),
  ].filter(isDate)
  return days.length > 0 ? days.reduce((a, b) => (a < b ? a : b)) : null
}

/** De periode bij een filter. Dit jaar, dit seizoen en alles lopen tot vandaag; een eigen periode zoals gekozen. */
export function periodFor(
  kind: PeriodKind,
  today: string,
  data: { trips: readonly Trip[]; legs: readonly Leg[]; calendar: readonly CalendarDay[] },
  custom?: Partial<Period>,
): Period | null {
  const yearStart = `${today.slice(0, 4)}-01-01`
  if (kind === 'jaar') return { from: yearStart, to: today }
  if (kind === 'seizoen') return { from: seasonStart(data.trips, data.legs, today) ?? yearStart, to: today }
  if (kind === 'alles') {
    const first = firstDataDay(data.trips, data.legs, data.calendar)
    return { from: first && first < today ? first : today, to: today }
  }
  if (!isDate(custom?.from) || !isDate(custom?.to) || custom.from > custom.to) return null
  return { from: custom.from, to: custom.to }
}

const inPeriod = (date: string, p: Period) => p.from <= date && date <= p.to

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = monthOf(from); m <= monthOf(to); ) {
    out.push(m)
    const y = Number(m.slice(0, 4))
    const n = Number(m.slice(5, 7))
    m = n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`
  }
  return out
}

// ---------- Zeilen ----------

export interface Row {
  key: string
  label: string
  value: number
}

export interface Bucket {
  /** jjjj-mm, of jjjj bij een lange periode. */
  key: string
  value: number
}

export interface OrgCount {
  org: Organisation | ''
  trips: number
  /** Teller van de laatste trip in de periode ("SV #4"), bij Sailing Virgins en Yacht Week. */
  last?: string
}

export interface SailingStats {
  nm: number
  days: number
  trips: number
  nightHours: number
  /** Per maand, of per jaar als de periode langer is dan twee jaar. */
  perMonth: Bucket[]
  byYear: boolean
  byRole: Record<Role, number>
  byWater: WaterTotals
  byBoat: Row[]
  byKind: Row[]
  byArea: Row[]
  longest: Leg | null
  topPlaces: Row[]
  perOrganisation: OrgCount[]
}

/** Langer dan twee jaar: per jaar in plaats van per maand, zodat de grafiek op 360 px leesbaar blijft. */
export const MAX_MONTH_BARS = 24

function addTo(map: Map<string, Row>, key: string, label: string, value: number) {
  const row = map.get(key) ?? { key, label, value: 0 }
  row.value += value
  map.set(key, row)
}

const sorted = (map: Map<string, Row>) => [...map.values()].map((r) => ({ ...r, value: round1(r.value) })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))

export function sailingStats(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, period: Period): SailingStats {
  const allLegs = active(legs)
  const live = allLegs.filter((l) => inPeriod(l.date, period)).sort(compareLegs)
  const tripById = new Map(active(trips).map((t) => [t.id, t]))
  const byRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>
  const byWater: WaterTotals = { inland: 0, sea: 0, tidal: 0 }
  const boats = new Map<string, Row>()
  const kinds = new Map<string, Row>()
  const areas = new Map<string, Row>()
  const places = new Map<string, Row & { names: Map<string, number> }>()
  const shipOf = new Map<string, { name: string; model: string; kind: BoatKind | undefined }>()
  let nm = 0
  let nightHours = 0
  let longest: Leg | null = null
  for (const leg of live) {
    const n = totalNm(leg)
    nm += n
    nightHours += leg.nightHours
    byRole[leg.role] += n
    byWater.inland += leg.nmInland
    byWater.sea += leg.nmSea
    byWater.tidal += leg.nmTidal
    if (!longest || n > totalNm(longest)) longest = leg
    const trip = tripById.get(leg.tripId)
    let ship = shipOf.get(leg.tripId)
    if (!ship) {
      const own = trip ? tripShip(trip, allLegs) : parseShip(leg.boat)
      ship = { ...own, kind: trip?.boatKind ?? suggestKind(own.model) }
      shipOf.set(leg.tripId, ship)
    }
    // Per boot zoals in Meer → Boten: de boot van de trip (opgeslagen, anders uit de dagen).
    if (ship.name || ship.model) addTo(boats, boatKey(ship.name, ship.model), ship.name || ship.model, n)
    addTo(kinds, ship.kind ?? 'onbekend', ship.kind ?? 'onbekend', n)
    addTo(areas, trip?.area?.trim().toLowerCase() ?? '', trip?.area?.trim() ?? '', n)
    // Meest bezochte plaatsen: aankomsten, zelfde plaats zonder hoofdletters, accenten en spaties.
    const key = placeKey(leg.toPlace)
    if (key) {
      const p = places.get(key) ?? { key, label: leg.toPlace.trim(), value: 0, names: new Map<string, number>() }
      p.value++
      p.names.set(leg.toPlace.trim(), (p.names.get(leg.toPlace.trim()) ?? 0) + 1)
      places.set(key, p)
    }
  }
  for (const r of ROLES) byRole[r] = round1(byRole[r])

  const months = live.length > 0 ? monthsBetween(period.from, period.to) : []
  const byYear = months.length > MAX_MONTH_BARS
  const buckets = new Map<string, number>()
  const keys = byYear ? [...new Set(months.map((m) => m.slice(0, 4)))] : months
  for (const k of keys) buckets.set(k, 0)
  for (const leg of live) {
    const k = byYear ? leg.date.slice(0, 4) : leg.date.slice(0, 7)
    buckets.set(k, (buckets.get(k) ?? 0) + totalNm(leg))
  }

  // Trips per organisatie: trips die in de periode beginnen.
  const counters = tripCounters(trips, legs, settings)
  const orgs = new Map<string, OrgCount & { lastN: number }>()
  for (const trip of active(trips)) {
    const range = tripRange(trip, allLegs)
    if (!range || !inPeriod(range.start, period)) continue
    const org: Organisation | '' = tripOrganisation(trip) ?? trip.organisation ?? ''
    const entry = orgs.get(org) ?? { org, trips: 0, lastN: 0 }
    entry.trips++
    const c = counters.get(trip.id)
    if (c && c.n > entry.lastN) {
      entry.lastN = c.n
      entry.last = c.label
    }
    orgs.set(org, entry)
  }

  return {
    nm: round1(nm),
    days: live.length,
    trips: new Set(live.map((l) => l.tripId)).size,
    nightHours: round1(nightHours),
    perMonth: [...buckets.entries()].map(([key, value]) => ({ key, value: round1(value) })),
    byYear,
    byRole,
    byWater: { inland: round1(byWater.inland), sea: round1(byWater.sea), tidal: round1(byWater.tidal) },
    byBoat: sorted(boats),
    byKind: sorted(kinds),
    byArea: sorted(areas),
    longest,
    topPlaces: [...places.values()]
      .map(({ names, ...p }) => ({ ...p, label: [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? p.label }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .slice(0, 5),
    perOrganisation: [...orgs.values()].map((o): OrgCount => ({ org: o.org, trips: o.trips, ...(o.last ? { last: o.last } : {}) })).sort((a, b) => b.trips - a.trips || (a.org === '' ? 1 : b.org === '' ? -1 : a.org.localeCompare(b.org))),
  }
}

// ---------- RYA Yachtmaster Offshore ----------

export type RyaItemId = 'dagen' | 'mijlen' | 'schipper' | 'passages' | 'nacht' | 'passagesSchipper' | 'getij'

export interface RyaItem {
  id: RyaItemId
  value: number
  target: number
  done: boolean
}

/** Een passage telt vanaf meer dan 60 nm op zee op één dag. */
export const PASSAGE_NM = 60

/**
 * Voortgang naar RYA Yachtmaster Offshore over alle dagen: 50 dagen op zee, 2.500 nm op zee, 5 dagen als schipper,
 * 5 passages van meer dan 60 nm waarvan 2 's nachts en 2 als schipper, minstens de helft in getijdenwater. Op zee =
 * zee plus getijdenwater (binnenwater telt niet). Een benadering uit het logboek; de app vermeldt dat Olivier de
 * actuele eisen van de RYA controleert.
 */
export function ryaYachtmasterOffshore(legs: readonly Leg[]): RyaItem[] {
  const sea = active(legs).filter((l) => l.nmSea + l.nmTidal > 0)
  const seaNm = sea.reduce((n, l) => n + l.nmSea + l.nmTidal, 0)
  const tidalNm = sea.reduce((n, l) => n + l.nmTidal, 0)
  const passages = sea.filter((l) => l.nmSea + l.nmTidal > PASSAGE_NM)
  const item = (id: RyaItemId, value: number, target: number): RyaItem => ({ id, value, target, done: value >= target })
  return [
    item('dagen', new Set(sea.map((l) => l.date)).size, 50),
    item('mijlen', round1(seaNm), 2500),
    item('schipper', new Set(sea.filter((l) => l.role === 'schipper').map((l) => l.date)).size, 5),
    item('passages', passages.length, 5),
    item('nacht', passages.filter((l) => l.nightHours > 0).length, 2),
    item('passagesSchipper', passages.filter((l) => l.role === 'schipper').length, 2),
    item('getij', seaNm > 0 ? Math.round((tidalNm / seaNm) * 100) : 0, 50),
  ]
}

// ---------- Werk ----------

export interface WorkMonth {
  month: string
  werk: number
  rust: number
  reis: number
  thuis: number
  /** Bezet zonder werk (telt niet als werk, wel als bezet). */
  onbeschikbaar: number
  /** Dagen van deze maand binnen de periode. */
  days: number
}

export interface WorkStats {
  months: WorkMonth[]
  werk: number
  rust: number
  reis: number
  thuis: number
  onbeschikbaar: number
  days: number
  /** Aandeel werkdagen van alle dagen in de periode (0–1), of null zonder dagen. */
  share: number | null
}

/** Werk-, rust-, reis- en thuisdagen per maand uit de agenda (ook afgeleid uit trips en dagen). */
export function workStats(index: CalendarIndex, period: Period, today: string): WorkStats {
  const months = new Map<string, WorkMonth>()
  const sum = { werk: 0, rust: 0, reis: 0, thuis: 0, onbeschikbaar: 0, days: 0 }
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const month = monthOf(d)
    const m = months.get(month) ?? { month, werk: 0, rust: 0, reis: 0, thuis: 0, onbeschikbaar: 0, days: 0 }
    const type = dayInfo(index, d, today).type
    m.days++
    sum.days++
    if (type === 'werk' || type === 'rust' || type === 'reis' || type === 'thuis' || type === 'onbeschikbaar') {
      m[type]++
      sum[type]++
    }
    months.set(month, m)
  }
  return { months: [...months.values()], ...sum, share: sum.days > 0 ? sum.werk / sum.days : null }
}

// ---------- Geld ----------

export interface TripMoney {
  trip: Trip
  eur: number
  days: number
  perDay: number | null
}

export interface MoneyStats {
  /** Verdiend per trip (zonder terugbetalingen), meeste eerst. */
  perTrip: TripMoney[]
  perOrganisation: { org: Organisation | ''; eur: number }[]
  /** Verdiend zonder trip. */
  withoutTrip: number
  earned: number
  workdays: number
  perWorkday: number | null
  tipsPerWeek: WeekTips[]
  perGuest: GuestTips[]
  perCountry: GroupTips[]
  perTripType: GroupTips[]
  /** Beste en slechtste trip, per dag (alleen als er minstens twee trips met inkomsten zijn). */
  best: TripMoney | null
  worst: TripMoney | null
}

/** Fooi per week: hoogstens het laatste half jaar van de periode. */
export const MAX_TIP_WEEKS = 26

export function moneyStats(trips: readonly Trip[], legs: readonly Leg[], transactions: readonly Transaction[], index: CalendarIndex, period: Period, today: string): MoneyStats {
  const txs = active(transactions).filter((tx) => inPeriod(tx.date, period))
  const tripById = new Map(active(trips).map((t) => [t.id, t]))
  const perTrip = new Map<string, number>()
  const perOrg = new Map<string, number>()
  let withoutTrip = 0
  let earned = 0
  for (const tx of txs) {
    if (!isEarned(tx.kind)) continue
    const eur = eurOf(tx)
    if (eur === null) continue
    earned += eur
    const trip = tx.tripId ? tripById.get(tx.tripId) : undefined
    if (!trip) {
      withoutTrip += eur
      continue
    }
    perTrip.set(trip.id, (perTrip.get(trip.id) ?? 0) + eur)
    const org = tripOrganisation(trip) ?? trip.organisation ?? ''
    perOrg.set(org, (perOrg.get(org) ?? 0) + eur)
  }
  const tripMoney: TripMoney[] = [...perTrip.entries()]
    .map(([id, eur]) => {
      const trip = tripById.get(id)!
      const days = dayCountOf(weekView(trip, legs))
      return { trip, eur: round2(eur), days, perDay: days > 0 ? round2(eur / days) : null }
    })
    .sort((a, b) => b.eur - a.eur)
  const ranked = tripMoney.filter((t) => t.perDay !== null).sort((a, b) => b.perDay! - a.perDay!)
  let workdays = 0
  for (let d = period.from; d <= period.to && d <= today; d = addDays(d, 1)) if (dayInfo(index, d, today).type === 'werk') workdays++
  const end = period.to < today ? period.to : today
  const weeks = Math.min(MAX_TIP_WEEKS, Math.max(1, Math.floor((Date.parse(mondayOf(end)) - Date.parse(mondayOf(period.from))) / (7 * 86_400_000)) + 1))
  return {
    perTrip: tripMoney,
    perOrganisation: [...perOrg.entries()].map(([org, eur]) => ({ org: org as Organisation | '', eur: round2(eur) })).sort((a, b) => b.eur - a.eur),
    withoutTrip: round2(withoutTrip),
    earned: round2(earned),
    workdays,
    perWorkday: workdays > 0 ? round2(earned / workdays) : null,
    tipsPerWeek: tipsPerWeek(txs, end, weeks),
    perGuest: tipsPerGuest(trips, txs),
    perCountry: tipsPerCountry(trips, txs),
    perTripType: tipsPerTripType(tipsPerTrip(trips, txs, legs)),
    best: ranked.length >= 2 ? ranked[0]! : null,
    worst: ranked.length >= 2 ? ranked[ranked.length - 1]! : null,
  }
}

// ---------- Instructeur ----------

export interface CourseResult {
  curriculumId: string
  label: string
  students: number
  exams: number
  passed: number
  /** Slagingspercentage (0–1), of null zonder examens. */
  rate: number | null
}

export interface InstructorStats {
  students: number
  perCourse: CourseResult[]
  /** Meest geoefende onderwerpen: aantal studenten met geoefend of beheerst in de periode. */
  topTopics: Row[]
}

/** Studenten in de periode: begonnen, examen of voortgang in de periode (ook gearchiveerde, nooit gewiste). */
export function instructorStats(students: readonly Student[], curricula: readonly Curriculum[], trips: readonly Trip[], legs: readonly Leg[], period: Period, lang: Lang): InstructorStats {
  const live = students.filter((s) => s.deletedAt === null)
  const tripById = new Map(active(trips).map((t) => [t.id, t]))
  const curriculumById = new Map(curricula.map((c) => [c.id, c]))
  const topicTitle = new Map<string, string>()
  for (const c of curricula) for (const g of c.groups) for (const topic of g.topics) topicTitle.set(`${c.id}|${topic.id}`, localized(topic.title, lang))
  const courses = new Map<string, CourseResult>()
  const topics = new Map<string, Row>()
  let count = 0
  for (const s of live) {
    const trip = s.weekId ? tripById.get(s.weekId) : undefined
    const start = s.startedAt ?? (trip ? tripRange(trip, legs)?.start : undefined)
    const progress = Object.entries(s.progress ?? {}).filter(([, p]) => (p.status === 'geoefend' || p.status === 'beheerst') && inPeriod(p.updatedAt.slice(0, 10), period))
    const exam = s.exam && isDate(s.exam.date) && inPeriod(s.exam.date, period) ? s.exam : null
    if (!(start && inPeriod(start, period)) && !exam && progress.length === 0) continue
    count++
    const curriculum = curriculumById.get(s.curriculumId)
    const course = courses.get(s.curriculumId) ?? { curriculumId: s.curriculumId, label: curriculum ? courseLabel(curriculum, lang) : '', students: 0, exams: 0, passed: 0, rate: null }
    course.students++
    if (exam) {
      course.exams++
      if (exam.passed) course.passed++
    }
    courses.set(s.curriculumId, course)
    for (const [topicId] of progress) {
      const key = `${s.curriculumId}|${topicId}`
      const title = topicTitle.get(key)
      if (title) addTo(topics, key, title, 1)
    }
  }
  return {
    students: count,
    perCourse: [...courses.values()].map((c) => ({ ...c, rate: c.exams > 0 ? c.passed / c.exams : null })).sort((a, b) => b.students - a.students || a.label.localeCompare(b.label)),
    topTopics: sorted(topics).slice(0, 5),
  }
}
