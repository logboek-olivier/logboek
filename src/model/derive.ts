import type { Leg, Role, Trip } from './types'
import { ROLES } from './types'

// Afgeleide getallen uit legs en trips. Alleen niet-verwijderde records tellen mee.

export function totalNm(leg: Pick<Leg, 'nmInland' | 'nmSea' | 'nmTidal'>): number {
  return round1(leg.nmInland + leg.nmSea + leg.nmTidal)
}

export interface WaterTotals {
  inland: number
  sea: number
  tidal: number
}

export interface SailingSummary {
  days: number
  trips: number
  nm: number
  nmByRole: Record<Role, number>
  nmByWater: WaterTotals
  nightHours: number
}

export function active<T extends { deletedAt: string | null }>(records: readonly T[]): T[] {
  return records.filter((r) => r.deletedAt === null)
}

export function summarize(legs: readonly Leg[]): SailingSummary {
  const live = active(legs)
  const nmByRole = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>
  const nmByWater: WaterTotals = { inland: 0, sea: 0, tidal: 0 }
  let nm = 0
  let nightHours = 0
  const tripIds = new Set<string>()
  for (const leg of live) {
    const t = totalNm(leg)
    nm += t
    nmByRole[leg.role] += t
    nmByWater.inland += leg.nmInland
    nmByWater.sea += leg.nmSea
    nmByWater.tidal += leg.nmTidal
    nightHours += leg.nightHours
    tripIds.add(leg.tripId)
  }
  for (const r of ROLES) nmByRole[r] = round1(nmByRole[r])
  return {
    days: live.length,
    trips: tripIds.size,
    nm: round1(nm),
    nmByRole,
    nmByWater: { inland: round1(nmByWater.inland), sea: round1(nmByWater.sea), tidal: round1(nmByWater.tidal) },
    nightHours: round1(nightHours),
  }
}

export function nmInYear(legs: readonly Leg[], year: number): number {
  const prefix = `${year}-`
  return round1(active(legs).filter((l) => l.date.startsWith(prefix)).reduce((n, l) => n + totalNm(l), 0))
}

export interface TripSummary {
  trip: Trip
  startDate: string
  endDate: string
  boat: string
  nm: number
  days: number
  legs: Leg[]
}

/** Per tocht: datums, boot en totalen uit de legs; tochten zonder legs vallen weg. Nieuwste eerst. */
export function summarizeTrips(trips: readonly Trip[], legs: readonly Leg[]): TripSummary[] {
  const byTrip = new Map<string, Leg[]>()
  for (const leg of active(legs)) {
    const list = byTrip.get(leg.tripId) ?? []
    list.push(leg)
    byTrip.set(leg.tripId, list)
  }
  const result: TripSummary[] = []
  for (const trip of active(trips)) {
    const tripLegs = (byTrip.get(trip.id) ?? []).sort(compareLegs)
    if (tripLegs.length === 0) continue
    result.push({
      trip,
      startDate: tripLegs[0]!.date,
      endDate: tripLegs[tripLegs.length - 1]!.date,
      boat: tripLegs[tripLegs.length - 1]!.boat,
      nm: round1(tripLegs.reduce((n, l) => n + totalNm(l), 0)),
      days: tripLegs.length,
      legs: tripLegs,
    })
  }
  return result.sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0))
}

export function lastTrip(trips: readonly Trip[], legs: readonly Leg[]): TripSummary | null {
  return summarizeTrips(trips, legs)[0] ?? null
}

/** Tocht waar een datum in valt (begin- en einddatum inclusief), of null. */
export function tripForDate(trips: readonly Trip[], legs: readonly Leg[], date: string): Trip | null {
  const match = summarizeTrips(trips, legs).find((t) => t.startDate <= date && date <= t.endDate)
  return match?.trip ?? null
}

export function compareLegs(a: Leg, b: Leg): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
