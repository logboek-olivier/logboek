import { formatMonthName } from '../format'

/** Tochtnaam zonder eigen naam: "<boot> <maand jaar>" (import en nieuwe trip vanuit een dag). */
export function defaultTripName(boat: string, date: string): string {
  const [y, m] = date.split('-')
  const month = m ? formatMonthName(Number(m)) : ''
  return `${boat} ${month} ${y}`.trim()
}
