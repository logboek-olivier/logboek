import type { Store } from '../storage/store'
import { applyChanges, bothUndo, undoableIn, type Undo } from './changes'
import { active, compareLegs } from './derive'
import { addDays } from './money'
import { allPeriods, isWaterKind, periodAt, rangeDates, setStayDays, waterRanges, type Period } from './periods'
import { mergeCandidates, placeKey, placeUses, type PlaceUse } from './places'
import { saveSettings, currentSettings } from './settings'
import { tripOverlaps, type Overlap } from './trip-ops'
import { kindForType, typeForKind } from './trip-kind'
import { STAY_FROM_DAY, dayHasDetails } from './migrate-periods'
import { daysBetween, followTrip, tripRange } from './calendar'
import { followDays } from './trip-dates'
import { defaultWeekName, weekView } from './weeks'
import type { Lang } from '../i18n'
import type { CalendarDay, Leg, Organisation, Place, Settings, StayKind, StayPeriod, Transaction, Trip, WeekType } from './types'

// Nakijken (Meer → Nakijken): twijfelgevallen en tegenstrijdigheden in het periodemodel, elk met één knop die het
// oplost (met ongedaan maken) en "Klopt zo" (onthouden in settings.reviewDismissed). Alleen zichtbaar als er iets is.

export type ReviewItem =
  /** Trip zonder zekere soort: de soorten als knoppen, met het voorstel eerst. */
  | { key: string; kind: 'soort'; trip: Trip; suggestion: WeekType }
  /** Werk zonder organisatie, met een voorstel uit de source van zijn inkomsten. */
  | { key: string; kind: 'organisatie'; trip: Trip; suggestion: Organisation | null }
  /** Twee trips op dezelfde dagen. */
  | { key: string; kind: 'overlap-trips'; overlap: Overlap }
  /** Een periode aan land op dagen van een trip, of twee periodes aan land op dezelfde dag. */
  | { key: string; kind: 'overlap-land'; stay: StayPeriod; other: Period; from: string; to: string }
  /** Een gelogde dag buiten de datums van zijn trip: naar de periode van die datum, of de trip verlengen. */
  | { key: string; kind: 'dag-buiten'; leg: Leg; trip: Trip; target: Trip | null }
  /** Een zelf ingestelde agendadag (rust, thuis, reis, ...) binnen een trip. */
  | { key: string; kind: 'agendadag-in-trip'; day: CalendarDay; trip: Trip }
  /** Een zelf ingestelde dagtoestand (of een andere soort) binnen een periode aan land: de periode verbergt hem. */
  | { key: string; kind: 'agendadag-in-periode'; day: CalendarDay; stay: StayPeriod }
  /** Werkdagen in de agenda zonder trip. */
  | { key: string; kind: 'werkdag-zonder-trip'; from: string; to: string }
  /** Agendadagen thuis, reis of rust zonder periode (bijvoorbeeld van een oudere versie op een ander apparaat). */
  | { key: string; kind: 'dag-zonder-periode'; stayKind: StayKind; from: string; to: string }
  /** Een investering van vóór het periodemodel zonder soort: opleiding of uitrusting? */
  | { key: string; kind: 'investering-soort'; tx: Transaction }
  /** Inkomen of uitgave zonder periode. */
  | { key: string; kind: 'geld-zonder-periode'; tx: Transaction; target: Period | null }
  /** Twee plaatsnamen die dezelfde plaats lijken: `from` gaat op in `into`. */
  | { key: string; kind: 'plaatsen'; from: PlaceUse; into: PlaceUse; reason: 'spelling' }
  /**
   * Een dag die begint in een andere plaats dan waar de dag ervoor eindigde, met één van de twee zonder pin: misschien
   * dezelfde plaats onder een andere naam ("Sint Barths" en "Gustavia"). Eerste fix: alleen de van van deze dag.
   */
  | { key: string; kind: 'aansluiting'; leg: Leg; previous: Leg; from: PlaceUse; into: PlaceUse }

export interface ReviewInput {
  trips: readonly Trip[]
  legs: readonly Leg[]
  stays: readonly StayPeriod[]
  calendar: readonly CalendarDay[]
  transactions: readonly Transaction[]
  places: readonly Place[]
  settings: Settings
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

  // Overlap.
  for (const overlap of tripOverlaps(trips, legs)) items.push({ key: `overlap:${[overlap.a.id, overlap.b.id].sort().join('+')}`, kind: 'overlap-trips', overlap })
  const stays = periods.filter((p) => p.stay)
  for (const p of stays) {
    for (const other of periods) {
      if (other.id === p.id || !other.start || !other.end) continue
      // Twee periodes aan land: één keer melden.
      if (other.stay && other.id < p.id) continue
      const from = p.start > other.start ? p.start : other.start
      const to = p.end < other.end ? p.end : other.end
      if (from > to) continue
      items.push({ key: `overlap:${p.id}+${other.id}`, kind: 'overlap-land', stay: p.stay!, other, from, to })
    }
  }

  // Dagen buiten hun trip (alleen trips met eigen datums: die van Toevoegen → Dag volgen hun dagen).
  const byId = new Map(trips.map((trip) => [trip.id, trip]))
  for (const view of views) {
    const trip = view.trip
    if (trip.datesFromDays || !trip.startDate || !trip.endDate) continue
    for (const leg of view.legs) {
      if (leg.date >= trip.startDate && leg.date <= trip.endDate) continue
      const target = periodAt(periods, leg.date)
      const targetTrip = target && isWaterKind(target.kind) && target.id !== trip.id ? (byId.get(target.id) ?? null) : null
      items.push({ key: `dag-buiten:${leg.id}`, kind: 'dag-buiten', leg, trip, target: targetTrip })
    }
  }

  // Agenda.
  const own = active(input.calendar).sort((a, b) => (a.date < b.date ? -1 : 1))
  for (const day of own) {
    if (day.type === 'werk' || !inWater(day.date)) continue
    const trip = periodAt(periods, day.date)
    if (trip?.view) items.push({ key: `agendadag:${day.id}`, kind: 'agendadag-in-trip', day, trip: trip.view.trip })
  }
  const inStay = (d: string) => stays.some((p) => p.start <= d && d <= p.end)
  for (const day of own) {
    if (inWater(day.date)) continue
    const stay = stays.find((p) => p.start <= day.date && day.date <= p.end)?.stay
    // Een dag met gegevens van dezelfde soort is gewoon een dag van die periode.
    if (stay && STAY_FROM_DAY[day.type] !== stay.kind) items.push({ key: `agendadag:${day.id}`, kind: 'agendadag-in-periode', day, stay })
  }
  for (const run of runsOf(own.filter((d) => d.type === 'werk' && !inWater(d.date)), () => 'werk')) items.push({ key: `werkdag:${run.from}`, kind: 'werkdag-zonder-trip', from: run.from, to: run.to })
  for (const run of runsOf(own.filter((d) => STAY_FROM_DAY[d.type] && !inWater(d.date) && !inStay(d.date)), (d) => STAY_FROM_DAY[d.type]!)) {
    items.push({ key: `landdag:${run.from}`, kind: 'dag-zonder-periode', stayKind: run.value as StayKind, from: run.from, to: run.to })
  }

  // Geld zonder periode (declaraties volgen hun declaratie).
  const ids = new Set(periods.map((p) => p.id))
  for (const tx of active(input.transactions)) {
    if (tx.claimId || (tx.tripId && ids.has(tx.tripId))) continue
    items.push({ key: `geld:${tx.id}`, kind: 'geld-zonder-periode', tx, target: periodAt(periods, tx.date) })
  }

  // Investeringen zonder soort (van vóór het periodemodel).
  for (const tx of active(input.transactions)) if (tx.kind === 'investering' && tx.category !== 'opleiding' && tx.category !== 'uitrusting') items.push({ key: `investering:${tx.id}`, kind: 'investering-soort', tx })

  // Plaatsen die dubbel lijken: spelvarianten, en een van die niet aansluit op de naar van de dag ervoor.
  const uses = placeUses(legs, input.places)
  const useOf = new Map(uses.map((u) => [u.key, u]))
  const seen = new Set<string>()
  const pair = (a: PlaceUse, b: PlaceUse, reason: 'spelling') => {
    const id = [a.key, b.key].sort().join('+')
    if (seen.has(id)) return
    seen.add(id)
    // De naam met een pin (anders de meest gebruikte) blijft.
    const [into, from] = (b.place && !a.place) || (!!b.place === !!a.place && b.days > a.days) ? [b, a] : [a, b]
    items.push({ key: `plaatsen:${id}`, kind: 'plaatsen', from, into, reason })
  }
  void pair
  for (const c of mergeCandidates(uses)) for (const o of c.others) pair(c.into, o, 'spelling')
  const byTrip = new Map<string, Leg[]>()
  for (const leg of legs) byTrip.set(leg.tripId, [...(byTrip.get(leg.tripId) ?? []), leg])
  for (const list of byTrip.values()) {
    const sorted = [...list].sort(compareLegs)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const next = sorted[i]!
      const a = useOf.get(placeKey(prev.toPlace))
      const b = useOf.get(placeKey(next.fromPlace))
      if (!a || !b || a.key === b.key) continue
      // Alleen opeenvolgende dagen, en alleen als een van de twee geen pin heeft: twee plaatsen met een pin zijn echt
      // verschillend (een dag die op een andere plek begon), en tussen twee dagen met een gat kan de boot verhuisd zijn.
      if (a.place && b.place) continue
      if (next.date !== prev.date && next.date !== addDays(prev.date, 1)) continue
      const id = [a.key, b.key].sort().join('+')
      if (seen.has(id)) continue
      seen.add(id)
      // De naam met een pin blijft; zonder pins de naam van de dag ervoor.
      const [into, from] = b.place && !a.place ? [b, a] : [a, b]
      items.push({ key: `aansluiting:${next.id}`, kind: 'aansluiting', leg: next, previous: prev, from, into })
    }
  }
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

export function reviewInput(store: Store): ReviewInput {
  return {
    trips: store.list('trips.json.enc'),
    legs: store.list('legs.json.enc'),
    stays: store.list('periods.json.enc'),
    calendar: store.list('calendar.json.enc'),
    transactions: store.list('transactions.json.enc'),
    places: store.list('places.json.enc'),
    settings: currentSettings(store.list('settings.json.enc')),
  }
}

// ---------- Oplossen ----------

/** "Klopt zo": het punt komt niet meer terug. */
export async function dismissReview(store: Store, item: ReviewItem): Promise<Undo> {
  const before = currentSettings(store.list('settings.json.enc')).reviewDismissed ?? []
  await saveSettings(store, { reviewDismissed: [...before.filter((k) => k !== item.key), item.key].slice(-500) })
  void store.sync()
  return async () => {
    await saveSettings(store, { reviewDismissed: before })
    void store.sync()
  }
}

function changed<T extends { updatedAt: string }>(record: T, patch: Partial<T>): T {
  return { ...record, ...patch, updatedAt: new Date().toISOString() }
}

/** Soort van een trip vastleggen (met het type dat oudere versies lezen). */
export function setTripKind(store: Store, trip: Trip, type: WeekType): Promise<Undo> {
  const kind = kindForType(type)
  return applyChanges(store, [{ path: 'trips.json.enc', before: trip, after: changed(trip, { kind, type: typeForKind(kind, type) }) }])
}

export function setTripOrganisation(store: Store, trip: Trip, organisation: Organisation): Promise<Undo> {
  return applyChanges(store, [{ path: 'trips.json.enc', before: trip, after: changed(trip, { organisation }) }])
}

/** Een dag buiten zijn trip: naar de trip van die datum, of (zonder trip op die datum) de trip verlengen tot die dag. */
export async function fixLegOutside(store: Store, leg: Leg, trip: Trip, target: Trip | null): Promise<Undo> {
  if (target) {
    const undo = await applyChanges(store, [{ path: 'legs.json.enc', before: leg, after: changed(leg, { tripId: target.id }) }])
    await followDays(store, [trip.id, target.id])
    return undo
  }
  const legs = store.list('legs.json.enc')
  const range = tripRange(trip, legs)
  const start = trip.startDate && leg.date < trip.startDate ? leg.date : trip.startDate!
  const end = trip.endDate && leg.date > trip.endDate ? leg.date : trip.endDate!
  const tripUndo = await applyChanges(store, [{ path: 'trips.json.enc', before: trip, after: changed(trip, { startDate: start, endDate: end }) }])
  const follow = await undoFollow(store, () => followTrip(store, trip.id, range, { start, end }))
  return bothUndo(tripUndo, follow)
}

function undoFollow(store: Store, action: () => Promise<void>): Promise<Undo> {
  return undoableIn(store, ['calendar.json.enc', 'periods.json.enc', 'transactions.json.enc'], action)
}

/** Een agendadag binnen een trip hoort bij de trip: zonder gegevens vervalt hij, met gegevens wordt hij een werkdag. */
export function fixDayInTrip(store: Store, day: CalendarDay): Promise<Undo> {
  const now = new Date().toISOString()
  const after: CalendarDay = dayHasDetails(day) ? { ...day, type: 'werk', updatedAt: now } : { ...day, updatedAt: now, deletedAt: now }
  return applyChanges(store, [{ path: 'calendar.json.enc', before: day, after }])
}

/** Werkdagen zonder trip: één trip over die dagen (soort werk, nog zonder organisatie). */
export async function makeTripFor(store: Store, from: string, to: string, lang: Lang): Promise<Undo> {
  const now = new Date().toISOString()
  const trip: Trip = { id: crypto.randomUUID(), name: defaultWeekName(from, lang), kind: 'werk', type: 'overig', startDate: from, endDate: to, updatedAt: now, deletedAt: null }
  const undo = await applyChanges(store, [{ path: 'trips.json.enc', before: null, after: trip }])
  const follow = await undoFollow(store, () => followTrip(store, trip.id, null, { start: from, end: to }))
  return bothUndo(undo, follow)
}

/** Agendadagen zonder periode: een periode van die soort over die dagen. */
export function makeStayFor(store: Store, kind: StayKind, from: string, to: string): Promise<Undo> {
  return setStayDays(store, rangeDates(from, to), kind)
}

/**
 * Inkomen of uitgave zonder periode: koppelen aan de periode van de datum; is er geen, dan een thuisperiode op die dag
 * (die een aangrenzende thuisperiode verlengt).
 */
export async function fixMoneyWithoutPeriod(store: Store, tx: Transaction, target: Period | null): Promise<Undo> {
  if (target) return applyChanges(store, [{ path: 'transactions.json.enc', before: tx, after: changed(tx, { tripId: target.id }) }])
  const undoStay = await setStayDays(store, [tx.date], 'thuis')
  const periods = allPeriods(store.list('trips.json.enc'), store.list('legs.json.enc'), store.list('periods.json.enc'))
  const now = periodAt(periods, tx.date)
  const current = store.list('transactions.json.enc').find((x) => x.id === tx.id) ?? tx
  const undoLink = now ? await applyChanges(store, [{ path: 'transactions.json.enc', before: current, after: changed(current, { tripId: now.id }) }]) : async () => {}
  return bothUndo(undoStay, undoLink)
}

/**
 * Periode aan land op dagen van een andere periode: de andere gaat voor. Die dagen gaan uit deze periode (korter,
 * gesplitst of weg); bij twee periodes aan land krijgen ze de soort van de andere (samen als die dezelfde soort hebben).
 */
export function fixLandOverlap(store: Store, from: string, to: string, other: Period): Promise<Undo> {
  return setStayDays(store, rangeDates(from, to), other.stay ? other.stay.kind : null)
}

/** Alleen de van van deze dag wordt de naar van de dag ervoor (met het land). */
export function fixLegStart(store: Store, leg: Leg, previous: Leg): Promise<Undo> {
  return applyChanges(store, [{ path: 'legs.json.enc', before: leg, after: changed(leg, { fromPlace: previous.toPlace, fromCountry: previous.toCountry || leg.fromCountry }) }])
}

/** Een dagtoestand binnen een periode aan land laten gelden: de dag gaat uit de periode (korter of gesplitst). */
export function fixDayInStay(store: Store, day: CalendarDay): Promise<Undo> {
  return setStayDays(store, [day.date], null)
}

/** Zoveel dagen mag Nakijken een trip met één tik verlengen voor een dag die erbuiten valt; verder weg is de datum vast fout. */
export const EXTEND_FIX_DAYS = 3

export function legOutsideCanExtend(leg: Leg, trip: Trip): boolean {
  if (!trip.startDate || !trip.endDate) return false
  const gap = leg.date < trip.startDate ? daysBetween(leg.date, trip.startDate) : daysBetween(trip.endDate, leg.date)
  return gap <= EXTEND_FIX_DAYS
}

/** Alle voorstellen voor de soort in één keer overnemen (met één ongedaan maken). */
export async function acceptAllKinds(store: Store, items: readonly ReviewItem[]): Promise<Undo> {
  const undos: Undo[] = []
  for (const item of items) {
    if (item.kind !== 'soort') continue
    const current = store.list('trips.json.enc').find((x) => x.id === item.trip.id)
    if (current) undos.push(await setTripKind(store, current, item.suggestion))
  }
  return bothUndo(...undos)
}

/** Soort van een investering vastleggen (opleiding of uitrusting). */
export function setInvestmentCategory(store: Store, tx: Transaction, category: 'opleiding' | 'uitrusting'): Promise<Undo> {
  return applyChanges(store, [{ path: 'transactions.json.enc', before: tx, after: changed(tx, { category }) }])
}
