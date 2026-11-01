import type { Reader } from '../../src/domain/tx'
import { tripRange } from '../../src/model/calendar'
import { active } from '../../src/model/derive'

// Alle relaties van een logboek, los van id's en volgorde: welke dag bij welke trip, begin en eind per trip, welke
// deelnemers per trip en bij welke trip elke student hoort. Na een migratie of herstel moeten ze gelijk zijn.

export interface Relations {
  legs: string[]
  ranges: string[]
  participants: string[]
  students: string[]
}

export function relations(s: Reader): Relations {
  const trips = new Map(s.get('trips.json.enc').map((t) => [t.id, t]))
  const name = (id: string | null | undefined) => {
    const trip = id ? trips.get(id) : undefined
    return trip ? (trip.deletedAt === null ? trip.name : `WEG:${trip.name}`) : '?'
  }
  const legs = active(s.get('legs.json.enc'))
    .map((l) => `${l.date}|${l.fromPlace}|${l.toPlace}|${l.nmInland + l.nmSea + l.nmTidal} → ${name(l.tripId)}`)
    .sort()
  const ranges = active(s.get('trips.json.enc'))
    .map((t) => {
      const r = tripRange(t, s.get('legs.json.enc'))
      return `${t.name}: ${r?.start ?? '-'} – ${r?.end ?? '-'}`
    })
    .sort()
  const participants = active(s.get('trips.json.enc'))
    .map((t) => `${t.name}: ${(t.participants ?? []).map((p) => p.firstName).sort().join(',')}`)
    .sort()
  const students = active(s.get('students.json.enc'))
    .map((x) => `${x.firstName} → ${name(x.weekId)}`)
    .sort()
  return { legs, ranges, participants, students }
}

/** Totalen die na een migratie gelijk moeten blijven. */
export function totals(s: Reader): { trips: number; legs: number; nm: number; participants: number; students: number } {
  const legs = active(s.get('legs.json.enc'))
  return {
    trips: active(s.get('trips.json.enc')).length,
    legs: legs.length,
    nm: Math.round(legs.reduce((n, l) => n + l.nmInland + l.nmSea + l.nmTidal, 0) * 10) / 10,
    participants: active(s.get('trips.json.enc')).reduce((n, t) => n + (t.participants?.length ?? 0), 0),
    students: active(s.get('students.json.enc')).length,
  }
}

/** Per transactie de periode (trip of periode aan land) waar hij aan hangt. */
export function moneyLinks(s: Reader): Map<string, string | null> {
  return new Map(active(s.get('transactions.json.enc')).map((tx) => [tx.id, tx.tripId ?? null]))
}
