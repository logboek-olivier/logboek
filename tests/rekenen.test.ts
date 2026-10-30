import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../src/i18n'
import { summarize } from '../src/model/derive'
import { parseValue } from '../src/model/goals'
import { taxYear } from '../src/model/tax-year'
import type { Leg, Transaction, Trip } from '../src/model/types'

// Fundering: rekenen klopt. Het totaal aan mijlen is de som van de watertypes (nooit per dag afgerond), een getal bij
// een doel volgt het decimaalteken van de taal, en het jaaroverzicht deelt inkomsten per organisatie in zoals de
// statistieken (ook uit de naam van de trip). Verzonnen data.

afterEach(() => setLang('nl', false))

const leg = (i: number, nmSea: number): Leg => ({
  id: `l${i}`,
  tripId: 't',
  date: '2026-05-01',
  fromPlace: 'Nepstad',
  fromCountry: '',
  toPlace: 'Nepdorp',
  toCountry: '',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'import',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
})

describe('mijlen', () => {
  it('40 dagen van 2,25 nm zijn 90 nm, net als de som per watertype en per rol', () => {
    const s = summarize(Array.from({ length: 40 }, (_, i) => leg(i, 2.25)))
    expect(s.nm).toBe(90)
    expect(s.nmByWater.sea).toBe(90)
    expect(s.nmByRole.schipper).toBe(90)
  })
})

describe('getallen bij doelen', () => {
  it('volgen het decimaalteken van de taal', () => {
    setLang('en', false)
    expect(parseValue('2,500')).toBe(2500)
    expect(parseValue('78.4')).toBe(78.4)
    setLang('nl', false)
    expect(parseValue('2.500')).toBe(2500)
    expect(parseValue('78,4')).toBe(78.4)
    expect(parseValue('0')).toBe(0)
    expect(parseValue('-5')).toBeNull()
  })
})

describe('jaaroverzicht per organisatie', () => {
  it('een trip met "Yacht week" in de naam telt bij Yacht Week, zoals in de statistieken', () => {
    const trip: Trip = { id: 'yw', name: 'Yacht week 7', updatedAt: 'x', deletedAt: null }
    const tx: Transaction = { id: 'tx', date: '2026-07-05', kind: 'fooi', amount: 100, currency: 'EUR', amountEur: 100, source: 'overig', tripId: 'yw', updatedAt: 'x', deletedAt: null }
    const year = taxYear([tx], [trip], 2026, null)
    expect(year.groups.map((g) => g.group)).toEqual(['yacht-week'])
  })
})
