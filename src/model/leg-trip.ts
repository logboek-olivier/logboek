import { active } from './derive'
import { weekView } from './weeks'
import type { Leg, Trip } from './types'
import { daysBetween } from '../basis/datum'

// Bij welke trip hoort een gelogde dag? De datums van een trip zijn gewone velden (CLAUDE.md, uitgangspunt 2): een dag
// verandert ze nooit vanzelf. Koos Olivier de trip zelf, dan komt de dag daar, ook buiten de datums. Anders de trip
// waarin de datum valt, en anders een nieuwe trip (met die dag als begin en eind). Ligt de datum hoogstens drie dagen
// naast de gekozen trip, dan zegt het formulier vóór het opslaan "Opslaan verlengt <trip> tot <datum>": de tik op
// Opslaan verlengt hem (zo wordt een trip uit Toevoegen → Dag elke dag een dag langer, nooit zonder die tik).

/** Zoveel dagen naast de gekozen trip verlengt Opslaan hem; verder weg hoort de dag niet bij die trip. */
export const LEG_EXTEND_DAYS = 3

export interface LegPlacement {
  /** De trip van de dag; null = een nieuwe trip. */
  tripId: string | null
  /** Opslaan verlengt de gekozen trip tot deze datums (staat vóór het opslaan in het formulier). */
  extend?: { start: string; end: string }
  /** De voorgevulde trip past niet bij de datum: de dag gaat naar de trip van die datum, of een nieuwe trip. */
  moved?: boolean
}

/**
 * De trip voor een dag op `date`, uitgaande van de gekozen trip (null = nieuwe trip):
 * 1. de gekozen trip als de datum erin valt;
 * 2. de gekozen trip als Olivier hem zelf koos (`explicit`), verlengd als de datum hoogstens drie dagen ernaast ligt;
 * 3. anders de trip waarin de datum valt (bij een wisseldag de laatst begonnen);
 * 4. anders de gekozen trip verlengd, als de datum hoogstens drie dagen ernaast ligt;
 * 5. anders een nieuwe trip.
 */
export function placeLeg(trips: readonly Trip[], legs: readonly Leg[], chosenId: string | null, date: string, explicit = false): LegPlacement {
  const live = active(trips)
  const chosen = chosenId ? live.find((x) => x.id === chosenId) : undefined
  const inside = (v: { startDate?: string; endDate?: string }) => !!v.startDate && !!v.endDate && v.startDate <= date && date <= v.endDate
  const view = chosen ? weekView(chosen, legs) : null
  if (chosen && view && inside(view)) return { tripId: chosen.id }
  const extend = view ? extension(view, date) : null
  if (chosen && explicit) return { tripId: chosen.id, ...(extend ? { extend } : {}) }
  const containing = live
    .map((trip) => weekView(trip, legs))
    .filter(inside)
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))
    .at(-1)
  if (containing) return { tripId: containing.trip.id, ...(chosen ? { moved: true } : {}) }
  if (chosen && extend) return { tripId: chosen.id, extend }
  return { tripId: null, ...(chosen ? { moved: true } : {}) }
}

/** De nieuwe datums als `date` hoogstens drie dagen vóór of na de trip ligt; anders null. */
function extension(view: { startDate?: string; endDate?: string }, date: string): { start: string; end: string } | null {
  if (!view.startDate || !view.endDate) return null
  if (date < view.startDate && daysBetween(date, view.startDate) <= LEG_EXTEND_DAYS) return { start: date, end: view.endDate }
  if (date > view.endDate && daysBetween(view.endDate, date) <= LEG_EXTEND_DAYS) return { start: view.startDate, end: date }
  return null
}

/** De dagen van een trip binnen zijn datums; dagen erbuiten staan apart op de pagina (alleen ter informatie). */
export function splitLegs(trip: Trip, legs: readonly Leg[]): { inside: Leg[]; outside: Leg[] } {
  const own = legs.filter((l) => l.tripId === trip.id && l.deletedAt === null)
  // Een trip zonder datums (van vóór november 2026) toont gewoon al zijn dagen.
  if (!trip.startDate || !trip.endDate) return { inside: own, outside: [] }
  return { inside: own.filter((l) => l.date >= trip.startDate! && l.date <= trip.endDate!), outside: own.filter((l) => l.date < trip.startDate! || l.date > trip.endDate!) }
}
