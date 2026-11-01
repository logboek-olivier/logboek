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
  /** Bewijs: het vaste id van de import (ook van een trip die opnieuw geïmporteerd werd), of de back-up die Olivier koos. */
  why: 'import' | 'back-up'
}

/** Uit een back-up van vóór de schade (alleen ter vergelijking; er wordt niets uit teruggezet): wie waar hoorde. */
export interface BackupLinks {
  /** Per dag (id) de trip in de back-up. */
  legTrip: ReadonlyMap<string, string>
  /** Per deelnemer (id) de trip in de back-up. */
  participantTrip: ReadonlyMap<string, string>
}

/** De koppelingen uit de bestanden van een geopende back-up. */
export function backupLinks(files: ReadonlyMap<string, readonly SyncRecordLike[]>): BackupLinks {
  const legTrip = new Map<string, string>()
  for (const r of files.get('legs.json.enc') ?? []) if (r.deletedAt === null && typeof r.tripId === 'string') legTrip.set(r.id, r.tripId)
  const participantTrip = new Map<string, string>()
  for (const r of files.get('trips.json.enc') ?? []) if (r.deletedAt === null) for (const p of (r.participants ?? []) as Participant[]) participantTrip.set(p.id, r.id)
  return { legTrip, participantTrip }
}

interface SyncRecordLike {
  id: string
  deletedAt: string | null
  tripId?: unknown
  participants?: unknown
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

/** Een deelnemer van een samengevoegde trip die onder een nieuw id terugkwam (opnieuw geïmporteerd). */
export interface ParticipantMove {
  participant: Participant
  from: string
  to: string
}

export interface LinkRepairPlan {
  legs: LegMove[]
  trips: TripFix[]
  moves: ParticipantMove[]
  students: StudentMove[]
  participants: ParticipantBack[]
  /** Ter informatie in het voorbeeld. */
  alreadyHome: ParticipantHome[]
  /** Trips die na herstel nog lang zijn (geen bewijs om iets te verplaatsen): in Nakijken. */
  stillLong: Trip[]
}

export function isEmptyPlan(plan: LinkRepairPlan): boolean {
  return plan.legs.length + plan.trips.length + plan.moves.length + plan.students.length + plan.participants.length === 0
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

/** Begin en eind van een trip zoals hij er nu staat: eigen datums, anders zijn dagen. */
function rangeOf(trip: Trip, legs: readonly Leg[]): { start: string; end: string } | null {
  const r = legRange(trip.id, legs)
  const start = trip.startDate ?? r?.start
  const end = trip.endDate ?? r?.end
  return start && end && start <= end ? { start, end } : null
}

/** Opdrachten die datums van een trip zetten zonder dat Olivier ze koos (samenvoegen neemt beide trips samen). */
const NOT_CHOSEN: ReadonlySet<string> = new Set(['samenvoegen', 'periodeVervangen', ...SUSPECT_COMMANDS])

/**
 * Trips waarvan Olivier de datums zelf instelde: de laatste opdracht in de geschiedenis die begin of eind veranderde, was
 * een eigen keuze (Trip bewerken, verlengen in de agenda, ...), niet samenvoegen of terugzetten. Die datums blijven altijd.
 */
export function datesChosen(reader: Reader): Set<string> {
  const last = new Map<string, string>()
  for (const e of [...active(reader.get(HISTORY_PATH))].filter((x) => !x.undoneAt).sort((a, b) => a.at.localeCompare(b.at))) {
    for (const c of e.changes) if (c.path === 'trips.json.enc' && ('startDate' in c.after || 'endDate' in c.after)) last.set(c.id, e.command)
  }
  return new Set([...last].filter(([, command]) => !NOT_CHOSEN.has(command)).map(([id]) => id))
}

/**
 * De eigen datums van een trip die over de dagen van een andere trip heen lopen, terwijl zijn eigen dagen daar niet
 * liggen. Alleen met het kenmerk van samenvoegen (begin en eind zijn precies het vroegste begin en het laatste eind van
 * deze trip en een andere), of bij een geïmporteerde trip (die krijgt van de import nooit eigen datums). Dan weer de
 * eigen dagen; een geïmporteerde trip weer zonder eigen datums. Een trip zonder dagen (vooruit gepland), datums die
 * Olivier zelf koos (`chosen`) en elke andere vorm blijven zoals ze zijn (twijfel: Nakijken, nooit vanzelf).
 */
export function stretchedDates(trip: Trip, legs: readonly Leg[], trips: readonly Trip[], chosen: ReadonlySet<string> = new Set()): TripFix['dates'] | null {
  if (!trip.startDate || !trip.endDate || chosen.has(trip.id)) return null
  const range = legRange(trip.id, legs)
  if (!range) return null
  if (trip.startDate >= addDays(range.start, -SLACK_DAYS) && trip.endDate <= addDays(range.end, SLACK_DAYS)) return null
  // Alleen als het stuk buiten de eigen dagen dagen van een andere trip bedekt.
  const covered = active(legs).some((l) => l.tripId !== trip.id && ((l.date >= trip.startDate! && l.date < range.start) || (l.date > range.end && l.date <= trip.endDate!)))
  if (!covered) return null
  const imported = importOnly(trip, legs)
  const merged = active(trips).some((other) => {
    if (other.id === trip.id) return false
    const r = rangeOf(other, legs)
    if (!r) return false
    const start = r.start < range.start ? r.start : range.start
    const end = r.end > range.end ? r.end : range.end
    return trip.startDate === start && trip.endDate === end
  })
  if (!imported && !merged) return null
  return { before: { start: trip.startDate, end: trip.endDate }, after: imported ? null : { start: range.start, end: range.end } }
}

function withDates(trip: Trip, after: { start: string; end: string } | null): Trip {
  const { startDate: _s, endDate: _e, ...rest } = trip
  void [_s, _e]
  return after ? { ...rest, startDate: after.start, endDate: after.end } : (rest as Trip)
}

/** Opdrachten die een verwijderde trip terugzetten. */
const RESTORE_COMMANDS: ReadonlySet<string> = new Set(['terugzetten', 'tripTerugzetten', 'geschiedenisTerugzetten'])

/** Wat de geschiedenis zegt over deelnemers: welke trips teruggezet werden, en uit welke Olivier zelf deelnemers haalde. */
export interface ParticipantHistory {
  restored: ReadonlySet<string>
  removedFrom: ReadonlySet<string>
}

function participantHistory(entries: readonly HistoryEntry[]): ParticipantHistory {
  const restored = new Set<string>()
  const removedFrom = new Set<string>()
  for (const e of entries) {
    for (const c of e.changes) {
      if (c.path !== 'trips.json.enc') continue
      if (RESTORE_COMMANDS.has(e.command) && typeof c.before?.deletedAt === 'string' && c.after.deletedAt === null) restored.add(c.id)
      if (e.command === 'deelnemerVerwijderen') removedFrom.add(c.id)
    }
  }
  return { restored, removedFrom }
}

/**
 * Deelnemers die in twee trips staan (een deelnemer hoort bij één trip). Samenvoegen gaf de overblijvende trip de
 * deelnemers van beide; kwam de andere terug, dan staan ze dubbel. Wie blijft waar, op volgorde van bewijs:
 * 1. de trip die uit de prullenbak terugkwam (zijn lijst is van vóór het samenvoegen);
 * 2. niet de trip waar Olivier al dubbele deelnemers weghaalde (dat was de verkeerde);
 * 3. de trip met de kleinste lijst die helemaal in een andere zit (het origineel; de grotere is de samengevoegde);
 * 4. de trip van de student, of uit de back-up.
 * Zonder bewijs blijft het staan (Gezondheid toont het).
 */
export function duplicateParticipants(
  trips: readonly Trip[],
  students: readonly Student[],
  backup?: BackupLinks,
  history: ParticipantHistory = { restored: new Set(), removedFrom: new Set() },
): Map<string, Participant[]> {
  const live = active(trips)
  const studentTrip = new Map(active(students).map((s) => [s.id, s.weekId ?? null]))
  const ids = new Map(live.map((t) => [t.id, new Set((t.participants ?? []).map((p) => p.id))]))
  const holders = new Map<string, Trip[]>()
  for (const t of live) for (const p of t.participants ?? []) if (!(holders.get(p.id) ?? []).includes(t)) holders.set(p.id, [...(holders.get(p.id) ?? []), t])
  const remove = new Map<string, Participant[]>()
  const drop = (trip: Trip, pid: string) => {
    const p = (trip.participants ?? []).find((x) => x.id === pid)
    if (p && !(remove.get(trip.id) ?? []).some((x) => x.id === pid)) remove.set(trip.id, [...(remove.get(trip.id) ?? []), p])
  }
  const only = (list: readonly Trip[]) => (list.length === 1 ? list[0] : undefined)
  for (const [pid, list] of holders) {
    if (list.length < 2) continue
    let keep = only(list.filter((t) => history.restored.has(t.id)))
    if (!keep && list.some((t) => history.removedFrom.has(t.id))) keep = only(list.filter((t) => !history.removedFrom.has(t.id)))
    if (!keep) {
      const sorted = [...list].sort((a, b) => ids.get(a.id)!.size - ids.get(b.id)!.size)
      keep = sorted.find((small) => sorted.some((big) => big !== small && [...ids.get(small.id)!].every((id) => ids.get(big.id)!.has(id))))
    }
    if (!keep) {
      const home = studentTrip.get(pid) ?? backup?.participantTrip.get(pid)
      keep = home ? list.find((t) => t.id === home) : undefined
    }
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

const legKey = (l: Leg) => `${l.date}|${l.fromPlace}|${l.toPlace}|${l.nmInland + l.nmSea + l.nmTidal}`

/**
 * Verwijderde trips die na opnieuw importeren onder een nieuw id terugkwamen (samengevoegd, daarna de Excel opnieuw
 * geïmporteerd): de oude dag `import:<oud>:<datum>:<n>` (verwijderd) en de nieuwe `import:<nieuw>:<datum>:<n>` met
 * dezelfde inhoud. Alleen als alle oude dagen naar dezelfde nieuwe trip wijzen. Op id en inhoud van de dag, nooit op naam.
 */
export function recreatedTrips(reader: Reader): Map<string, string> {
  const trips = reader.get('trips.json.enc')
  const dead = new Set(trips.filter((t) => t.deletedAt !== null).map((t) => t.id))
  const live = new Set(trips.filter((t) => t.deletedAt === null).map((t) => t.id))
  const now = new Map<string, Set<string>>()
  for (const l of active(reader.get('legs.json.enc'))) {
    const trip = importTripOf(l.id)
    if (trip && live.has(trip) && l.tripId === trip) now.set(legKey(l), (now.get(legKey(l)) ?? new Set()).add(trip))
  }
  const found = new Map<string, Set<string>>()
  for (const l of reader.get('legs.json.enc')) {
    if (l.deletedAt === null) continue
    const trip = importTripOf(l.id)
    if (!trip || !dead.has(trip)) continue
    found.set(trip, new Set([...(found.get(trip) ?? []), ...(now.get(legKey(l)) ?? ['?'])]))
  }
  const out = new Map<string, string>()
  for (const [trip, targets] of found) if (targets.size === 1 && !targets.has('?')) out.set(trip, [...targets][0]!)
  return out
}

/**
 * Waar hoort een dag die nu bij een (te lange) trip staat? Bevestigt zijn vaste import-id de trip waar hij nu staat, dan
 * blijft hij. Anders de trip uit het id (of, als die verwijderd is en opnieuw geïmporteerd, de nieuwe), of uit de
 * back-up die Olivier koos. Alleen een bestaande andere trip telt. De geschiedenis telt hier niet: een dag die Olivier
 * zelf verplaatste, of een terugzetten dat iets juist terugzette, ziet er daar hetzelfde uit.
 */
function evidenceFor(leg: Leg, live: ReadonlySet<string>, recreated: ReadonlyMap<string, string>, backup?: BackupLinks): { to: string; why: LegMove['why'] } | null {
  const fromId = importTripOf(leg.id)
  if (fromId === leg.tripId) return null
  if (fromId) {
    const target = live.has(fromId) ? fromId : recreated.get(fromId)
    if (target && target !== leg.tripId && live.has(target)) return { to: target, why: 'import' }
  }
  const saved = backup?.legTrip.get(leg.id)
  if (saved && saved !== leg.tripId && live.has(saved)) return { to: saved, why: 'back-up' }
  return null
}

/**
 * Het herstelplan: wat verkeerd gekoppeld is en hoe het terug gaat. Rekent alleen. `backup`: koppelingen uit een
 * back-up die Olivier koos, als extra bewijs (een dag of deelnemer gaat alleen terug naar een trip die er nog is).
 */
export function planLinkRepair(reader: Reader, now = new Date().toISOString(), backup?: BackupLinks): LinkRepairPlan {
  const allTrips = reader.get('trips.json.enc')
  const trips = active(allTrips)
  const live = new Set(trips.map((t) => t.id))
  const allLegs = reader.get('legs.json.enc')
  const legs = active(allLegs)
  const entries = recentEntries(reader, now)
  const recreated = recreatedTrips(reader)

  // 1. Dagen: alleen weg uit een trip die te lang is geworden, en alleen naar een trip waar ze volgens hun id horen.
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
    const ev = evidenceFor(leg, live, recreated, backup)
    if (ev) legMoves.push({ leg, from: leg.tripId, to: ev.to, why: ev.why })
  }
  // De dagen zoals ze worden: daarop rekenen de datums.
  const moveOf = new Map(legMoves.map((m) => [m.leg.id, m.to]))
  const nextLegs: Leg[] = allLegs.map((l) => (moveOf.has(l.id) ? { ...l, tripId: moveOf.get(l.id)! } : l))

  // 2. Deelnemers die dubbel staan.
  const students = reader.get('students.json.enc')
  const dupes = duplicateParticipants(trips, students, backup, participantHistory(entries))

  // 3. Trips: datums terug naar de eigen dagen; trips die de dagen volgen, weer gelijk aan hun dagen.
  const touched = new Set([...legMoves.map((m) => m.from), ...legMoves.map((m) => m.to)])
  const chosen = datesChosen(reader)
  const tripFixes: TripFix[] = []
  for (const trip of trips) {
    let dates = stretchedDates(trip, nextLegs, trips, chosen)
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

  // 4. Deelnemers van een trip die samengevoegd werd en na opnieuw importeren onder een nieuw id terugkwam: van de
  //    samengevoegde trip naar de nieuwe (de verwijderde trip noemt ze nog in zijn lijst).
  const holderOf = (pid: string) => [...nextTrips.values()].filter((t) => (t.participants ?? []).some((p) => p.id === pid)).map((t) => t.id)
  const participantMoves: ParticipantMove[] = []
  for (const [oldId, newId] of recreated) {
    const old = allTrips.find((t) => t.id === oldId)
    if (!old || !nextTrips.has(newId)) continue
    for (const p of old.participants ?? []) {
      const at = holderOf(p.id)
      if (at.length !== 1 || at[0] === newId) continue
      participantMoves.push({ participant: p, from: at[0]!, to: newId })
      const from = nextTrips.get(at[0]!)!
      nextTrips.set(from.id, { ...from, participants: (from.participants ?? []).filter((x) => x.id !== p.id) })
      const to = nextTrips.get(newId)!
      nextTrips.set(newId, { ...to, participants: [...(to.participants ?? []), p] })
    }
  }

  // 5. Studenten: bij de trip waar hun deelnemer (nu nog één keer) staat.
  const holder = new Map<string, string[]>()
  for (const t of nextTrips.values()) for (const p of t.participants ?? []) holder.set(p.id, [...(holder.get(p.id) ?? []), t.id])
  const studentMoves: StudentMove[] = []
  for (const s of active(students)) {
    const at = holder.get(s.id)
    // Alleen een student die aan een andere trip hangt dan zijn deelnemer (een oudere student zonder weekId hoort bij
    // de trip van zijn begindatum en blijft zo).
    if (!at || at.length !== 1 || !s.weekId || s.archivedAt) continue
    if (s.weekId !== at[0]) studentMoves.push({ student: s, from: s.weekId, to: at[0]! })
  }

  // 6. Deelnemers in de prullenbak (verwijderd uit een trip waar ze verkeerd stonden): terug naar hun eigen trip.
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
        if (!alreadyHome.some((h) => h.participant.id === p.id)) alreadyHome.push({ participant: p, at: now[0]! })
        continue
      }
      const home = studentTrip.get(p.id) ?? backup?.participantTrip.get(p.id)
      if (home && home !== change.id && nextTrips.has(home) && !back.some((b) => b.participant.id === p.id)) back.push({ participant: p, from: change.id, to: home })
    }
  }

  // Nog lang na herstel (zonder bewijs om iets te verplaatsen): alleen ter informatie.
  const stillLong = [...nextTrips.values()].filter((t) => {
    const r = legRange(t.id, nextLegs)
    return !!r && spanDays(r.start, r.end) > LONG_TRIP_DAYS && active(nextLegs).some((l) => l.tripId === t.id && l.source === 'import')
  })

  return { legs: legMoves, trips: tripFixes, moves: participantMoves, students: studentMoves, participants: back, alreadyHome, stillLong }
}

/**
 * Na terugzetten uit de prullenbak: de trips die bij samenvoegen of vervangen de datums of deelnemers van de
 * teruggezette trip kregen, weer zonder. Gevonden op bewijs, niet op tijd: een trip met een van de deelnemers van de
 * teruggezette trip (een deelnemer hoort bij één trip; de lijst van de teruggezette is van vóór het samenvoegen), of
 * met datums met het kenmerk van samenvoegen over de dagen van de teruggezette trip heen.
 */
export function untangleSurvivors(reader: Reader, restored: Trip): TripFix[] {
  const legs = reader.get('legs.json.enc')
  const trips = active(reader.get('trips.json.enc'))
  const theirs = new Set((restored.participants ?? []).map((p) => p.id))
  const own = legRange(restored.id, legs)
  const chosen = datesChosen(reader)
  const fixes: TripFix[] = []
  for (const trip of trips) {
    if (trip.id === restored.id) continue
    const removed = (trip.participants ?? []).filter((p) => theirs.has(p.id))
    const overDays = !!own && !!trip.startDate && !!trip.endDate && trip.startDate <= own.end && trip.endDate >= own.start
    const dates = overDays ? stretchedDates(trip, legs, trips, chosen) : null
    if (!dates && removed.length === 0) continue
    let next: Trip = dates ? withDates(trip, dates.after) : { ...trip }
    if (removed.length > 0) next = { ...next, participants: (trip.participants ?? []).filter((p) => !theirs.has(p.id)) }
    fixes.push({ trip, next, ...(dates ? { dates } : {}), removedParticipants: removed })
  }
  return fixes
}

export interface LongTrip {
  trip: Trip
  start: string
  end: string
  days: number
}

/** Een geïmporteerde trip die langer loopt dan `LONG_TRIP_DAYS` (Nakijken en Gezondheid). */
export function longImportTrips(reader: Reader): LongTrip[] {
  return longImportTripsOf(reader.get('trips.json.enc'), reader.get('legs.json.enc'))
}

export function longImportTripsOf(allTrips: readonly Trip[], allLegs: readonly Leg[]): LongTrip[] {
  const legs = active(allLegs)
  const out: LongTrip[] = []
  for (const trip of active(allTrips)) {
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


/** Vergelijking met een back-up (alleen lezen): wat er nu anders gekoppeld is dan toen. */
export interface BackupComparison {
  /** Trips (in beide) met nu een ander begin of eind. */
  ranges: Array<{ trip: Trip; then: { start: string; end: string } | null; now: { start: string; end: string } | null }>
  /** Dagen (in beide) die nu bij een andere trip staan. */
  legs: number
  /** Deelnemers (in beide) die nu bij een andere trip staan, of erbij kwamen in een tweede trip. */
  participants: number
}

export function compareWithBackup(reader: Reader, files: ReadonlyMap<string, readonly SyncRecordLike[]>): BackupComparison {
  const thenTrips = new Map(((files.get('trips.json.enc') ?? []) as unknown as Trip[]).filter((t) => t.deletedAt === null).map((t) => [t.id, t]))
  const thenLegs = ((files.get('legs.json.enc') ?? []) as unknown as Leg[]).filter((l) => l.deletedAt === null)
  const nowLegs = reader.get('legs.json.enc')
  const range = (trip: Trip, legs: readonly Leg[]) => {
    const r = legRange(trip.id, legs)
    const start = trip.startDate ?? r?.start
    const end = trip.endDate ?? r?.end
    return start && end ? { start, end } : null
  }
  const ranges: BackupComparison['ranges'] = []
  for (const trip of active(reader.get('trips.json.enc'))) {
    const then = thenTrips.get(trip.id)
    if (!then) continue
    const a = range(then, thenLegs)
    const b = range(trip, nowLegs)
    if (a?.start !== b?.start || a?.end !== b?.end) ranges.push({ trip, then: a, now: b })
  }
  const links = backupLinks(files)
  const legs = active(nowLegs).filter((l) => links.legTrip.has(l.id) && links.legTrip.get(l.id) !== l.tripId).length
  let participants = 0
  for (const trip of active(reader.get('trips.json.enc'))) for (const p of trip.participants ?? []) if (links.participantTrip.has(p.id) && links.participantTrip.get(p.id) !== trip.id) participants++
  return { ranges, legs, participants }
}
