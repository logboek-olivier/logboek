import { active, round1, totalNm } from './derive'
import type { Period } from './periods'
import type { Leg, PeriodKind } from './types'

// De lijst met periodes (Meer → Periodes): Nu · Komend · Afgelopen, komend en afgelopen per maand, met filters en
// zoeken op naam, boot, plaats of persoon. Alles staat erin, ook trips zonder gelogde dagen en periodes aan land.

export type PeriodFilter = 'alles' | 'werk' | 'training' | 'plezier' | 'land'
export const PERIOD_FILTERS: readonly PeriodFilter[] = ['werk', 'training', 'plezier', 'land', 'alles']

const LAND: readonly PeriodKind[] = ['reis', 'thuis', 'vrij']

export function matchesFilter(period: Period, filter: PeriodFilter): boolean {
  if (filter === 'alles') return true
  if (filter === 'land') return LAND.includes(period.kind)
  return period.kind === filter
}

function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Zoeken op naam, boot (naam en model), plaats (dagen, basis, gebied, reis) of persoon (voornaam van deelnemers). */
export function matchesSearch(period: Period, legs: readonly Leg[], query: string): boolean {
  const q = norm(query.trim())
  if (!q) return true
  const trip = period.view?.trip
  const own = trip ? legs.filter((l) => l.tripId === trip.id) : []
  const fields = [
    period.name,
    trip?.boat,
    trip?.boatModel,
    trip?.base,
    trip?.area,
    ...own.flatMap((l) => [l.fromPlace, l.toPlace, l.boat]),
    ...(trip?.participants ?? []).map((p) => p.firstName),
    period.stay?.travel?.from,
    period.stay?.travel?.to,
    period.note,
  ]
  return fields.some((f) => !!f && norm(f).includes(q))
}

export interface PeriodRow {
  period: Period
  nm: number
}

export interface MonthGroup {
  /** jjjj-mm (van de begindatum). */
  month: string
  rows: PeriodRow[]
}

export interface PeriodSections {
  now: PeriodRow[]
  upcoming: MonthGroup[]
  past: MonthGroup[]
  /** Trips zonder datums en zonder dagen. */
  undated: PeriodRow[]
}

function groupByMonth(rows: PeriodRow[], newestFirst: boolean): MonthGroup[] {
  const map = new Map<string, PeriodRow[]>()
  for (const row of rows) map.set(row.period.start.slice(0, 7), [...(map.get(row.period.start.slice(0, 7)) ?? []), row])
  const months = [...map.keys()].sort()
  if (newestFirst) months.reverse()
  return months.map((month) => ({ month, rows: map.get(month)! }))
}

/** De lijst: nu (de datum ligt erin, of de lopende trip), komend (eerstvolgende eerst), afgelopen (nieuwste eerst). */
export function periodSections(periods: readonly Period[], legs: readonly Leg[], today: string, runningId: string | null, filter: PeriodFilter, query: string): PeriodSections {
  const live = active(legs)
  const rows = periods
    .filter((p) => matchesFilter(p, filter) && matchesSearch(p, live, query))
    .map((period) => ({ period, nm: period.view ? round1(period.view.legs.reduce((n, l) => n + totalNm(l), 0)) : 0 }))
  const now: PeriodRow[] = []
  const upcoming: PeriodRow[] = []
  const past: PeriodRow[] = []
  const undated: PeriodRow[] = []
  for (const row of rows) {
    const { start, end, id } = row.period
    if (!start || !end) undated.push(row)
    else if (id === runningId || (start <= today && today <= end)) now.push(row)
    else if (start > today) upcoming.push(row)
    else past.push(row)
  }
  const byStart = (a: PeriodRow, b: PeriodRow) => (a.period.start < b.period.start ? -1 : a.period.start > b.period.start ? 1 : 0)
  return {
    now: now.sort(byStart),
    upcoming: groupByMonth(upcoming.sort(byStart), false),
    past: groupByMonth(past.sort((a, b) => byStart(b, a)), true),
    undated,
  }
}
