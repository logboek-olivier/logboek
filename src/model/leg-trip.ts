import { active } from './derive'
import { datesFollowDays } from './trip-dates'
import { daysBetween } from './calendar'
import { weekView } from './weeks'
import type { Leg, Trip } from './types'

// Bij welke trip hoort een gelogde dag? Een dag ligt altijd binnen de datums van zijn trip (docs/PERIODEMODEL.md). Zo kon
// een dag van 28 oktober in SV #1 (18–24 oktober) terechtkomen: een oude "lopende trip" of een trip die vanaf het
// tripscherm was meegegeven, won van de trip van die datum.

/** Zoveel dagen naast een trip met vaste datums mag een dag hem verlengen; verder weg hoort de dag niet bij die trip. */
export const LEG_EXTEND_DAYS = 3

export interface LegPlacement {
  /** De trip van de dag; null = een nieuwe trip (de datums volgen de dagen). */
  tripId: string | null
  /** De gekozen trip wordt verlengd tot deze datums. */
  extend?: { start: string; end: string }
  /** De gekozen trip kon niet (de datum valt erbuiten): de dag gaat naar een andere trip of een nieuwe. */
  moved?: boolean
}

/**
 * De trip voor een dag op `date`, uitgaande van de gekozen trip (null = nieuwe trip):
 * 1. de gekozen trip als de datum erin valt, of als hij zijn dagen volgt;
 * 2. anders de trip waarin de datum valt (bij een wisseldag de laatst begonnen);
 * 3. anders de gekozen trip verlengd, als de datum hoogstens drie dagen ernaast ligt;
 * 4. anders een nieuwe trip.
 */
export function placeLeg(trips: readonly Trip[], legs: readonly Leg[], chosenId: string | null, date: string): LegPlacement {
  const live = active(trips)
  const chosen = chosenId ? live.find((x) => x.id === chosenId) : undefined
  const views = live.map((trip) => weekView(trip, legs)).filter((v) => v.startDate && v.endDate)
  const inside = (v: { startDate: string; endDate: string }) => v.startDate <= date && date <= v.endDate
  const chosenView = chosen ? weekView(chosen, legs) : null
  if (chosen && (datesFollowDays(chosen) || (chosenView && inside(chosenView)))) return { tripId: chosen.id }
  const containing = views.filter(inside).sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).at(-1)
  if (containing) return { tripId: containing.trip.id, ...(chosen ? { moved: true } : {}) }
  if (chosen && chosenView?.startDate && chosenView.endDate) {
    const gap = date < chosenView.startDate ? daysBetween(date, chosenView.startDate) : daysBetween(chosenView.endDate, date)
    if (gap <= LEG_EXTEND_DAYS) return { tripId: chosen.id, extend: { start: date < chosenView.startDate ? date : chosenView.startDate, end: date > chosenView.endDate ? date : chosenView.endDate } }
  }
  return { tripId: null, ...(chosen ? { moved: true } : {}) }
}

/** De dagen van een trip binnen zijn datums; dagen erbuiten staan apart (Nakijken, en een melding op de pagina). */
export function splitLegs(trip: Trip, legs: readonly Leg[]): { inside: Leg[]; outside: Leg[] } {
  const own = legs.filter((l) => l.tripId === trip.id && l.deletedAt === null)
  // Alleen een trip met eigen datums: die van Toevoegen → Dag volgt zijn dagen.
  if (trip.datesFromDays || !trip.startDate || !trip.endDate) return { inside: own, outside: [] }
  return { inside: own.filter((l) => l.date >= trip.startDate! && l.date <= trip.endDate!), outside: own.filter((l) => l.date < trip.startDate! || l.date > trip.endDate!) }
}
