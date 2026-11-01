import { active } from './derive'
import { weekView } from './weeks'
import type { Leg, Trip } from './types'

// Bij welke trip hoort een gelogde dag? De datums van een trip zijn gewone velden (CLAUDE.md, uitgangspunt 2): een dag
// verandert ze nooit. Koos Olivier de trip zelf, dan komt de dag daar, ook buiten de datums. Anders de trip waarin de
// datum valt, en anders een nieuwe trip (met die dag als begin en eind). De app verlengt of verkort nooit een trip.

export interface LegPlacement {
  /** De trip van de dag; null = een nieuwe trip. */
  tripId: string | null
  /** De voorgevulde trip past niet bij de datum: de dag gaat naar de trip van die datum, of een nieuwe trip. */
  moved?: boolean
}

/**
 * De trip voor een dag op `date`, uitgaande van de gekozen trip (null = nieuwe trip):
 * 1. de gekozen trip als Olivier hem zelf koos (`explicit`), of als de datum erin valt;
 * 2. anders de trip waarin de datum valt (bij een wisseldag de laatst begonnen);
 * 3. anders een nieuwe trip.
 */
export function placeLeg(trips: readonly Trip[], legs: readonly Leg[], chosenId: string | null, date: string, explicit = false): LegPlacement {
  const live = active(trips)
  const chosen = chosenId ? live.find((x) => x.id === chosenId) : undefined
  if (chosen && explicit) return { tripId: chosen.id }
  const inside = (v: { startDate?: string; endDate?: string }) => !!v.startDate && !!v.endDate && v.startDate <= date && date <= v.endDate
  if (chosen && inside(weekView(chosen, legs))) return { tripId: chosen.id }
  const containing = live
    .map((trip) => weekView(trip, legs))
    .filter(inside)
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))
    .at(-1)
  if (containing) return { tripId: containing.trip.id, ...(chosen ? { moved: true } : {}) }
  return { tripId: null, ...(chosen ? { moved: true } : {}) }
}

/** De dagen van een trip binnen zijn datums; dagen erbuiten staan apart op de pagina (alleen ter informatie). */
export function splitLegs(trip: Trip, legs: readonly Leg[]): { inside: Leg[]; outside: Leg[] } {
  const own = legs.filter((l) => l.tripId === trip.id && l.deletedAt === null)
  // Een trip zonder datums (van vóór november 2026) toont gewoon al zijn dagen.
  if (!trip.startDate || !trip.endDate) return { inside: own, outside: [] }
  return { inside: own.filter((l) => l.date >= trip.startDate! && l.date <= trip.endDate!), outside: own.filter((l) => l.date < trip.startDate! || l.date > trip.endDate!) }
}
