import { describe, expect, it } from 'vitest'
import { allPeriods } from '../src/model/periods'
import { periodSections } from '../src/model/period-list'
import type { Leg, StayPeriod, Trip } from '../src/model/types'

// De lijst met periodes (PR 4): Nu · Komend · Afgelopen per maand, filters en zoeken. Alles staat erin, ook trips
// zonder gelogde dagen en periodes aan land. Alle gegevens verzonnen.

const T = '2026-10-01T10:00:00.000Z'
const trip = (id: string, extra: Partial<Trip>): Trip => ({ id, name: `Neptrip ${id}`, updatedAt: T, deletedAt: null, ...extra })
const stay = (id: string, kind: StayPeriod['kind'], startDate: string, endDate: string): StayPeriod => ({ id, kind, startDate, endDate, updatedAt: T, deletedAt: null })
const leg = (id: string, tripId: string, date: string, toPlace: string): Leg => ({ id, tripId, date, fromPlace: 'Nephaven', fromCountry: '', toPlace, toCountry: '', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 12, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T, deletedAt: null })

const trips = [
  trip('sv1', { name: 'SV #1', type: 'training-geven', organisation: 'sailing-virgins', startDate: '2026-10-18', endDate: '2026-10-24', participants: [{ id: 'p', firstName: 'Nepnick' }] }),
  trip('sv2', { name: 'SV #2', type: 'training-geven', startDate: '2026-10-26', endDate: '2026-10-31' }),
  trip('rya', { name: 'RYA Offshore prep', type: 'zelf-trainen', startDate: '2026-09-14', endDate: '2026-09-18' }),
  trip('plan', { name: 'Neptrip december', type: 'skipper-charter', startDate: '2026-12-05', endDate: '2026-12-11' }),
  trip('los', { name: 'Neptrip zonder datums' }),
]
const legs = [leg('a', 'sv1', '2026-10-19', 'Gustavia')]
const stays = [stay('thuis', 'thuis', '2026-11-01', '2026-11-20'), stay('reis', 'reis', '2026-10-25', '2026-10-25')]
const periods = allPeriods(trips, legs, stays)

describe('lijst met periodes', () => {
  it('nu, komend en afgelopen per maand; ook zonder gelogde dagen en zonder datums (eerst rood: het Logboek liet ze weg)', () => {
    const s = periodSections(periods, legs, '2026-10-28', null, 'alles', '')
    expect(s.now.map((r) => r.period.id)).toEqual(['sv2'])
    expect(s.upcoming.map((g) => [g.month, g.rows.map((r) => r.period.id)])).toEqual([
      ['2026-11', ['thuis']],
      ['2026-12', ['plan']],
    ])
    expect(s.past.map((g) => [g.month, g.rows.map((r) => r.period.id)])).toEqual([
      ['2026-10', ['reis', 'sv1']],
      ['2026-09', ['rya']],
    ])
    expect(s.undated.map((r) => r.period.id)).toEqual(['los'])
    expect(s.past[0]!.rows.find((r) => r.period.id === 'sv1')?.nm).toBe(12)
  })

  it('filters: werk, training, plezier, reis en thuis', () => {
    const ids = (f: Parameters<typeof periodSections>[4]) => {
      const s = periodSections(periods, legs, '2026-10-28', null, f, '')
      return [...s.now, ...s.upcoming.flatMap((g) => g.rows), ...s.past.flatMap((g) => g.rows), ...s.undated].map((r) => r.period.id).sort()
    }
    expect(ids('training')).toEqual(['rya'])
    expect(ids('land')).toEqual(['reis', 'thuis'])
    expect(ids('werk')).toContain('sv1')
  })

  it('zoeken op naam, boot, plaats of persoon (zonder hoofdletters en accenten)', () => {
    const found = (q: string) => {
      const s = periodSections(periods, legs, '2026-10-28', null, 'alles', q)
      return [...s.now, ...s.upcoming.flatMap((g) => g.rows), ...s.past.flatMap((g) => g.rows), ...s.undated].map((r) => r.period.id)
    }
    expect(found('gustavia')).toEqual(['sv1'])
    expect(found('NEPNICK')).toEqual(['sv1'])
    expect(found('nepboot')).toEqual(['sv1'])
    expect(found('offshore')).toEqual(['rya'])
  })
})
