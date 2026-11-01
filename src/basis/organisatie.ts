import { COUNTED_ORGANISATIONS, type CountedOrganisation, type TransactionSource, type Trip } from '../model/types'

// Organisaties: één plek die zegt bij welke organisatie een trip hoort (de teller, de bron van geld, het jaaroverzicht
// en de statistieken gebruiken allemaal deze regels; docs/FUNDERING.md).

/** Organisatie uit de naam: de volledige naam is zeker, alleen een afkorting als los woord is twijfel. */
export function orgFromName(name: string): { org: CountedOrganisation; sure: boolean } | null {
  if (/yacht\s*-?\s*week/i.test(name)) return { org: 'yacht-week', sure: true }
  if (/sailing\s*-?\s*virgins?/i.test(name)) return { org: 'sailing-virgins', sure: true }
  if (/(^|[^A-Za-z])YW([^A-Za-z]|$)/.test(name)) return { org: 'yacht-week', sure: false }
  if (/(^|[^A-Za-z])SV([^A-Za-z]|$)/.test(name)) return { org: 'sailing-virgins', sure: false }
  return null
}

export const isCounted = (org: string | undefined): org is CountedOrganisation => COUNTED_ORGANISATIONS.includes(org as CountedOrganisation)

/** De organisatie waarvoor een trip telt: opgeslagen, anders zeker uit de naam; een andere opgeslagen organisatie telt niet. */
export function tripOrganisation(trip: Trip): CountedOrganisation | null {
  if (trip.organisation) return isCounted(trip.organisation) ? trip.organisation : null
  const guess = orgFromName(trip.name)
  return guess?.sure ? guess.org : null
}

/**
 * De bron die oudere versies (en het jaaroverzicht als terugval) lezen: de organisatie van de trip, ook uit de naam zoals
 * de teller ("Yacht week 7"), delivery bij een delivery, anders overig. Nooit een eerder gekozen bron.
 */
export function sourceForPeriod(trip: Trip | undefined): TransactionSource {
  const org = trip ? tripOrganisation(trip) : null
  if (org) return org
  if (trip?.type === 'delivery') return 'delivery'
  return 'overig'
}
