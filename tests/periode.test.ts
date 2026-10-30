import { describe, expect, it } from 'vitest'
import { difference, earliestDate, forecast, positionAt, resolvePeriod, type PositionInput } from '../src/model/position'
import type { RatesFile } from '../src/model/rates'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Account, Balance, Trip } from '../src/model/types'

// Periodes zelf kiezen (Geld → Mijn positie en de vooruitblik): snelkeuzes en zelf van en tot; de vooruitblik loopt
// van de maand van "van" tot "tot" en telt alleen wat er tot en met "tot" binnenkomt. En "Sinds 11 september": een
// salaris dat op die dag al te ontvangen was, telt dan al mee. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-10-30'
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-09-01'], rates: { USD: [1.25] } }
const trip = (id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, startDate, endDate, organisation: 'sailing-virgins', updatedAt: T0, deletedAt: null, ...extra })
const account: Account = { id: 'asn', name: 'Nep', provider: 'overig', kind: 'betaal', currency: 'EUR', updatedAt: T0, deletedAt: null }
const balance = (date: string, amount: number): Balance => ({ id: `stand:asn:${date.slice(0, 7)}`, accountId: 'asn', date, amount, source: 'handmatig', updatedAt: T0, deletedAt: null })
const input = (extra: Partial<PositionInput>): PositionInput => ({ accounts: [], balances: [], trips: [], legs: [], transactions: [], rates: RATES, ...extra })
const salary = (amount: number) => ({ amount, currency: 'EUR' as const, status: 'verwacht' as const, source: 'eigen' as const })

describe('periode kiezen', () => {
  it('snelkeuzes: sinds start zeilcarrière, dit jaar, tot einde planning, alles; zelf kiezen', () => {
    const s = { ...DEFAULT_SETTINGS, careerStart: '2026-09-11' }
    expect(resolvePeriod({ preset: 'carriere' }, s, TODAY, '2027-03-31', null)).toEqual({ from: '2026-09-11', to: '2027-03-31' })
    expect(resolvePeriod({ preset: 'jaar' }, s, TODAY, '2027-03-31', null)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(resolvePeriod({ preset: 'planning' }, s, TODAY, '2027-03-31', null)).toEqual({ from: TODAY, to: '2027-03-31' })
    expect(resolvePeriod({ preset: 'alles' }, s, TODAY, null, '2023-05-01')).toEqual({ from: '2023-05-01', to: TODAY })
    expect(resolvePeriod({ preset: 'eigen', from: '2026-09-11', to: '2027-03-31' }, s, TODAY, null, null)).toEqual({ from: '2026-09-11', to: '2027-03-31' })
    // Ongeldig (van na tot): terug naar sinds de start van de zeilcarrière.
    expect(resolvePeriod({ preset: 'eigen', from: '2027-04-01', to: '2027-03-31' }, s, TODAY, null, null)).toEqual({ from: '2026-09-11', to: TODAY })
    expect(earliestDate(input({ balances: [balance('2025-02-01', 10)], trips: [trip('t', '2024-06-01', '2024-06-07')] }))).toBe('2024-06-01')
  })

  it('de vooruitblik loopt van de maand van "van" tot "tot" en telt alleen salaris tot en met "tot"', () => {
    const trips = [trip('nov', '2026-11-01', '2026-11-07', { salary: salary(1000) }), trip('apr', '2027-04-01', '2027-04-07', { salary: salary(2000) })]
    const data = input({ accounts: [account], balances: [balance('2026-09-20', 500)], trips })
    const f = forecast(data, DEFAULT_SETTINGS, TODAY, '2027-04-07', 6, null, { from: '2026-09-11', to: '2027-03-31' })
    expect(f.months[0]!.month).toBe('2026-09')
    expect(f.months.at(-1)!.month).toBe('2027-03')
    expect(f.items.map((i) => i.trips[0]!.id)).toEqual(['nov'])
    expect(f.endEur).toBe(1500)
    // Een periode die al voorbij is: alleen gemeten.
    const past = forecast(data, DEFAULT_SETTINGS, TODAY, null, 6, null, { from: '2026-09-01', to: '2026-09-30' })
    expect(past.items).toEqual([])
    expect(past.months.every((m) => !m.future)).toBe(true)
    expect(past.endEur).toBe(500)
  })
})

describe('"Sinds 11 september"', () => {
  it('een salaris dat op de begindatum al te ontvangen was, telt dan al mee (dus +€ 0); een latere trip telt als verschil', () => {
    const start = '2026-09-11'
    const before = input({ trips: [trip('yw1', '2026-09-01', '2026-09-07', { organisation: 'yacht-week', salary: salary(600) })] })
    expect(difference(positionAt(before, TODAY).totals.net, positionAt(before, start, true).totals.net)).toBe(0)
    const after = input({ trips: [trip('yw1', '2026-10-01', '2026-10-07', { organisation: 'yacht-week', salary: salary(600) })] })
    expect(difference(positionAt(after, TODAY).totals.net, positionAt(after, start, true).totals.net)).toBe(600)
  })
})
