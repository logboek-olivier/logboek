import { describe, expect, it } from 'vitest'
import { isoWeek, tripWeeks } from '../src/model/weeks'

// Weken van het jaar (ISO: maandag tot en met zondag, week 1 bevat de eerste donderdag), zoals Olivier weken telt: in
// de agenda naast elke rij en in de kop van een trip.

describe('weeknummer van het jaar', () => {
  it('ISO-weken, ook rond het jaareinde (2026 heeft 53 weken)', () => {
    expect(isoWeek('2026-11-13')).toBe(46)
    expect(isoWeek('2026-11-15')).toBe(46)
    expect(isoWeek('2026-11-16')).toBe(47)
    expect(isoWeek('2026-12-31')).toBe(53)
    expect(isoWeek('2027-01-03')).toBe(53)
    expect(isoWeek('2027-01-04')).toBe(1)
    expect(isoWeek('2025-12-29')).toBe(1)
  })
})

describe('weken van een trip', () => {
  it('een week van zondag tot en met zaterdag of zondag is de week met de meeste dagen', () => {
    expect(tripWeeks('2026-11-15', '2026-11-21')).toEqual([47])
    expect(tripWeeks('2026-11-15', '2026-11-22')).toEqual([47])
    expect(tripWeeks('2026-11-16', '2026-11-22')).toEqual([47])
  })

  it('een lange trip loopt over meerdere weken; een korte heeft de week met de meeste dagen', () => {
    expect(tripWeeks('2026-11-15', '2026-11-28')).toEqual([47, 48])
    expect(tripWeeks('2026-11-21', '2026-11-22')).toEqual([47])
    // Gelijke stand (zaterdag en zondag, maandag en dinsdag): de latere week.
    expect(tripWeeks('2026-11-21', '2026-11-24')).toEqual([48])
    expect(tripWeeks('2026-11-13', '2026-11-13')).toEqual([46])
  })

  it('over het jaareinde heen', () => {
    expect(tripWeeks('2026-12-27', '2027-01-09')).toEqual([53, 1])
  })

  it('zonder geldige datums: geen week', () => {
    expect(tripWeeks('', '2026-11-20')).toEqual([])
    expect(tripWeeks('2026-11-20', '2026-11-10')).toEqual([])
  })
})
