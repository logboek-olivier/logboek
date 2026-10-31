import { describe, expect, it } from 'vitest'
import { sameValue } from '../src/basis/gelijk'
import { isDate, monthEnd, shiftMonth } from '../src/basis/datum'

// src/basis: één plek voor datums en vergelijken (docs/FUNDERING.md).

describe('basis', () => {
  it('gelijk los van de volgorde van de velden (gevonden door de eigenschappentests: ongedaan maken van samenvoegen)', () => {
    expect(sameValue({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }, { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 })).toBe(true)
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
  })

  it('datums', () => {
    expect(isDate('2026-10-31')).toBe(true)
    expect(isDate('31-10-2026')).toBe(false)
    expect(isDate('')).toBe(false)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(monthEnd('2028-02')).toBe('2028-02-29')
  })
})
