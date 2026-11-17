import type { Tx } from '../domain/tx'
import { addDays } from '../basis/datum'
import { organisationOfTrip } from '../basis/organisatie'
import { claimKind } from './claims'
import { introDaysBefore, markMessage, messageDefaultsOf } from './messages'
import { livePlans } from './plans'
import { tripKind } from './trip-kind'
import type { Claim, Leg, Settings, Transaction, Trip, WeekPlan } from './types'
import { isTeachingTrip, planWeek } from './weeks'

// Vandaag doen: de weektaken van een werktrip, elk op een vaste dag ten opzichte van de start of het einde. De taken
// worden uitgerekend uit de trips (er wordt niets opgeslagen tot Olivier tikt); alleen "gedaan" of "niet nodig" staat
// op de trip (`tasks`, de berichten in `messages`). Een taak komt op Vandaag op zijn dag en blijft daarna staan (te
// laat) tot hij gedaan is, hoogstens twee weken. Veel taken zijn vanzelf gedaan als de actie gedaan is: een bericht dat
// verstuurd is, een lesplanning bij de trip, een fooi bij de trip, een afgeronde trip, ingediende declaraties.

export const WEEK_TASKS = ['introductie', 'boodschappen', 'lesplanning', 'safety', 'afsluiting', 'fooi', 'afronden', 'declaraties'] as const
export type WeekTaskKind = (typeof WEEK_TASKS)[number]

/** Taken die een bericht zijn: gedaan = verstuurd of niet nodig in `trip.messages` (zelfde vinkje als het blok Berichten). */
export const MESSAGE_TASKS = ['introductie', 'boodschappen', 'afsluiting'] as const
export type MessageTaskKind = (typeof MESSAGE_TASKS)[number]

export function isMessageTask(kind: WeekTaskKind): kind is MessageTaskKind {
  return (MESSAGE_TASKS as readonly string[]).includes(kind)
}

/** Hoe lang een taak die niet gedaan is, na zijn dag nog op Vandaag staat (te laat). */
export const LATE_DAYS = 14

export interface TaskData {
  trips: readonly Trip[]
  legs: readonly Leg[]
  plans: readonly WeekPlan[]
  transactions: readonly Transaction[]
  claims: readonly Claim[]
  settings: Pick<Settings, 'messageDefaults'>
}

export type TaskDone = 'gedaan' | 'verstuurd' | 'niet-nodig' | 'vanzelf'

export interface WeekTask {
  kind: WeekTaskKind
  trip: Trip
  /** De dag waarop de taak op Vandaag komt (jjjj-mm-dd). */
  date: string
  /** Null = nog te doen. */
  done: TaskDone | null
  /** De datum van de tik (bij gedaan, verstuurd of niet nodig). */
  doneDate?: string
}

/** De dag van een taak bij een trip met datums. */
export function taskDate(kind: WeekTaskKind, trip: Pick<Trip, 'startDate' | 'endDate'> & Partial<Trip>, settings: Pick<Settings, 'messageDefaults'>): string {
  const start = trip.startDate!
  const end = trip.endDate!
  switch (kind) {
    case 'introductie':
      return addDays(start, -introDaysBefore(settings, organisationOfTrip(trip as Trip)))
    case 'boodschappen':
      return addDays(start, -2)
    case 'lesplanning':
      return addDays(start, -1)
    case 'safety':
      return start
    case 'afsluiting':
    case 'fooi':
      return end
    case 'afronden':
    case 'declaraties':
      return addDays(end, 1)
  }
}

/** Weektaken die bij een organisatie uit staan (Instellingen → Organisaties). */
export function tasksOff(settings: Pick<Settings, 'messageDefaults'>, organisation: string): ReadonlySet<string> {
  return new Set(messageDefaultsOf(settings, organisation).tasksOff ?? [])
}

function autoDone(kind: WeekTaskKind, trip: Trip, data: TaskData): boolean {
  switch (kind) {
    case 'lesplanning':
      return livePlans(data.plans).some((p) => planWeek(p, data.trips, data.legs) === trip.id)
    case 'fooi':
      return data.transactions.some((tx) => tx.deletedAt === null && tx.kind === 'fooi' && tx.tripId === trip.id)
    case 'afronden':
      return !!trip.closedAt
    case 'declaraties': {
      const own = data.claims.filter((c) => c.deletedAt === null && c.tripId === trip.id && claimKind(c) === 'declaratie')
      return own.length > 0 && own.every((c) => c.status !== 'open')
    }
    default:
      return false
  }
}

/** Alle weektaken van één trip (gedaan of niet), in de volgorde van de week. Alleen werk met een start- en einddatum. */
export function weekTasksOf(trip: Trip, data: TaskData): WeekTask[] {
  if (trip.deletedAt !== null || !trip.startDate || !trip.endDate) return []
  if (tripKind(trip, data.legs).kind !== 'werk') return []
  const off = tasksOff(data.settings, organisationOfTrip(trip))
  const out: WeekTask[] = []
  for (const kind of WEEK_TASKS) {
    if (off.has(kind)) continue
    if (kind === 'lesplanning' && !isTeachingTrip(trip)) continue
    const date = taskDate(kind, trip, data.settings)
    const mark = isMessageTask(kind) ? trip.messages?.[kind] : trip.tasks?.[kind]
    if (mark) out.push({ kind, trip, date, done: mark.status, doneDate: mark.date })
    else out.push({ kind, trip, date, done: autoDone(kind, trip, data) ? 'vanzelf' : null })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || WEEK_TASKS.indexOf(a.kind) - WEEK_TASKS.indexOf(b.kind))
}

function byDate(a: WeekTask, b: WeekTask): number {
  return a.date.localeCompare(b.date) || (a.trip.startDate ?? '').localeCompare(b.trip.startDate ?? '') || WEEK_TASKS.indexOf(a.kind) - WEEK_TASKS.indexOf(b.kind)
}

/** De open weektaken van alle trips met een dag in [van, tot]. */
export function openTasksBetween(data: TaskData, from: string, to: string): WeekTask[] {
  const out: WeekTask[] = []
  for (const trip of data.trips) for (const task of weekTasksOf(trip, data)) if (task.done === null && task.date >= from && task.date <= to) out.push(task)
  return out.sort(byDate)
}

/** Vandaag doen: open taken van vandaag en de te late (hoogstens twee weken), oudste eerst. */
export function todayTasks(data: TaskData, today: string): WeekTask[] {
  return openTasksBetween(data, addDays(today, -LATE_DAYS), today)
}

/** Te laat: de dag van de taak is voorbij. */
export function isLate(task: Pick<WeekTask, 'date'>, today: string): boolean {
  return task.date < today
}

/**
 * Een weektaak afvinken (gedaan of niet nodig; null = weer open). Een bericht gebruikt het vinkje van het blok Berichten
 * (gedaan = verstuurd), zodat beide plekken hetzelfde laten zien.
 */
export async function markTask(tx: Tx, tripId: string, kind: WeekTaskKind, status: 'gedaan' | 'niet-nodig' | null, date: string): Promise<void> {
  if (isMessageTask(kind)) return markMessage(tx, tripId, kind, status === 'gedaan' ? 'verstuurd' : status, date)
  const trip = tx.get('trips.json.enc').find((t) => t.id === tripId && t.deletedAt === null)
  if (!trip) throw new Error('Trip bestaat niet')
  const marks = { ...(trip.tasks ?? {}) }
  if (status) marks[kind] = { status, date }
  else delete marks[kind]
  await tx.put('trips.json.enc', { ...trip, tasks: marks, updatedAt: tx.now })
}
