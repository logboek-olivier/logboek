// Opdrachten voor gelogde dagen: loggen, bewerken, verwijderen, "Zoals gepland" en aanvullen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { active, compareLegs } from '../model/derive'
import { deleteLeg, updateLeg, type LegPatch } from '../model/edit'
import { fillGap } from '../model/gaps'
import { placeLeg } from '../model/leg-trip'
import { placeCountry } from '../model/places'
import { logPlanned } from '../model/routes'
import { saveSettings } from '../model/settings'
import { newId, type Leg, type Role, type Trip, type Water } from '../model/types'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

export interface LogDayInput {
  date: string
  /** De gekozen trip; null = een nieuwe trip. */
  tripId: string | null
  /** Olivier koos de trip zelf (src/model/leg-trip.ts, placeLeg). */
  explicit?: boolean
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
 * Een dag loggen (Toevoegen → Dag): bij de gekozen trip of de trip van de datum, anders een nieuwe trip met die dag als
 * begin en eind (src/model/leg-trip.ts). Alleen wat het formulier vóór het opslaan zei ("Opslaan verlengt <trip> tot
 * <datum>") verandert de datums van een bestaande trip.
 */
export async function logDay(tx: Tx, input: LogDayInput): Promise<Leg> {
  const trips = tx.get('trips.json.enc')
  const legs = tx.get('legs.json.enc')
  const place = placeLeg(trips, legs, input.tripId, input.date, input.explicit)
  let id = place.tripId ?? undefined
  if (!id) {
    // Een nieuwe trip vanuit Dag: deze dag is begin en eind (gewone velden; later zelf te wijzigen). `datesFromDays`:
    // hij blijft drie dagen na zijn laatste dag lopend, zodat hij 's ochtends vóór het loggen in Deze trip staat.
    const trip: Trip = { id: newId(), name: input.newTripName, startDate: input.date, endDate: input.date, datesFromDays: true, updatedAt: tx.now, deletedAt: null }
    await tx.put('trips.json.enc', trip)
    id = trip.id
  } else if (place.extend) await extendTrip(tx, id, place.extend)
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
  await saveSettings(tx, { ...(leg.boat ? { lastBoat: leg.boat } : {}), lastRole: input.role, lastTripId: id, lastWater: input.water })
  return leg
}

/**
 * Een dag bewerken, ook naar een andere of een nieuwe trip. De datums van een trip veranderen alleen als het formulier
 * dat vóór het opslaan zei (`extend`, src/model/leg-trip.ts).
 */
export async function editDay(tx: Tx, leg: Leg, patch: LegPatch, trip: { id: string } | { newName: string }, extend?: { start: string; end: string }): Promise<void> {
  if (extend && 'id' in trip) await extendTrip(tx, trip.id, extend)
  await updateLeg(tx, leg, patch, trip)
}

/** De gekozen trip verlengen tot de datums die het formulier toonde; een trip uit Toevoegen → Dag houdt zijn soort. */
async function extendTrip(tx: Tx, tripId: string, extend: { start: string; end: string }): Promise<void> {
  const trip = tx.list('trips.json.enc').find((x) => x.id === tripId)
  if (trip) await tx.put('trips.json.enc', { ...trip, startDate: extend.start, endDate: extend.end, updatedAt: tx.now })
}

export const aanvullen = opdracht('aanvullen', fillGap)
export const dagBewerken = opdracht('dagBewerken', updateLeg)
export const dagBewerkenMetTrip = opdracht('dagBewerkenMetTrip', editDay)
export const dagLoggen = opdrachtMet('dagLoggen', logDay)
export const dagVerwijderen = opdracht('dagVerwijderen', deleteLeg)
export const dagZoalsGepland = opdrachtMet('dagZoalsGepland', logPlanned)
