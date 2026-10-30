import type { Store } from '../storage/store'
import { active, lastMonths, round1, totalNm } from './derive'
import { addDays, round2, totals } from './money'
import { weekView, type WeekView } from './weeks'
import { setStayDays } from './periods'
import { keepUnknownFields, todayIso, type CalendarDay, type DayTravel, type DayType, type Leg, type PeriodKind, type Reminder, type StayKind, type StayPeriod, type Transaction, type Trip } from './types'

// Agenda: elke dag heeft één dagsoort, die volgt uit de periode van die dag (docs/PERIODEMODEL.md), met deze voorrang:
//   1. binnen een trip (eerste tot en met laatste dag, ook als er alleen gasten worden afgezet of opgehaald): op het
//      water ('werk'; de soort werk, training of plezier staat in `kind`);
//   2. binnen een periode aan land: reis, thuis of vrij ('rust');
//   3. een zelf ingestelde dagtoestand (beschikbaar, optie, onbeschikbaar; van oudere versies ook andere soorten);
//   4. een dag met een gelogde etappe: op het water;
//   5. een korte pauze tussen twee trips (hoogstens twee dagen): vrij;
//   6. toekomst zonder iets: beschikbaar;
//   7. verleden zonder iets: leeg.
// Opgeslagen in calendar.json.enc worden alleen dagen die Olivier zelf instelt (dagtoestand, of gegevens van een dag
// zoals een notitie). Trips zonder datums krijgen die uit hun dagen (weekView), dus ook geïmporteerde tochten staan er
// vanzelf in.

/** Zoveel dagen tussen twee trips gelden vanzelf als rust (geen aparte wisseldag). */
export const REST_GAP_DAYS = 2

export type DaySource = 'eigen' | 'trip' | 'periode' | 'etappe' | 'tussen' | 'toekomst'

/** Dagsoort van een periode aan land (vrij heet in de data nog 'rust'). */
export const DAY_OF_STAY: Record<StayKind, DayType> = { reis: 'reis', thuis: 'thuis', vrij: 'rust' }

export interface DayInfo {
  date: string
  /** null = verleden zonder iets (leeg). */
  type: DayType | null
  source: DaySource | null
  own: CalendarDay | null
  /** Soort periode van de dag (werk, training, plezier, reis, thuis, vrij), of null zonder periode. */
  kind: PeriodKind | null
  /** De periode aan land van de dag. */
  stay: StayPeriod | null
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
  /** Periodes aan land, op begindatum. */
  stays: StayPeriod[]
  /** Einddatums en startdatums van trips, gesorteerd, voor de rust tussen twee trips. */
  ends: string[]
  starts: string[]
}

export function calendarId(date: string): string {
  return `dag:${date}`
}

export function buildIndex(calendar: readonly CalendarDay[], trips: readonly Trip[], legs: readonly Leg[], reminders: readonly Reminder[] = [], stays: readonly StayPeriod[] = []): CalendarIndex {
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
    stays: active(stays)
      .filter((st) => isDate(st.startDate) && isDate(st.endDate) && st.startDate <= st.endDate)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1)),
    ends: views.map((v) => v.endDate).sort(),
    starts: views.map((v) => v.startDate).sort(),
  }
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function daysBetween(a: string, b: string): number {
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
  const stay = trips.length > 0 ? null : (index.stays.find((st) => st.startDate <= date && date <= st.endDate) ?? null)
  const base = { date, own, trips, legs, nm, boat, reminders, stay, kind: null }
  if (trips.length > 0) return { ...base, kind: trips.at(-1)!.kind, type: 'werk', source: 'trip' }
  if (stay) return { ...base, kind: stay.kind, type: DAY_OF_STAY[stay.kind], source: 'periode' }
  if (own) return { ...base, type: own.type, source: 'eigen' }
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
  onbeschikbaar: number
  nm: number
}

export function monthSummary(index: CalendarIndex, month: string, today: string = todayIso()): MonthSummary {
  const sum: MonthSummary = { werk: 0, rust: 0, reis: 0, thuis: 0, onbeschikbaar: 0, nm: 0 }
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) {
    const info = dayInfo(index, d, today)
    if (info.type === 'werk' || info.type === 'rust' || info.type === 'reis' || info.type === 'thuis' || info.type === 'onbeschikbaar') sum[info.type]++
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
  reason?: string
}

const text = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max)

function cleanDetails(details: DayDetails): DayDetails {
  const location = text(details.location, 80)
  const boat = text(details.boat, 80)
  const note = text(details.note, 500)
  const reason = text(details.reason, 200)
  const from = text(details.travel?.from, 80)
  const to = text(details.travel?.to, 80)
  const flight = text(details.travel?.flight, 40)
  return {
    ...(location ? { location } : {}),
    ...(boat ? { boat } : {}),
    ...(note ? { note } : {}),
    ...(reason ? { reason } : {}),
    ...(from || to || flight ? { travel: { from, to, ...(flight ? { flight } : {}) } } : {}),
  }
}

/** Dagsoort en gegevens van een dag zelf instellen (overschrijft wat uit trips en dagen volgt). */
/** De velden van een agendadag die deze versie kent (de rest blijft bij bewerken staan, zie keepUnknownFields). */
const DAY_FIELDS = ['id', 'date', 'type', 'location', 'travel', 'boat', 'note', 'reason', 'updatedAt', 'deletedAt'] as const

export async function setDay(store: Store, date: string, type: DayType, details: DayDetails = {}): Promise<CalendarDay> {
  const previous = store.get('calendar.json.enc').find((d) => d.id === calendarId(date))
  const record = keepUnknownFields<CalendarDay>(previous, { id: calendarId(date), date, type, ...cleanDetails(details), updatedAt: new Date().toISOString(), deletedAt: null }, DAY_FIELDS)
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
      const travel = info.type === 'reis' ? stayTravel(info) : undefined
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

/** Van en naar van een reisdag: de dag zelf, anders de reisperiode. */
export function stayTravel(info: Pick<DayInfo, 'own' | 'stay'>): DayTravel | undefined {
  if (info.own?.travel && (info.own.travel.from || info.own.travel.to)) return info.own.travel
  const tr = info.stay?.travel
  return tr && (tr.from || tr.to) ? { from: tr.from ?? '', to: tr.to ?? '' } : undefined
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
        ...(info.type === 'reis' && stayTravel(info) ? { travel: { from: stayTravel(info)!.from, to: stayTravel(info)!.to } } : {}),
      }
    },
    (a, b) => a.type === b.type && a.trip?.id === b.trip?.id && a.travel?.from === b.travel?.from && a.travel?.to === b.travel?.to,
  )
}

// ---------- Trip en agenda gelijk houden ----------

export interface DateRange {
  start: string
  end: string
}

/** Eerste en laatste dag van een trip (ook afgeleid uit de dagen), of null zonder geldige datums. */
export function tripRange(trip: Trip, legs: readonly Leg[]): DateRange | null {
  const view = weekView(trip, legs)
  return isDate(view.startDate) && isDate(view.endDate) && view.startDate <= view.endDate ? { start: view.startDate, end: view.endDate } : null
}

function hasDetails(day: CalendarDay): boolean {
  return !!(day.note || day.location || day.travel?.from || day.travel?.to || day.travel?.flight)
}

const within = (range: DateRange | null, date: string) => !!range && range.start <= date && date <= range.end

/**
 * Een trip maken, verlengen of verplaatsen werkt de agenda direct bij. Op dagen die er nieuw bij komen, maakt een zelf
 * ingestelde andere dagsoort plaats voor de trip (met een notitie, plaats of reisgegevens blijft de dag als werk
 * staan, zodat er niets verloren gaat). Op dagen die eraf gaan, vervalt een zelf ingestelde werkdag zonder gegevens
 * (bijvoorbeeld alleen een andere boot), tenzij een andere trip die dag nog dekt.
 */
export async function followTrip(store: Store, tripId: string, before: DateRange | null, after: DateRange | null): Promise<void> {
  if (before && after && before.start === after.start && before.end === after.end) return
  const legs = store.list('legs.json.enc')
  const others = store
    .list('trips.json.enc')
    .filter((t) => t.id !== tripId)
    .map((t) => tripRange(t, legs))
    .filter((r): r is DateRange => r !== null)
  const now = new Date().toISOString()
  const changed: CalendarDay[] = []
  for (const day of store.list('calendar.json.enc')) {
    const added = within(after, day.date) && !within(before, day.date)
    const dropped = within(before, day.date) && !within(after, day.date)
    if (added) {
      if (day.type !== 'werk' && hasDetails(day)) changed.push({ ...day, type: 'werk', updatedAt: now })
      else if (day.type !== 'werk' || !day.boat) changed.push({ ...day, updatedAt: now, deletedAt: now })
    } else if (dropped && day.type === 'werk' && !hasDetails(day) && !others.some((r) => within(r, day.date))) {
      changed.push({ ...day, updatedAt: now, deletedAt: now })
    }
  }
  if (changed.length > 0) await store.putMany('calendar.json.enc', changed)
  // Water gaat voor land: dagen die er nieuw bij komen, gaan uit hun periode aan land (geld op die datum gaat mee
  // naar de trip).
  if (after) {
    const added: string[] = []
    for (let d = after.start; d <= after.end && added.length <= 400; d = addDays(d, 1)) if (!within(before, d)) added.push(d)
    if (added.length > 0 && store.list('periods.json.enc').some((st) => st.startDate <= after.end && st.endDate >= after.start)) await setStayDays(store, added, null, {}, false)
  }
}

/** Trips die met werk op `from`–`to` langer kunnen worden: eindigen hoogstens 3 dagen ervoor of beginnen hoogstens 3 dagen erna. */
export const EXTEND_GAP_DAYS = 3

export interface TripResize {
  view: WeekView
  start: string
  end: string
}

export function extendOptions(index: CalendarIndex, from: string, to: string): TripResize[] {
  const out: TripResize[] = []
  for (const view of index.views) {
    if (view.startDate <= to && from <= view.endDate) continue
    if (view.endDate < from && daysBetween(view.endDate, from) <= EXTEND_GAP_DAYS + 1) out.push({ view, start: view.startDate, end: to })
    else if (view.startDate > to && daysBetween(to, view.startDate) <= EXTEND_GAP_DAYS + 1) out.push({ view, start: from, end: view.endDate })
  }
  return out
}

/**
 * Een andere dagsoort op de eerste of laatste dag van een trip: de trip wordt een dag korter (de eerste en laatste dag
 * van een trip zijn altijd werk). Niet bij een trip van één dag of als die dag een gelogde etappe van de trip heeft.
 */
export function shrinkFor(index: CalendarIndex, date: string, type: DayType): TripResize | null {
  if (type === 'werk') return null
  const legs = index.legsByDate.get(date) ?? []
  for (const view of index.views) {
    if (view.startDate === view.endDate || legs.some((l) => l.tripId === view.trip.id)) continue
    if (view.endDate === date) return { view, start: view.startDate, end: addDays(date, -1) }
    if (view.startDate === date) return { view, start: addDays(date, 1), end: view.endDate }
  }
  return null
}

/** Trip verlengen of inkorten vanuit de agenda; geeft ongedaan maken terug. */
export async function resizeTrip(store: Store, change: TripResize): Promise<() => Promise<void>> {
  const before = store.list('trips.json.enc').find((t) => t.id === change.view.trip.id) ?? change.view.trip
  const legs = store.list('legs.json.enc')
  const oldRange = tripRange(before, legs)
  const calendarBefore = store.list('calendar.json.enc')
  // Verlengen of inkorten in de agenda is zelf de datums kiezen: die volgen de dagen daarna niet meer.
  const { datesFromDays: _follows, ...fixed } = before
  void _follows
  const next: Trip = { ...fixed, startDate: change.start, endDate: change.end, updatedAt: new Date().toISOString() }
  await store.put('trips.json.enc', next)
  await followTrip(store, before.id, oldRange, { start: change.start, end: change.end })
  void store.sync()
  return async () => {
    const now = new Date().toISOString()
    await store.put('trips.json.enc', { ...before, updatedAt: now })
    // Dagen die het verlengen of inkorten wegnam, komen terug.
    const current = new Map(store.get('calendar.json.enc').map((d) => [d.id, d]))
    const restore = calendarBefore.filter((d) => {
      const c = current.get(d.id)
      return !c || c.deletedAt !== null || c.type !== d.type
    })
    if (restore.length > 0) await store.putMany('calendar.json.enc', restore.map((d) => ({ ...d, updatedAt: now })))
    void store.sync()
  }
}

// ---------- Geld per werkdag ----------

/** Een werkdag: op het water in een trip van soort werk (training en plezier niet), of een gelogde dag zonder trip. */
export function isWorkday(info: Pick<DayInfo, 'type' | 'kind'>): boolean {
  return info.type === 'werk' && (info.kind === null || info.kind === 'werk')
}

export interface WorkdayIncome {
  month: string
  /** Werkdagen in de agenda tot en met vandaag. */
  workdays: number
  /** Verdiend in EUR (zonder terugbetalingen). */
  eur: number
  perWorkday: number | null
}

/** Inkomsten van een maand en per werkdag (werkdagen tot en met vandaag). */
export function monthIncome(index: CalendarIndex, transactions: readonly Transaction[], month: string, today: string = todayIso()): WorkdayIncome {
  let workdays = 0
  for (let d = `${month}-01`; monthOf(d) === month && d <= today; d = addDays(d, 1)) if (isWorkday(dayInfo(index, d, today))) workdays++
  const eur = totals(active(transactions).filter((tx) => tx.date.slice(0, 7) === month)).incomeEur
  return { month, workdays, eur, perWorkday: workdays > 0 ? round2(eur / workdays) : null }
}

/** De laatste `count` maanden, nieuwste eerst, voor de tabel onder Geld. */
export function incomePerWorkday(index: CalendarIndex, transactions: readonly Transaction[], today: string = todayIso(), count = 12): WorkdayIncome[] {
  return lastMonths(today, count)
    .reverse()
    .map((month) => monthIncome(index, transactions, month, today))
}
