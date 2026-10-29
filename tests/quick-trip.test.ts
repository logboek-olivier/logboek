import { describe, expect, it } from 'vitest'
import type { Trip } from '../src/model/types'
import { latestTripBefore, nextFreeDay, suggestTripName } from '../src/model/weeks'

// PR D: snel een trip toevoegen via het plusje. Voorstel voor naam en type uit de vorige trip; de eerste vrije dag als
// start. Verzonnen trips.

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, name: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name, startDate, endDate, ...extra, updatedAt: T0, deletedAt: null })

describe('Naam- en typevoorstel uit de vorige trip', () => {
  const trips = [trip('a', 'Sailing Virgins week 2', '2026-11-08', '2026-11-21', { type: 'training-geven', base: 'Nepbasis' }), trip('b', 'Yacht week 7', '2026-08-01', '2026-08-07', { type: 'skipper-charter' })]

  it('de laatste trip vóór de nieuwe startdatum', () => {
    expect(latestTripBefore(trips, [], '2026-12-01')?.id).toBe('a')
    expect(latestTripBefore(trips, [], '2026-09-01')?.id).toBe('b')
    // Vóór alle trips: de oudste als voorstel.
    expect(latestTripBefore(trips, [], '2026-01-01')?.id).toBe('b')
    expect(latestTripBefore([], [], '2026-01-01')).toBeNull()
  })

  it('een naam die op een getal eindigt krijgt het volgende getal; anders basis en maand', () => {
    expect(suggestTripName(trips[0]!, '2026-12-01', 'nl')).toBe('Sailing Virgins week 3')
    expect(suggestTripName(trips[1]!, '2026-09-01', 'nl')).toBe('Yacht week 8')
    expect(suggestTripName(trip('c', 'Nepweek BVI', '2026-10-01', '2026-10-07', { base: 'Nepbasis' }), '2026-12-01', 'nl')).toMatch(/^Nepbasis dec 2026$/)
  })
})

describe('Eerste vrije dag', () => {
  it('vandaag, of de dag na de trip waarin vandaag valt (ook als er een trip direct op aansluit)', () => {
    const trips = [trip('a', 'Nu', '2026-10-25', '2026-10-31'), trip('b', 'Daarna', '2026-11-01', '2026-11-07')]
    expect(nextFreeDay(trips, [], '2026-10-29')).toBe('2026-11-08')
    expect(nextFreeDay(trips, [], '2026-11-20')).toBe('2026-11-20')
  })
})
