import type { Tx, Reader } from '../domain/tx'
import { t } from '../i18n'
import { applyChanges, type Change } from './changes'
import { active } from './derive'
import { weekView, type WeekView } from './weeks'
import type { CalendarDay, Leg, PeriodKind, StayKind, StayPeriod, Transaction, Trip, WeekType } from './types'
import { addDays, isDate } from '../basis/datum'

// Het periodemodel (docs/PERIODEMODEL.md): elke dag hoort bij hoogstens één periode. Werk, training en plezier zijn
// trips (trips.json.enc); reis, thuis en vrij zijn periodes aan land (periods.json.enc). Schermen werken met `Period`,
// welk bestand erachter zit doet er voor hen niet toe. Water gaat voor land: een dag in een trip hoort nooit ook bij
// een periode aan land.

export interface Period {
  id: string
  kind: PeriodKind
  /** Bij werk: het subtype (les geven, skipper charter, delivery, overig). */
  type?: WeekType
  /** De soort is opgeslagen of zeker afgeleid (anders staat de trip in Nakijken). */
  sure: boolean
  name: string
  /** jjjj-mm-dd; leeg bij een trip zonder datums en zonder dagen. */
  start: string
  end: string
  note?: string
  /** Op het water: de trip met zijn afgeleide waarden. */
  view?: WeekView
  /** Aan land: het record. */
  stay?: StayPeriod
}


export function isWaterKind(kind: PeriodKind): kind is 'werk' | 'training' | 'plezier' {
  return kind === 'werk' || kind === 'training' || kind === 'plezier'
}

/** Naam van een periode aan land: de eigen naam, anders "Thuis", "Vrij" of "Reis Amsterdam → Sint Maarten". */
export function stayName(stay: Pick<StayPeriod, 'kind' | 'name' | 'travel'>): string {
  if (stay.name?.trim()) return stay.name.trim()
  const base = t(`periodKind.${stay.kind}`)
  const route = [stay.travel?.from, stay.travel?.to].filter((x) => x?.trim()).join(' → ')
  return stay.kind === 'reis' && route ? `${base} ${route}` : base
}

export function waterPeriod(view: WeekView): Period {
  return {
    id: view.trip.id,
    kind: view.kind,
    ...(view.kind === 'werk' ? { type: view.type } : {}),
    sure: view.kindSure,
    name: view.trip.name,
    start: view.startDate,
    end: view.endDate,
    ...(view.trip.note ? { note: view.trip.note } : {}),
    view,
  }
}

export function stayPeriod(stay: StayPeriod): Period {
  return { id: stay.id, kind: stay.kind, sure: true, name: stayName(stay), start: stay.startDate, end: stay.endDate, ...(stay.note ? { note: stay.note } : {}), stay }
}

/** Alle periodes (niet verwijderd), oudste eerst; trips zonder datums staan achteraan. */
export function allPeriods(trips: readonly Trip[], legs: readonly Leg[], stays: readonly StayPeriod[]): Period[] {
  const water = active(trips).map((trip) => waterPeriod(weekView(trip, legs)))
  const land = active(stays)
    .filter((s) => isDate(s.startDate) && isDate(s.endDate) && s.startDate <= s.endDate)
    .map(stayPeriod)
  return [...water, ...land].sort((a, b) => (a.start || '9999') < (b.start || '9999') ? -1 : (a.start || '9999') > (b.start || '9999') ? 1 : 0)
}

/** De periode van een datum; water gaat voor land, bij twee trips (wisseldag) de laatst begonnen. */
export function periodAt(periods: readonly Period[], date: string): Period | null {
  const inside = periods.filter((p) => isDate(p.start) && isDate(p.end) && p.start <= date && date <= p.end)
  return inside.filter((p) => isWaterKind(p.kind)).at(-1) ?? inside[0] ?? null
}

// ---------- Periodes aan land maken, verlengen, korter maken, splitsen ----------

export interface StayDetails {
  name?: string
  note?: string
  travel?: StayPeriod['travel']
}

export interface StayPlan {
  changes: { before: StayPeriod | null; after: StayPeriod }[]
  /** Na de wijziging: per datum in het bekeken stuk de periode aan land (id), of null. */
  owner: Map<string, string | null>
}

/**
 * Wat er verandert als `dates` de soort `kind` krijgen (null = uit hun periode aan land halen). Dagen in een trip
 * (`isWater`) krijgen nooit een soort aan land. Aangrenzende periodes van dezelfde soort gaan samen (de oudste id blijft,
 * net als zijn naam en notitie); een periode waar dagen uit gaan, wordt korter, gesplitst (het tweede stuk krijgt een
 * nieuwe id en de naam) of verdwijnt. Schrijft niets.
 */
export function planStayDays(
  stays: readonly StayPeriod[],
  dates: readonly string[],
  kind: StayKind | null,
  isWater: (date: string) => boolean,
  now: string,
  makeId: () => string,
  details: StayDetails = {},
): StayPlan {
  const live = active(stays).filter((s) => isDate(s.startDate) && isDate(s.endDate) && s.startDate <= s.endDate)
  const targets = [...new Set(dates.filter(isDate))].sort().filter((d) => kind === null || !isWater(d))
  const empty: StayPlan = { changes: [], owner: new Map() }
  if (targets.length === 0) return empty
  let lo = addDays(targets[0]!, -1)
  let hi = addDays(targets.at(-1)!, 1)
  const affected = live.filter((s) => s.startDate <= hi && s.endDate >= lo)
  for (const s of affected) {
    if (s.startDate < lo) lo = s.startDate
    if (s.endDate > hi) hi = s.endDate
  }
  // Per dag in het stuk: soort en eigenaar (bij overlap de eerst begonnen periode).
  const ordered = [...affected].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.updatedAt < b.updatedAt ? -1 : 1))
  const day = new Map<string, { kind: StayKind; id: string | null }>()
  for (const s of ordered) {
    for (let d = s.startDate; d <= s.endDate; d = addDays(d, 1)) {
      if (!day.has(d)) day.set(d, { kind: s.kind, id: s.id })
    }
  }
  for (const d of targets) {
    if (kind === null) day.delete(d)
    else if (day.get(d)?.kind !== kind) day.set(d, { kind, id: null })
  }
  // Aaneengesloten stukken van dezelfde soort.
  const runs: { kind: StayKind; start: string; end: string; ids: Map<string, number> }[] = []
  for (let d = lo; d <= hi; d = addDays(d, 1)) {
    const cell = day.get(d)
    if (!cell) continue
    const last = runs.at(-1)
    if (last && last.kind === cell.kind && last.end === addDays(d, -1)) last.end = d
    else runs.push({ kind: cell.kind, start: d, end: d, ids: new Map() })
    if (cell.id) runs.at(-1)!.ids.set(cell.id, (runs.at(-1)!.ids.get(cell.id) ?? 0) + 1)
  }
  const byId = new Map(affected.map((s) => [s.id, s]))
  const used = new Set<string>()
  const owner = new Map<string, string | null>()
  const changes: StayPlan['changes'] = []
  const firstTarget = targets[0]!
  for (const run of runs) {
    const candidates = [...run.ids.entries()]
      .filter(([id]) => !used.has(id) && byId.get(id)?.kind === run.kind)
      .sort((a, b) => b[1] - a[1] || (byId.get(a[0])!.startDate < byId.get(b[0])!.startDate ? -1 : 1))
    const survivorId = candidates[0]?.[0] ?? null
    const own = kind !== null && run.kind === kind && run.start <= firstTarget && firstTarget <= run.end
    let record: StayPeriod
    if (survivorId) {
      used.add(survivorId)
      const before = byId.get(survivorId)!
      // Samengevoegd met een buurperiode (of een periode die er helemaal in lag): diens notitie, naam en reis gaan mee.
      const others = affected.filter((st) => st.id !== survivorId && !used.has(st.id) && st.kind === run.kind && (run.ids.has(st.id) || (st.startDate >= run.start && st.endDate <= run.end)))
      const note = [before.note, ...others.map((st) => st.note)].filter((n, i, all): n is string => !!n && all.indexOf(n) === i).join('\n')
      const name = before.name ?? others.find((st) => st.name)?.name
      const travel = before.travel ?? others.find((st) => st.travel)?.travel
      record = { ...before, startDate: run.start, endDate: run.end, ...(note ? { note } : {}), ...(name ? { name } : {}), ...(travel ? { travel } : {}) }
      if (own) record = withDetails(record, details)
      if (JSON.stringify(record) !== JSON.stringify(before)) changes.push({ before, after: { ...record, updatedAt: now } })
    } else {
      // Het tweede stuk van een gesplitste periode houdt de eigen naam en de reis; een nieuw stuk krijgt de details.
      const split = [...run.ids.keys()].map((id) => byId.get(id)).find((s) => s?.kind === run.kind)
      record = { id: makeId(), kind: run.kind, startDate: run.start, endDate: run.end, ...(split?.name ? { name: split.name } : {}), ...(split?.travel ? { travel: split.travel } : {}), updatedAt: now, deletedAt: null }
      if (own) record = withDetails(record, details)
      changes.push({ before: null, after: record })
    }
    for (let d = run.start; d <= run.end; d = addDays(d, 1)) owner.set(d, record.id)
  }
  for (const s of affected) if (!used.has(s.id)) changes.push({ before: s, after: { ...s, updatedAt: now, deletedAt: now } })
  for (let d = lo; d <= hi; d = addDays(d, 1)) if (!owner.has(d)) owner.set(d, null)
  return { changes, owner }
}

function withDetails(record: StayPeriod, details: StayDetails): StayPeriod {
  const name = details.name?.trim().slice(0, 120)
  const note = details.note?.trim().slice(0, 2000)
  const from = details.travel?.from?.trim().slice(0, 80)
  const to = details.travel?.to?.trim().slice(0, 80)
  const travel = record.kind === 'reis' && (from || to || details.travel?.by) ? { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(details.travel?.by ? { by: details.travel.by } : {}) } : undefined
  return { ...record, ...(name ? { name } : {}), ...(note ? { note } : {}), ...(travel ? { travel } : {}) }
}

/** Datumbereiken van alle trips (ook afgeleid uit hun dagen). */
export function waterRanges(trips: readonly Trip[], legs: readonly Leg[]): { start: string; end: string; id: string }[] {
  return active(trips)
    .map((trip) => weekView(trip, legs))
    .filter((v) => isDate(v.startDate) && isDate(v.endDate) && v.startDate <= v.endDate)
    .map((v) => ({ start: v.startDate, end: v.endDate, id: v.trip.id }))
}

function hasDetails(day: CalendarDay): boolean {
  return !!(day.note || day.location || day.travel?.from || day.travel?.to || day.travel?.flight || day.reason || day.boat)
}

/**
 * Dagen een soort aan land geven (reis, thuis, vrij) of (null) uit hun periode aan land halen. Dagen in een trip slaan
 * we over. Geld blijft bij zijn periode (nooit stil verhuizen). Een zelf ingestelde agendadag zonder gegevens op een dag die een soort aan
 * land krijgt, vervalt (de periode zegt het nu); met een notitie, plaats of reis blijft hij als gegevens van die dag.
 */
export async function setStayDays(store: Tx, dates: readonly string[], kind: StayKind | null, details: StayDetails = {}): Promise<void> {
  return applyChanges(store, stayDayChanges(store, dates, kind, details))
}

export function stayDayChanges(store: Reader, dates: readonly string[], kind: StayKind | null, details: StayDetails = {}): Change[] {
  const trips = store.list('trips.json.enc')
  const legs = store.list('legs.json.enc')
  const ranges = waterRanges(trips, legs)
  const inWater = (d: string) => ranges.find((r) => r.start <= d && d <= r.end)?.id ?? null
  const now = new Date().toISOString()
  const plan = planStayDays(store.list('periods.json.enc'), dates, kind, (d) => inWater(d) !== null, now, () => crypto.randomUUID(), details)
  const changes: Change[] = plan.changes.map((c) => ({ path: 'periods.json.enc', before: c.before, after: c.after }))
  if (changes.length === 0 && kind === null) return changes
  // Geld verhuist nooit vanzelf naar een andere periode (docs/FUNDERING.md): het blijft bij zijn periode, ook als die
  // korter wordt of weggaat, en hoort het daarna bij geen periode meer, dan staat het in Nakijken met een voorstel.
  // Alleen een dag die dezelfde soort houdt maar een ander id krijgt (een periode die gesplitst wordt of samengaat met
  // een buurperiode van dezelfde soort), neemt zijn geld mee: dat is dezelfde periode in twee stukken of één stuk.
  const before = new Map(plan.changes.filter((c) => c.before).map((c) => [c.before!.id, c.before!]))
  const after = new Map(plan.changes.map((c) => [c.after.id, c.after]))
  for (const money of active(store.list('transactions.json.enc'))) {
    const was = money.tripId ? before.get(money.tripId) : undefined
    if (!was || money.claimId || money.fixedCostId || money.date < was.startDate || money.date > was.endDate) continue
    const self = after.get(was.id)
    if (self && self.deletedAt === null && self.startDate <= money.date && money.date <= self.endDate) continue
    const owner = plan.owner.get(money.date)
    const next = owner ? (after.get(owner) ?? active(store.list('periods.json.enc')).find((p) => p.id === owner)) : undefined
    if (next && next.kind === was.kind) changes.push({ path: 'transactions.json.enc', before: money, after: { ...money, tripId: next.id, updatedAt: now } })
  }
  if (kind !== null) {
    const own = new Map(active(store.list('calendar.json.enc')).map((d) => [d.date, d]))
    for (const date of dates) {
      const day = own.get(date)
      if (day && plan.owner.get(date) && !hasDetails(day)) changes.push({ path: 'calendar.json.enc', before: day, after: { ...day, updatedAt: now, deletedAt: now } })
    }
  }
  return changes
}

/** Alle datums van `from` tot en met `to`. */
export function rangeDates(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Een periode aan land verwijderen (zijn dagen worden weer automatisch). */
/**
 * Een periode aan land verwijderen (naar de prullenbak); de dagen worden weer automatisch. "behouden": het geld blijft
 * staan, zonder periode (in Nakijken); "alles": ook het geld van de periode (declaraties en vaste lasten volgen hun eigen
 * regels en blijven staan).
 */
export async function deleteStay(store: Tx, stay: StayPeriod, choice: 'behouden' | 'alles' = 'behouden'): Promise<void> {
  if (choice === 'alles') {
    const money = store.list('transactions.json.enc').filter((tx) => tx.tripId === stay.id && !tx.claimId && !tx.fixedCostId)
    await store.putMany('transactions.json.enc', money.map((tx) => ({ ...tx, updatedAt: store.now, deletedAt: store.now })))
  }
  await setStayDays(store, rangeDates(stay.startDate, stay.endDate), null)
}

/** Het geld dat aan een periode aan land hangt. */
export function stayMoney(store: Reader, stay: StayPeriod): Transaction[] {
  return store.list('transactions.json.enc').filter((tx) => tx.tripId === stay.id && !tx.claimId && !tx.fixedCostId)
}

export interface StayInput {
  kind: StayKind
  name: string
  startDate: string
  endDate: string
  note: string
  travel?: StayPeriod['travel']
}

/** Een periode aan land bewerken (soort, naam, datums, notitie, reis). Dagen in een trip blijven bij de trip. */
export async function updateStay(store: Tx, stay: StayPeriod, input: StayInput): Promise<void> {
  const [start, end] = input.startDate <= input.endDate ? [input.startDate, input.endDate] : [input.endDate, input.startDate]
  const next = rangeDates(start, end).slice(0, 400)
  const removed = rangeDates(stay.startDate, stay.endDate).filter((d) => !next.includes(d))
  if (removed.length > 0) await setStayDays(store, removed, null, {})
  await setStayDays(store, next, input.kind, {})
  // Naam, notitie en reis van de periode die nu op de begindag staat (ook leegmaken mag).
  const record = active(store.list('periods.json.enc')).find((s) => s.kind === input.kind && s.startDate <= next[0]! && next[0]! <= s.endDate)
  if (record) {
    const { name: _n, note: _o, travel: _t, ...rest } = record
    void [_n, _o, _t]
    const name = input.name.trim().slice(0, 120)
    const note = input.note.trim().slice(0, 2000)
    const from = input.travel?.from?.trim().slice(0, 80)
    const to = input.travel?.to?.trim().slice(0, 80)
    const travel = input.kind === 'reis' && (from || to || input.travel?.by) ? { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(input.travel?.by ? { by: input.travel.by } : {}) } : undefined
    const after: StayPeriod = { ...rest, ...(name ? { name } : {}), ...(note ? { note } : {}), ...(travel ? { travel } : {}), updatedAt: new Date().toISOString() }
    await applyChanges(store, [{ path: 'periods.json.enc', before: record, after }])
  }
}
