// Opdrachten voor gelogde dagen: loggen, bewerken, verwijderen, "Zoals gepland" en aanvullen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { resizeTrip, type TripResize } from '../model/calendar'
import { active, compareLegs } from '../model/derive'
import { deleteLeg, updateLeg, type LegPatch } from '../model/edit'
import { fillGap } from '../model/gaps'
import { placeLeg } from '../model/leg-trip'
import { placeCountry } from '../model/places'
import { logPlanned } from '../model/routes'
import { saveSettings } from '../model/settings'
import { followDays } from '../model/trip-dates'
import { newId, type Leg, type Role, type Trip, type Water } from '../model/types'
import { weekView } from '../model/weeks'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

export interface LogDayInput {
  date: string
  /** De gekozen trip; null = een nieuwe trip. */
  tripId: string | null
  /** Naam als er een nieuwe trip komt. */
  newTripName: string
  fromPlace: string
  toPlace: string
  role: Role
  boat: string
  water: Water
  nm: number
  nightHours: number
  wind: string
  notes: string
}

/**
 * Een dag loggen (Toevoegen → Dag). De dag komt altijd binnen de datums van zijn trip: de trip van de datum, de gekozen
 * trip een paar dagen langer, of een nieuwe trip die de dagen volgt (src/model/leg-trip.ts).
 */
export async function logDay(tx: Tx, input: LogDayInput): Promise<Leg> {
  const trips = tx.get('trips.json.enc')
  const legs = tx.get('legs.json.enc')
  const place = placeLeg(trips, legs, input.tripId, input.date)
  let id = place.tripId ?? undefined
  if (id && place.extend) {
    const trip = active(trips).find((x) => x.id === id)
    if (trip) await resizeTrip(tx, { view: weekView(trip, legs), start: place.extend.start, end: place.extend.end })
  }
  if (!id) {
    // Een trip vanuit Dag: begin en eind volgen de dagen (src/model/trip-dates.ts).
    const trip: Trip = { id: newId(), name: input.newTripName, startDate: input.date, endDate: input.date, datesFromDays: true, updatedAt: tx.now, deletedAt: null }
    await tx.put('trips.json.enc', trip)
    id = trip.id
  }
  // Landen: van de plaats zelf (punt of eerdere dagen), anders het land van de vorige dag in deze trip; nooit van een
  // dag uit een andere trip (anders krijgt een dag in de BVI het land van een dag in Engeland).
  const places = tx.get('places.json.enc')
  const previous = active(legs).filter((l) => l.tripId === id && l.date <= input.date).sort(compareLegs).at(-1)
  const fromPlace = input.fromPlace.trim()
  const toPlace = input.toPlace.trim()
  const leg: Leg = {
    id: newId(),
    tripId: id,
    date: input.date,
    fromPlace,
    fromCountry: placeCountry(legs, places, fromPlace) || previous?.toCountry || '',
    toPlace,
    toCountry: placeCountry(legs, places, toPlace) || (previous ? previous.toCountry : ''),
    role: input.role,
    boat: input.boat.trim(),
    nmInland: input.water === 'binnen' ? input.nm : 0,
    nmSea: input.water === 'zee' ? input.nm : 0,
    nmTidal: input.water === 'getij' ? input.nm : 0,
    nightHours: input.nightHours,
    dateEstimated: false,
    source: 'manual',
    updatedAt: tx.now,
    deletedAt: null,
  }
  if (input.wind.trim()) leg.windBft = input.wind.trim()
  if (input.notes.trim()) leg.notes = input.notes.trim()
  await tx.put('legs.json.enc', leg)
  await followDays(tx, [id])
  await saveSettings(tx, { ...(leg.boat ? { lastBoat: leg.boat } : {}), lastRole: input.role, lastTripId: id, lastWater: input.water })
  return leg
}

/** Een dag bewerken; ligt de nieuwe datum vlak naast de gekozen trip, dan wordt die trip eerst langer. */
export async function editDay(tx: Tx, leg: Leg, patch: LegPatch, trip: { id: string } | { newName: string }, extend: TripResize | null): Promise<void> {
  if (extend) await resizeTrip(tx, extend)
  await updateLeg(tx, leg, patch, trip)
}

export const aanvullen = opdracht('aanvullen', fillGap)
export const dagBewerken = opdracht('dagBewerken', updateLeg)
export const dagBewerkenMetTrip = opdracht('dagBewerkenMetTrip', editDay)
export const dagLoggen = opdrachtMet('dagLoggen', logDay)
export const dagVerwijderen = opdracht('dagVerwijderen', deleteLeg)
export const dagZoalsGepland = opdrachtMet('dagZoalsGepland', logPlanned)
export const tripDatumsVolgen = opdracht('tripDatumsVolgen', followDays)
