import { addDays } from '../basis/datum'
import { HISTORY_DAYS, HISTORY_PATH } from '../domain/history'
import type { Reader } from '../domain/tx'
import { active } from './derive'
import { daysRange } from './trip-dates'
import type { HistoryEntry, Leg, Participant, Student, Trip } from './types'

// Logboek herstellen (Meer → Opslag): koppelingen die niet kloppen, terug op id. Welke dag bij welke trip hoort, staat in
// de dag zelf (tripId) en bij een geïmporteerde dag ook in zijn vaste id (import:<trip>:<datum>:<n>); welke deelnemer
// bij welke trip, in de trip en bij een student in weekId; wat een opdracht veranderde, in de geschiedenis. Nooit op
// naam, positie of volgorde. Dit bestand rekent alleen; schrijven doet `applyLinkRepair` via een opdracht
// (src/domain/herstel.ts), met een voorbeeld vooraf en ongedaan maken.

/** Een geïmporteerde trip loopt zelden langer dan dit; langer is een teken van een verkeerde koppeling (Nakijken). */
export const LONG_TRIP_DAYS = 21
/** Zoveel dagen mag een trip buiten zijn eigen dagen lopen voordat het telt (een dag erbij, een reisdag). */
const SLACK_DAYS = 3
const DAY_MS = 86_400_000

/** Opdrachten die bij terugzetten records aan een andere trip konden hangen dan waar ze hoorden. */
const SUSPECT_COMMANDS: ReadonlySet<string> = new Set(['terugzetten', 'tripTerugzetten'])

export interface TripFix {
  trip: Trip
  /** De trip zoals hij wordt (zonder nieuwe updatedAt). */
  next: Trip
  /** Begin en eind vooraf en erna (null erna: weer uit de dagen, zonder eigen datums). */
  dates?: { before: { start: string; end: string }; after: { start: string; end: string } | null }
  /** Deelnemers die hier dubbel stonden (ze staan ook bij hun eigen trip). */
  removedParticipants: Participant[]
}

export interface LegMove {
  leg: Leg
  from: string
  to: string
  /** Bewijs: het vaste id van de import, of de geschiedenis van het terugzetten. */
  why: 'import' | 'geschiedenis'
}

export interface StudentMove {
  student: Student
  from: string | null
  to: string
}

export interface ParticipantBack {
  participant: Participant
  /** De trip waar hij (verkeerd) stond en uit verwijderd werd. */
  from: string
  /** De trip waar hij hoort. */
  to: string
}

/** Deelnemers in de prullenbak die al bij hun eigen trip staan: niets te doen, wel te tonen. */
export interface ParticipantHome {
  participant: Participant
  at: string
}

export interface LinkRepairPlan {
  legs: LegMove[]
  trips: TripFix[]
  students: StudentMove[]
  participants: ParticipantBack[]
  /** Ter informatie in het voorbeeld. */
  alreadyHome: ParticipantHome[]
  /** Trips die na herstel nog lang zijn (geen bewijs om iets te verplaatsen): in Nakijken. */
  stillLong: Trip[]
}

export function isEmptyPlan(plan: LinkRepairPlan): boolean {
  return plan.legs.length + plan.trips.length + plan.students.length + plan.participants.length === 0
}

/** De trip uit het vaste id van een geïmporteerde dag (`import:<trip>:<datum>:<n>`), of null. */
export function importTripOf(legId: string): string | null {
  if (!legId.startsWith('import:')) return null
  const parts = legId.slice('import:'.length).split(':')
  if (parts.length < 3) return null
  const trip = parts.slice(0, -2).join(':')
  const date = parts.at(-2)!
  return trip && /^\d{4}-\d{2}-\d{2}$/.test(date) ? trip : null
}

function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY_MS) + 1
}

/** Begin en eind van de dagen van een trip in een lijst dagen. */
function legRange(tripId: string, legs: readonly Leg[]): { start: string; end: string } | null {
  return daysRange(tripId, legs)
}

/** Alleen geïmporteerde dagen en nooit zelf "volg de dagen": zonder eigen datums volgt hij de import. */
function importOnly(trip: Trip, legs: readonly Leg[]): boolean {
  const own = active(legs).filter((l) => l.tripId === trip.id)
  return !trip.datesFromDays && own.length > 0 && own.every((l) => l.source === 'import')
}

/**
 * De eigen datums van een trip die over de dagen van een andere trip heen lopen, terwijl zijn eigen dagen daar niet
 * liggen (samenvoegen gaf hem de datums van beide). Dan weer de eigen dagen; een geïmporteerde trip zonder eigen datums.
 * Een trip zonder dagen (vooruit gepland) blijft zoals hij is.
 */
export function stretchedDates(trip: Trip, legs: readonly Leg[]): TripFix['dates'] | null {
  if (!trip.startDate || !trip.endDate) return null
  const range = legRange(trip.id, legs)
  if (!range) return null
  if (trip.startDate >= addDays(range.start, -SLACK_DAYS) && trip.endDate <= addDays(range.end, SLACK_DAYS)) return null
  // Alleen als het stuk buiten de eigen dagen dagen van een andere trip bedekt.
  const covered = active(legs).some((l) => l.tripId !== trip.id && ((l.date >= trip.startDate! && l.date < range.start) || (l.date > range.end && l.date <= trip.endDate!)))
  if (!covered) return null
  return { before: { start: trip.startDate, end: trip.endDate }, after: importOnly(trip, legs) ? null : { start: range.start, end: range.end } }
}

function withDates(trip: Trip, after: { start: string; end: string } | null): Trip {
  const { startDate: _s, endDate: _e, ...rest } = trip
  void [_s, _e]
  return after ? { ...rest, startDate: after.start, endDate: after.end } : (rest as Trip)
}

/**
 * Deelnemers die in twee trips staan. Samenvoegen gaf de overblijvende trip de deelnemers van beide; kwam de andere
 * terug, dan staan ze dubbel. Ze gaan weg uit de trip die alles van de andere ook heeft (de samengevoegde); hebben beide
 * ook eigen deelnemers, dan beslist de student (weekId). Zonder bewijs blijft het staan.
 */
export function duplicateParticipants(trips: readonly Trip[], students: readonly Student[]): Map<string, Participant[]> {
  const live = active(trips)
  const studentTrip = new Map(active(students).map((s) => [s.id, s.weekId ?? null]))
  const ids = new Map(live.map((t) => [t.id, new Set((t.participants ?? []).map((p) => p.id))]))
  const holders = new Map<string, Trip[]>()
  for (const t of live) for (const p of t.participants ?? []) holders.set(p.id, [...(holders.get(p.id) ?? []), t])
  const remove = new Map<string, Participant[]>()
  const drop = (trip: Trip, pid: string) => {
    const p = (trip.participants ?? []).find((x) => x.id === pid)
    if (p && !(remove.get(trip.id) ?? []).some((x) => x.id === pid)) remove.set(trip.id, [...(remove.get(trip.id) ?? []), p])
  }
  for (const [pid, list] of holders) {
    if (list.length < 2) continue
    // De trip met de kleinste lijst die helemaal in een andere zit: dat is het origineel; de grotere lijsten verliezen hem.
    const sorted = [...list].sort((a, b) => ids.get(a.id)!.size - ids.get(b.id)!.size)
    const origin = sorted.find((small) => sorted.some((big) => big !== small && [...ids.get(small.id)!].every((id) => ids.get(big.id)!.has(id))))
    const home = studentTrip.get(pid)
    const keep = origin ?? (home ? list.find((t) => t.id === home) : undefined)
    if (!keep) continue
    for (const t of list) if (t.id !== keep.id) drop(t, pid)
  }
  return remove
}

/** Recente regels in de geschiedenis die niet teruggezet zijn, oudste eerst. */
function recentEntries(reader: Reader, now: string): HistoryEntry[] {
  return active(reader.get(HISTORY_PATH))
    .filter((e) => !e.undoneAt && Date.parse(now) - Date.parse(e.at) <= HISTORY_DAYS * DAY_MS)
    .sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * Waar hoort een dag die nu bij `current` staat? Het vaste import-id noemt de trip van de import; anders de trip van
 * vóór het laatste terugzetten dat hem verplaatste. Alleen een bestaande andere trip telt.
 */
function evidenceFor(leg: Leg, moves: ReadonlyMap<string, string>, live: ReadonlySet<string>): { to: string; why: LegMove['why'] } | null {
  const fromId = importTripOf(leg.id)
  if (fromId && fromId !== leg.tripId && live.has(fromId)) return { to: fromId, why: 'import' }
  const before = moves.get(leg.id)
  if (before && before !== leg.tripId && live.has(before)) return { to: before, why: 'geschiedenis' }
  return null
}

/** Het herstelplan: wat verkeerd gekoppeld is en hoe het terug gaat. Rekent alleen. */
export function planLinkRepair(reader: Reader, now = new Date().toISOString()): LinkRepairPlan {
  const trips = active(reader.get('trips.json.enc'))
  const live = new Set(trips.map((t) => t.id))
  const allLegs = reader.get('legs.json.enc')
  const legs = active(allLegs)
  const entries = recentEntries(reader, now)

  // Dagen die een terugzetten verplaatste: per dag de trip van vóór die opdracht (de laatste telt).
  const moved = new Map<string, string>()
  for (const e of entries) {
    if (!SUSPECT_COMMANDS.has(e.command)) continue
    for (const c of e.changes) {
      if (c.path !== 'legs.json.enc' || !c.before || typeof c.before.tripId !== 'string' || c.after.tripId === undefined) continue
      moved.set(c.id, c.before.tripId)
    }
  }

  // 1. Dagen: alleen weg uit een trip die te lang is geworden, en alleen naar een trip waar ze bij passen.
  const long = new Set(
    trips
      .filter((t) => {
        const r = legRange(t.id, legs)
        return !!r && spanDays(r.start, r.end) > LONG_TRIP_DAYS
      })
      .map((t) => t.id),
  )
  const legMoves: LegMove[] = []
  for (const leg of legs) {
    if (!long.has(leg.tripId)) continue
    const ev = evidenceFor(leg, moved, live)
    if (!ev) continue
    legMoves.push({ leg, from: leg.tripId, to: ev.to, why: ev.why })
  }
  // De dagen zoals ze worden: daarop rekenen de datums.
  const moveOf = new Map(legMoves.map((m) => [m.leg.id, m.to]))
  const nextLegs: Leg[] = allLegs.map((l) => (moveOf.has(l.id) ? { ...l, tripId: moveOf.get(l.id)! } : l))

  // 2. Deelnemers die dubbel staan.
  const students = reader.get('students.json.enc')
  const dupes = duplicateParticipants(trips, students)

  // 3. Trips: datums terug naar de eigen dagen; trips die de dagen volgen, weer gelijk aan hun dagen.
  const touched = new Set([...legMoves.map((m) => m.from), ...legMoves.map((m) => m.to)])
  const tripFixes: TripFix[] = []
  for (const trip of trips) {
    let dates = stretchedDates(trip, nextLegs)
    if (!dates && touched.has(trip.id) && trip.datesFromDays && trip.startDate && trip.endDate) {
      const r = legRange(trip.id, nextLegs)
      if (r && (r.start !== trip.startDate || r.end !== trip.endDate)) dates = { before: { start: trip.startDate, end: trip.endDate }, after: r }
    }
    const removed = dupes.get(trip.id) ?? []
    if (!dates && removed.length === 0) continue
    let next: Trip = dates ? withDates(trip, dates.after) : { ...trip }
    if (removed.length > 0) next = { ...next, participants: (trip.participants ?? []).filter((p) => !removed.some((r) => r.id === p.id)) }
    tripFixes.push({ trip, next, ...(dates ? { dates } : {}), removedParticipants: removed })
  }
  const nextTrips = new Map(trips.map((t) => [t.id, t]))
  for (const f of tripFixes) nextTrips.set(f.trip.id, f.next)

  // 4. Studenten: bij de trip waar hun deelnemer (nu nog één keer) staat.
  const holder = new Map<string, string[]>()
  for (const t of nextTrips.values()) for (const p of t.participants ?? []) holder.set(p.id, [...(holder.get(p.id) ?? []), t.id])
  const studentMoves: StudentMove[] = []
  for (const s of active(students)) {
    const at = holder.get(s.id)
    if (!at || at.length !== 1) continue
    if ((s.weekId ?? null) !== at[0]) studentMoves.push({ student: s, from: s.weekId ?? null, to: at[0]! })
  }

  // 5. Deelnemers in de prullenbak (verwijderd uit een trip waar ze verkeerd stonden): terug naar hun eigen trip.
  const back: ParticipantBack[] = []
  const alreadyHome: ParticipantHome[] = []
  const studentTrip = new Map(active(students).map((s) => [s.id, s.weekId ?? null]))
  for (const m of studentMoves) studentTrip.set(m.student.id, m.to)
  for (const e of entries) {
    if (e.command !== 'deelnemerVerwijderen') continue
    const change = e.changes.find((c) => c.path === 'trips.json.enc')
    if (!change) continue
    const was = (change.before?.participants ?? []) as Participant[]
    const after = (change.after.participants ?? []) as Participant[]
    for (const p of was.filter((x) => !after.some((y) => y.id === x.id))) {
      const now = holder.get(p.id)
      if (now && now.length > 0) {
        alreadyHome.push({ participant: p, at: now[0]! })
        continue
      }
      const home = studentTrip.get(p.id)
      if (home && home !== change.id && nextTrips.has(home) && !back.some((b) => b.participant.id === p.id)) back.push({ participant: p, from: change.id, to: home })
    }
  }

  // Nog lang na herstel (zonder bewijs om iets te verplaatsen): alleen ter informatie.
  const stillLong = [...nextTrips.values()].filter((t) => {
    const r = legRange(t.id, nextLegs)
    return !!r && spanDays(r.start, r.end) > LONG_TRIP_DAYS && active(nextLegs).some((l) => l.tripId === t.id && l.source === 'import')
  })

  return { legs: legMoves, trips: tripFixes, students: studentMoves, participants: back, alreadyHome, stillLong }
}

/**
 * Na terugzetten uit de prullenbak: de trips die bij hetzelfde verwijderen de datums of deelnemers van de teruggezette
 * trip kregen, weer zonder. `survivors` zijn de trips die dezelfde tijd kregen als de verwijdering.
 */
export function untangleSurvivors(reader: Reader, restored: Trip, survivors: readonly string[]): TripFix[] {
  const legs = reader.get('legs.json.enc')
  const theirs = new Set((restored.participants ?? []).map((p) => p.id))
  const fixes: TripFix[] = []
  for (const id of survivors) {
    const trip = active(reader.get('trips.json.enc')).find((t) => t.id === id)
    if (!trip) continue
    const dates = stretchedDates(trip, legs)
    const removed = (trip.participants ?? []).filter((p) => theirs.has(p.id))
    if (!dates && removed.length === 0) continue
    let next: Trip = dates ? withDates(trip, dates.after) : { ...trip }
    if (removed.length > 0) next = { ...next, participants: (trip.participants ?? []).filter((p) => !theirs.has(p.id)) }
    fixes.push({ trip, next, ...(dates ? { dates } : {}), removedParticipants: removed })
  }
  return fixes
}

/** Een geïmporteerde trip die langer loopt dan `LONG_TRIP_DAYS` (Nakijken). */
export function longImportTrips(reader: Reader): Array<{ trip: Trip; start: string; end: string; days: number }> {
  const legs = active(reader.get('legs.json.enc'))
  const out: Array<{ trip: Trip; start: string; end: string; days: number }> = []
  for (const trip of active(reader.get('trips.json.enc'))) {
    if (!legs.some((l) => l.tripId === trip.id && l.source === 'import')) continue
    const r = legRange(trip.id, legs)
    const start = trip.startDate && r && trip.startDate < r.start ? trip.startDate : r?.start
    const end = trip.endDate && r && trip.endDate > r.end ? trip.endDate : r?.end
    if (!start || !end) continue
    const days = spanDays(start, end)
    if (days > LONG_TRIP_DAYS) out.push({ trip, start, end, days })
  }
  return out
}

