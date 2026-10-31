import { withSalaryDefault } from './salary'
import type { Tx } from '../domain/tx'
import { tripRange } from './calendar'
import { active } from './derive'
import { currentSettings, saveSettings } from './settings'
import { COUNTED_ORGANISATIONS, type CountedOrganisation, type Leg, type Settings, type Trip } from './types'
import { todayIso } from '../basis/datum'
import { isCounted, orgFromName, tripOrganisation } from '../basis/organisatie'

// Teller per organisatie: elke trip van Sailing Virgins of Yacht Week krijgt zijn volgnummer op datum ("SV #3",
// "YW #10"), vanaf een instelbaar beginnummer voor trips van vóór de app. Ook geïmporteerde trips tellen mee: een naam
// met "Sailing Virgins" of "Yacht week" hoort er zeker bij; alleen een afkorting (SV, YW) is twijfel en telt pas mee
// als Olivier het bevestigt.

export const ORG_CODE: Record<CountedOrganisation, string> = { 'sailing-virgins': 'SV', 'yacht-week': 'YW' }

export interface TripCounter {
  org: CountedOrganisation
  n: number
  /** "SV #3" */
  label: string
}

function answeredIds(settings: Settings): string[] {
  return Array.isArray(settings.orgAnswered) ? settings.orgAnswered.filter((id): id is string => typeof id === 'string') : []
}

/** Twijfelgevallen om te bevestigen: geen organisatie, alleen een afkorting in de naam, nog niet beantwoord. */
export function doubtfulTrips(trips: readonly Trip[], settings: Settings): { trip: Trip; org: CountedOrganisation }[] {
  const answered = new Set(answeredIds(settings))
  return active(trips).flatMap((trip) => {
    if (trip.organisation || answered.has(trip.id)) return []
    const guess = orgFromName(trip.name)
    return guess && !guess.sure ? [{ trip, org: guess.org }] : []
  })
}

export function firstNumber(settings: Settings, org: CountedOrganisation): number {
  const n = settings.orgFirst?.[org]
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1
}

function startOf(trip: Trip, legs: readonly Leg[]): string {
  return tripRange(trip, legs)?.start ?? ''
}

/** Volgnummer per organisatie op datum (trips zonder datum achteraan), vanaf het beginnummer. */
export function tripCounters(trips: readonly Trip[], legs: readonly Leg[], settings: Settings): Map<string, TripCounter> {
  const out = new Map<string, TripCounter>()
  const live = active(legs)
  for (const org of COUNTED_ORGANISATIONS) {
    const list = active(trips)
      .filter((t) => tripOrganisation(t) === org)
      .map((trip) => ({ trip, start: startOf(trip, live) }))
      .sort((a, b) => (a.start || '9999') < (b.start || '9999') ? -1 : (a.start || '9999') > (b.start || '9999') ? 1 : a.trip.name.localeCompare(b.trip.name))
    const first = firstNumber(settings, org)
    list.forEach(({ trip }, i) => out.set(trip.id, { org, n: first + i, label: `${ORG_CODE[org]} #${first + i}` }))
  }
  return out
}

/** Het nummer dat een nieuwe trip van deze organisatie op `startDate` krijgt. */
export function nextNumber(trips: readonly Trip[], legs: readonly Leg[], settings: Settings, org: CountedOrganisation, startDate: string): number {
  const live = active(legs)
  const before = active(trips).filter((t) => tripOrganisation(t) === org && startOf(t, live) && startOf(t, live) <= startDate).length
  return firstNumber(settings, org) + before
}

/** Een eigen teller vooraan in de naam: "SV #4 · BVI", "YW10", of alleen de afkorting ("SV BVI"). */
function ownCounter(name: string, org: CountedOrganisation): RegExpExecArray | null {
  return new RegExp(`^${ORG_CODE[org]}(?:\\s*#?\\s*\\d+)?(?![A-Za-z])`).exec(name)
}

/**
 * Naam met teller. Begint de naam al met een teller of de afkorting van dezelfde organisatie, dan komt het actuele
 * nummer daarvoor in de plaats: een eerdere trip of een ander beginnummer schuift de nummers op.
 */
export function nameWithCounter(trip: Trip, counter: TripCounter | undefined): string {
  if (!counter) return trip.name
  const name = trip.name.trim()
  const own = ownCounter(name, counter.org)
  if (own) return `${counter.label}${name.slice(own[0].length)}`
  return name ? `${counter.label} · ${name}` : counter.label
}

/** Naamvoorstel voor een nieuwe trip: met teller bij een getelde organisatie, anders uit de vorige trip. */
export function newTripName(
  trips: readonly Trip[],
  legs: readonly Leg[],
  settings: Settings,
  organisation: string | undefined,
  startDate: string,
  area: string,
  fallback: string,
): string {
  return isCounted(organisation) ? counterName(organisation, nextNumber(trips, legs, settings, organisation, startDate), area) : fallback
}

/** Naamvoorstel met teller: "SV #4 · BVI". */
export function counterName(org: CountedOrganisation, n: number, area: string): string {
  return area.trim() ? `${ORG_CODE[org]} #${n} · ${area.trim()}` : `${ORG_CODE[org]} #${n}`
}

/** Twijfelgeval beantwoorden: ja = de trip hoort bij de organisatie (opgeslagen), nee = niet meer vragen. */
export async function answerDoubt(store: Tx, trip: Trip, org: CountedOrganisation, yes: boolean): Promise<void> {
  // Hoort de trip bij de organisatie, dan krijgt hij ook het standaardsalaris daarvan (alleen zonder eigen bedrag).
  if (yes) await store.put('trips.json.enc', withSalaryDefault({ ...trip, organisation: org, updatedAt: new Date().toISOString() }, currentSettings(store.get('settings.json.enc')), trip, store.list('legs.json.enc'), todayIso()))
  else {
    const settings = currentSettings(store.get('settings.json.enc'))
    await saveSettings(store, { orgAnswered: [...new Set([...answeredIds(settings), trip.id])] })
  }
}

/** Beginnummers per organisatie (voor trips van vóór de app). */
export async function saveFirstNumbers(store: Tx, first: Partial<Record<CountedOrganisation, number>>): Promise<void> {
  const clean: Partial<Record<CountedOrganisation, number>> = {}
  for (const org of COUNTED_ORGANISATIONS) {
    const n = first[org]
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n < 10_000) clean[org] = n
  }
  await saveSettings(store, { orgFirst: clean })
}
