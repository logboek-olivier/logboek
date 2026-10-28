import type { Store } from '../storage/store'
import { active, round1, totalNm } from './derive'
import { addDays } from './money'
import { weekView, type WeekView } from './weeks'
import { todayIso, type CalendarDay, type DayTravel, type DayType, type Leg, type Reminder, type Trip } from './types'

// Agenda: elke dag heeft één dagsoort. Opgeslagen (calendar.json.enc) worden alleen dagen die Olivier zelf instelt;
// de rest volgt uit trips en dagen, met deze voorrang:
//   1. eigen instelling;
//   2. binnen een trip (eerste tot en met laatste dag, ook als er alleen gasten worden afgezet of opgehaald): werk;
//   3. een dag met een gelogde etappe: werk;
//   4. een korte pauze tussen twee trips (hoogstens twee dagen): rust;
//   5. toekomst zonder iets: beschikbaar;
//   6. verleden zonder iets: leeg.
// Trips zonder datums krijgen die uit hun dagen (weekView), dus ook geïmporteerde tochten staan er vanzelf in.

/** Zoveel dagen tussen twee trips gelden vanzelf als rust (geen aparte wisseldag). */
export const REST_GAP_DAYS = 2

export type DaySource = 'eigen' | 'trip' | 'etappe' | 'tussen' | 'toekomst'

export interface DayInfo {
  date: string
  /** null = verleden zonder iets (leeg). */
  type: DayType | null
  source: DaySource | null
  own: CalendarDay | null
  /** Trips waarin de dag valt (op een wisseldag kunnen dat er twee zijn), eerst begonnen eerst. */
  trips: WeekView[]
  legs: Leg[]
  nm: number
  /** Boot van de dag: eigen instelling, anders van de trip, anders van de gelogde dag. */
  boat: string
  reminders: Reminder[]
}

export interface CalendarIndex {
  own: Map<string, CalendarDay>
  views: WeekView[]
  legsByDate: Map<string, Leg[]>
  remindersByDate: Map<string, Reminder[]>
  /** Einddatums en startdatums van trips, gesorteerd, voor de rust tussen twee trips. */
  ends: string[]
  starts: string[]
}

export function calendarId(date: string): string {
  return `dag:${date}`
}

export function buildIndex(calendar: readonly CalendarDay[], trips: readonly Trip[], legs: readonly Leg[], reminders: readonly Reminder[] = []): CalendarIndex {
  const own = new Map(active(calendar).map((d) => [d.date, d]))
  const views = active(trips)
    .map((t) => weekView(t, legs))
    .filter((v) => isDate(v.startDate) && isDate(v.endDate) && v.startDate <= v.endDate)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
  const legsByDate = new Map<string, Leg[]>()
  for (const leg of active(legs)) {
    const list = legsByDate.get(leg.date)
    if (list) list.push(leg)
    else legsByDate.set(leg.date, [leg])
  }
  const remindersByDate = new Map<string, Reminder[]>()
  for (const r of active(reminders)) {
    if (r.doneAt) continue
    const list = remindersByDate.get(r.date)
    if (list) list.push(r)
    else remindersByDate.set(r.date, [r])
  }
  return {
    own,
    views,
    legsByDate,
    remindersByDate,
    ends: views.map((v) => v.endDate).sort(),
    starts: views.map((v) => v.startDate).sort(),
  }
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Laatste einddatum vóór `date` en eerste startdatum na `date`. */
function neighbours(index: CalendarIndex, date: string): { prevEnd: string | null; nextStart: string | null } {
  let prevEnd: string | null = null
  for (const e of index.ends) {
    if (e < date) prevEnd = e
    else break
  }
  const nextStart = index.starts.find((s) => s > date) ?? null
  return { prevEnd, nextStart }
}

export function dayInfo(index: CalendarIndex, date: string, today: string = todayIso()): DayInfo {
  const own = index.own.get(date) ?? null
  const trips = index.views.filter((v) => v.startDate <= date && date <= v.endDate)
  const legs = index.legsByDate.get(date) ?? []
  const nm = round1(legs.reduce((n, l) => n + totalNm(l), 0))
  const boat = own?.boat || trips.at(-1)?.boat || legs.at(-1)?.boat || ''
  const reminders = index.remindersByDate.get(date) ?? []
  const base = { date, own, trips, legs, nm, boat, reminders }
  if (own) return { ...base, type: own.type, source: 'eigen' }
  if (trips.length > 0) return { ...base, type: 'werk', source: 'trip' }
  if (legs.length > 0) return { ...base, type: 'werk', source: 'etappe' }
  const { prevEnd, nextStart } = neighbours(index, date)
  if (prevEnd && nextStart && daysBetween(prevEnd, nextStart) - 1 <= REST_GAP_DAYS) return { ...base, type: 'rust', source: 'tussen' }
  if (date >= today) return { ...base, type: 'beschikbaar', source: 'toekomst' }
  return { ...base, type: null, source: null }
}

// ---------- Maandoverzicht ----------

/** "jjjj-mm" van een datum. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

/** Weken (maandag eerst) die de maand bedekken, met de dagen van de buurmaanden aan de randen. */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  let day = addDays(first, -weekday)
  const weeks: string[][] = []
  while (weeks.length === 0 || monthOf(day) === month) {
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      week.push(day)
      day = addDays(day, 1)
    }
    weeks.push(week)
  }
  return weeks
}

export interface TripBar {
  view: WeekView
  /** Kolommen 0–6 binnen de week. */
  from: number
  to: number
  /** Rij binnen de week, voor trips die elkaar raken (wisseldag). */
  lane: number
  /** De trip begint in deze week (naam tonen) of loopt door uit de vorige. */
  starts: boolean
}

/** Balken met de tripnaam over de dagen van elke trip in deze week. */
export function tripBars(index: CalendarIndex, week: readonly string[]): TripBar[] {
  const first = week[0]!
  const last = week[week.length - 1]!
  const bars: TripBar[] = []
  const laneEnds: number[] = []
  for (const view of index.views) {
    if (view.endDate < first || view.startDate > last) continue
    const from = view.startDate < first ? 0 : week.indexOf(view.startDate)
    const to = view.endDate > last ? week.length - 1 : week.indexOf(view.endDate)
    let lane = laneEnds.findIndex((end) => end < from)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = to
    bars.push({ view, from, to, lane, starts: view.startDate >= first })
  }
  return bars
}

export interface MonthSummary {
  werk: number
  rust: number
  reis: number
  thuis: number
  nm: number
}

export function monthSummary(index: CalendarIndex, month: string, today: string = todayIso()): MonthSummary {
  const sum: MonthSummary = { werk: 0, rust: 0, reis: 0, thuis: 0, nm: 0 }
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) {
    const info = dayInfo(index, d, today)
    if (info.type === 'werk' || info.type === 'rust' || info.type === 'reis' || info.type === 'thuis') sum[info.type]++
    sum.nm += info.nm
  }
  sum.nm = round1(sum.nm)
  return sum
}

// ---------- Opslaan ----------

export interface DayDetails {
  location?: string
  travel?: DayTravel
  boat?: string
  note?: string
}

const text = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max)

function cleanDetails(details: DayDetails): DayDetails {
  const location = text(details.location, 80)
  const boat = text(details.boat, 80)
  const note = text(details.note, 500)
  const from = text(details.travel?.from, 80)
  const to = text(details.travel?.to, 80)
  const flight = text(details.travel?.flight, 40)
  return {
    ...(location ? { location } : {}),
    ...(boat ? { boat } : {}),
    ...(note ? { note } : {}),
    ...(from || to || flight ? { travel: { from, to, ...(flight ? { flight } : {}) } } : {}),
  }
}

/** Dagsoort en gegevens van een dag zelf instellen (overschrijft wat uit trips en dagen volgt). */
export async function setDay(store: Store, date: string, type: DayType, details: DayDetails = {}): Promise<CalendarDay> {
  const record: CalendarDay = { id: calendarId(date), date, type, ...cleanDetails(details), updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('calendar.json.enc', record)
  void store.sync()
  return record
}

/** Terug naar automatisch: de eigen instelling vervalt (tombstone); de dag volgt weer uit trips en dagen. */
export async function clearDay(store: Store, date: string): Promise<void> {
  await store.remove('calendar.json.enc', calendarId(date))
  void store.sync()
}

/** Een periode in één keer dezelfde dagsoort geven (periode markeren); bestaande gegevens van die dagen blijven. */
export async function setDays(store: Store, dates: readonly string[], type: DayType): Promise<void> {
  const now = new Date().toISOString()
  const existing = new Map(store.list('calendar.json.enc').map((d) => [d.date, d]))
  const records: CalendarDay[] = dates.map((date) => {
    const old = existing.get(date)
    return { ...(old ?? {}), id: calendarId(date), date, type, updatedAt: now, deletedAt: null }
  })
  if (records.length > 0) await store.putMany('calendar.json.enc', records)
  void store.sync()
}

/** Alle datums van `from` tot en met `to`. */
export function datesBetween(from: string, to: string): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from]
  const out: string[] = []
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d)
  return out
}

/** Maandag van de week van `date`. */
export function weekStart(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(date, -weekday)
}

/** Laatste geplande dag: einde van de laatste trip of de laatste zelf ingestelde dag. */
export function planningEnd(index: CalendarIndex): string | null {
  const ends = [...index.views.map((v) => v.endDate), ...index.own.keys()]
  return ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : null
}

// ---------- Seizoensoverzicht ----------

export type SeasonItem =
  | { kind: 'trip'; view: WeekView }
  | { kind: 'days'; type: DayType; from: string; to: string; travel?: DayTravel }

export interface SeasonWeek {
  start: string
  end: string
  items: SeasonItem[]
}

/**
 * Eén regel per week (maandag tot en met zondag): de trips die in die week vallen, en de andere dagsoorten als
 * aaneengesloten stukken ("Beschikbaar: 3–5 mrt"). Werkdagen binnen een trip staan bij die trip; lege dagen in het
 * verleden niet.
 */
export function seasonWeeks(index: CalendarIndex, from: string, to: string, today: string = todayIso()): SeasonWeek[] {
  const weeks: SeasonWeek[] = []
  for (let start = weekStart(from); start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6)
    const items: SeasonItem[] = []
    const seen = new Set<string>()
    let run: Extract<SeasonItem, { kind: 'days' }> | null = null
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const info = dayInfo(index, d, today)
      const inTrip = info.type === 'werk' && info.source !== 'eigen' && info.trips.length > 0
      if (inTrip) {
        run = null
        for (const v of info.trips) {
          if (seen.has(v.trip.id)) continue
          seen.add(v.trip.id)
          items.push({ kind: 'trip', view: v })
        }
        continue
      }
      if (!info.type) {
        run = null
        continue
      }
      const travel = info.type === 'reis' ? info.own?.travel : undefined
      if (run && run.type === info.type && !travel && !run.travel && run.to === addDays(d, -1)) run.to = d
      else {
        run = { kind: 'days', type: info.type, from: d, to: d, ...(travel ? { travel } : {}) }
        items.push(run)
      }
    }
    weeks.push({ start, end, items })
  }
  return weeks
}

// ---------- Delen ----------

export type Availability = 'beschikbaar' | 'bezet' | 'optie'

export interface Run<T> {
  from: string
  to: string
  value: T
}

/** Aaneengesloten stukken met dezelfde waarde; `null` breekt een stuk af en wordt weggelaten. */
function runs<T>(from: string, to: string, valueOf: (date: string) => T | null, same: (a: T, b: T) => boolean): Run<T>[] {
  const out: Run<T>[] = []
  for (const d of datesBetween(from, to)) {
    const value = valueOf(d)
    const last = out.at(-1)
    if (value === null) continue
    if (last && last.to === addDays(d, -1) && same(last.value, value)) last.to = d
    else out.push({ from: d, to: d, value })
  }
  return out
}

/** Alleen beschikbaarheid: beschikbaar, bezet of optie. Geen namen, boten of bedragen. */
export function availabilityRuns(index: CalendarIndex, from: string, to: string, today: string = todayIso()): Run<Availability>[] {
  return runs(
    from,
    to,
    (d) => {
      const type = dayInfo(index, d, today).type
      if (type === 'beschikbaar' || (type === null && d >= today)) return 'beschikbaar'
      if (type === 'optie') return 'optie'
      return type === null ? null : 'bezet'
    },
    (a, b) => a === b,
  )
}

export interface PlanEntry {
  type: DayType
  /** Bij werk binnen een trip: naam, type en gebied van de trip (nooit deelnemers of bedragen). */
  trip?: { id: string; name: string; tripType: WeekView['type']; area?: string }
  /** Bij reis: van en naar (geen vlucht). */
  travel?: { from: string; to: string }
}

/** Volledige planning: trips met gebied, reisdagen en de andere dagsoorten. Geen bedragen, gastnamen of notities. */
export function planningRuns(index: CalendarIndex, from: string, to: string, today: string = todayIso()): Run<PlanEntry>[] {
  return runs(
    from,
    to,
    (d) => {
      const info = dayInfo(index, d, today)
      if (!info.type) return null
      const view = info.type === 'werk' ? info.trips.at(-1) : undefined
      return {
        type: info.type,
        ...(view ? { trip: { id: view.trip.id, name: view.trip.name, tripType: view.type, ...(view.trip.area ? { area: view.trip.area } : {}) } } : {}),
        ...(info.type === 'reis' && info.own?.travel ? { travel: { from: info.own.travel.from, to: info.own.travel.to } } : {}),
      }
    },
    (a, b) => a.type === b.type && a.trip?.id === b.trip?.id && a.travel?.from === b.travel?.from && a.travel?.to === b.travel?.to,
  )
}
