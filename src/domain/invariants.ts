import { isDate } from '../basis/datum'
import { currentSettings } from '../model/settings'
import type { CollectionPath } from '../model/types'
import type { Reader } from './tx'

// Invarianten als code (docs/FUNDERING.md). Twee soorten:
// - "fout": mag nooit ontstaan. Een opdracht die er een nieuwe maakt, schrijft niets (src/domain/commit.ts). Bestaat er
//   al een (van een oudere versie, of twee apparaten die tegelijk iets deden), dan staat hij in de gezondheidscheck.
// - "nakijken": een toestand die kan bestaan (een dag zonder trip na "Geld en dagen behouden"), maar die Olivier moet
//   zien. In de gezondheidscheck (Meer → Opslag → Gezondheid), met een fix van één tik waar dat kan.

export type Rule =
  | 'datum'
  | 'getal'
  | 'trip-datums'
  | 'dag-zonder-trip'
  | 'geld-zonder-periode'
  | 'salaris-zonder-inkomen'
  | 'lopende-trip-weg'
  | 'student-zonder-trip'

export interface Violation {
  /** Vast per overtreding: zo is te zien of een opdracht er een nieuwe maakt. */
  key: string
  rule: Rule
  severity: 'fout' | 'nakijken'
  path: CollectionPath
  id: string
  /** Voor een tweede record in de overtreding (overlap). */
  other?: string
}

const HARD: ReadonlySet<Rule> = new Set(['datum', 'getal', 'trip-datums'])

function v(rule: Rule, path: CollectionPath, id: string, other?: string): Violation {
  return { key: `${rule}:${path}:${id}${other ? `:${other}` : ''}`, rule, severity: HARD.has(rule) ? 'fout' : 'nakijken', path, id, ...(other ? { other } : {}) }
}

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

/** Alle overtredingen in de data (alleen niet-verwijderde records). */
export function violations(reader: Reader): Violation[] {
  const out: Violation[] = []
  const trips = reader.list('trips.json.enc')
  const legs = reader.list('legs.json.enc')
  const money = reader.list('transactions.json.enc')
  const stays = reader.list('periods.json.enc')
  const live = new Set(trips.map((t) => t.id))
  const periodIds = new Set([...trips.map((t) => t.id), ...stays.map((s) => s.id)])
  const byTrip = new Map<string, typeof legs>()
  for (const leg of legs) byTrip.set(leg.tripId, [...(byTrip.get(leg.tripId) ?? []), leg])

  for (const leg of legs) {
    if (!isDate(leg.date)) out.push(v('datum', 'legs.json.enc', leg.id))
    if (![leg.nmInland, leg.nmSea, leg.nmTidal, leg.nightHours].every((n) => finite(n) && n >= 0)) out.push(v('getal', 'legs.json.enc', leg.id))
    if (!live.has(leg.tripId)) out.push(v('dag-zonder-trip', 'legs.json.enc', leg.id))
  }
  for (const trip of trips) {
    if ((trip.startDate && !isDate(trip.startDate)) || (trip.endDate && !isDate(trip.endDate))) out.push(v('datum', 'trips.json.enc', trip.id))
    else if (trip.startDate && trip.endDate && trip.startDate > trip.endDate) out.push(v('trip-datums', 'trips.json.enc', trip.id))
    const salary = trip.salary
    if (salary?.status === 'ontvangen' && salary.transactionId && !money.some((tx) => tx.id === salary.transactionId)) out.push(v('salaris-zonder-inkomen', 'trips.json.enc', trip.id))
  }
  for (const tx of money) {
    if (!isDate(tx.date)) out.push(v('datum', 'transactions.json.enc', tx.id))
    if (!(finite(tx.amount) && tx.amount > 0)) out.push(v('getal', 'transactions.json.enc', tx.id))
    if (!tx.claimId && !tx.fixedCostId && !(tx.tripId && periodIds.has(tx.tripId))) out.push(v('geld-zonder-periode', 'transactions.json.enc', tx.id))
  }
  for (const stay of stays) if (!isDate(stay.startDate) || !isDate(stay.endDate) || stay.startDate > stay.endDate) out.push(v('datum', 'periods.json.enc', stay.id))
  for (const student of reader.list('students.json.enc')) if (student.weekId && !live.has(student.weekId) && !student.archivedAt) out.push(v('student-zonder-trip', 'students.json.enc', student.id))
  const settings = currentSettings(reader.list('settings.json.enc'))
  if (settings.activeWeekId && !live.has(settings.activeWeekId)) out.push(v('lopende-trip-weg', 'settings.json.enc', 'settings'))
  return out
}

/** Alleen de overtredingen die nooit mogen ontstaan. */
export function hardViolations(reader: Reader): Violation[] {
  return violations(reader).filter((x) => x.severity === 'fout')
}

/** Een opdracht wilde iets schrijven dat een invariant breekt; er is niets geschreven. */
export class InvariantError extends Error {
  constructor(
    readonly broken: readonly Violation[],
    /** De opdracht die werd tegengehouden (alleen de naam, nooit inhoud; regel 9). */
    readonly command = '',
  ) {
    super(`Invariant: ${broken.map((b) => b.rule).join(', ')}${command ? ` (${command})` : ''}`)
    this.name = 'InvariantError'
  }
}

/** Alle nieuwe overtredingen na een opdracht, ook om na te kijken (voor wat vanzelf draait: src/domain/relaties.ts). */
export function newViolations(before: Reader, after: Reader): Violation[] {
  const known = new Set(violations(before).map((x) => x.key))
  return violations(after).filter((x) => !known.has(x.key))
}

/** Nieuwe harde overtredingen na een opdracht (wat er vooraf al was, telt niet: dat staat in de gezondheidscheck). */
export function newHardViolations(before: Reader, after: Reader): Violation[] {
  const known = new Set(hardViolations(before).map((x) => x.key))
  return hardViolations(after).filter((x) => !known.has(x.key))
}
