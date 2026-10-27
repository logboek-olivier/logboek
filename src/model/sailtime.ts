import { parseShip } from './boats'
import { active, compareLegs, round1, totalNm } from './derive'
import { ROLES, type Leg, type Role, type Trip } from './types'

// Export van de zeiltijd (RYA/ASA-stijl): per dag of per trip met boot, model, lengte, rol, nm, nachturen en
// getijdenwater, plus totalen per rol. Filter op periode en rol. Afdrukken als PDF gaat via de printfunctie.

export interface SailtimeFilter {
  /** jjjj-mm-dd, inclusief; leeg = geen grens. */
  from: string
  to: string
  role: Role | ''
}

export interface BoatInfo {
  boat: string
  model: string
  lengthFt?: number
}

export interface DayRow extends BoatInfo {
  id: string
  date: string
  role: Role
  route: string
  nm: number
  tidal: number
  night: number
}

export interface TripRow extends BoatInfo {
  id: string
  name: string
  start: string
  end: string
  roles: Role[]
  days: number
  nm: number
  tidal: number
  night: number
}

export interface RoleTotal {
  role: Role
  days: number
  nm: number
  tidal: number
  night: number
}

export interface Sailtime {
  days: DayRow[]
  trips: TripRow[]
  totals: RoleTotal[]
  total: Omit<RoleTotal, 'role'>
}

/** Boot, model en lengte van een dag: uit de trip, anders uit de kolom Schip van de dag. */
export function boatInfo(leg: Leg, trip: Trip | undefined): BoatInfo {
  const ship = parseShip(leg.boat)
  return {
    boat: trip?.boat || ship.name || (ship.model ? '' : leg.boat),
    model: trip?.boatModel || ship.model,
    ...(trip?.boatLengthFt ? { lengthFt: trip.boatLengthFt } : {}),
  }
}

export function sailtime(trips: readonly Trip[], legs: readonly Leg[], filter: SailtimeFilter): Sailtime {
  const byId = new Map(active(trips).map((t) => [t.id, t]))
  const chosen = active(legs)
    .filter((l) => (!filter.from || l.date >= filter.from) && (!filter.to || l.date <= filter.to) && (!filter.role || l.role === filter.role))
    .sort(compareLegs)
  const days: DayRow[] = chosen.map((l) => ({
    id: l.id,
    date: l.date,
    role: l.role,
    route: [l.fromPlace, l.toPlace].filter(Boolean).join(' → '),
    nm: totalNm(l),
    tidal: l.nmTidal,
    night: l.nightHours,
    ...boatInfo(l, byId.get(l.tripId)),
  }))
  const tripRows = new Map<string, TripRow>()
  for (const [i, l] of chosen.entries()) {
    const row = days[i]!
    const trip = byId.get(l.tripId)
    const existing = tripRows.get(l.tripId)
    if (existing) {
      existing.end = l.date
      existing.days++
      existing.nm = round1(existing.nm + row.nm)
      existing.tidal = round1(existing.tidal + row.tidal)
      existing.night = round1(existing.night + row.night)
      if (!existing.roles.includes(l.role)) existing.roles.push(l.role)
    } else {
      tripRows.set(l.tripId, {
        id: l.tripId,
        name: trip?.name ?? '',
        start: l.date,
        end: l.date,
        roles: [l.role],
        days: 1,
        nm: row.nm,
        tidal: row.tidal,
        night: row.night,
        boat: row.boat,
        model: row.model,
        ...(row.lengthFt ? { lengthFt: row.lengthFt } : {}),
      })
    }
  }
  const totals: RoleTotal[] = ROLES.map((role) => {
    const own = days.filter((d) => d.role === role)
    return { role, days: own.length, nm: round1(own.reduce((n, d) => n + d.nm, 0)), tidal: round1(own.reduce((n, d) => n + d.tidal, 0)), night: round1(own.reduce((n, d) => n + d.night, 0)) }
  }).filter((r) => r.days > 0)
  const total = {
    days: days.length,
    nm: round1(days.reduce((n, d) => n + d.nm, 0)),
    tidal: round1(days.reduce((n, d) => n + d.tidal, 0)),
    night: round1(days.reduce((n, d) => n + d.night, 0)),
  }
  return { days, trips: [...tripRows.values()], totals, total }
}
