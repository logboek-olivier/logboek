import { describe, expect, it } from 'vitest'
import {
  addDays,
  mondayOf,
  otherCurrencies,
  parseAmount,
  perMonth,
  perSource,
  recentTips,
  tipsPerWeek,
  totals,
} from '../src/model/money'
import type { Transaction } from '../src/model/types'

// Verzonnen bedragen.

let n = 0
function tx(partial: Partial<Transaction> & Pick<Transaction, 'date' | 'kind' | 'amount'>): Transaction {
  return {
    id: `t${++n}`,
    currency: 'EUR',
    source: 'yacht-week',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  }
}

const TODAY = '2026-10-25' // zondag

const sample: Transaction[] = [
  tx({ date: '2026-10-25', kind: 'fooi', amount: 120 }),
  tx({ date: '2026-10-20', kind: 'fooi', amount: 80.5, source: 'sailing-virgins' }),
  tx({ date: '2026-10-18', kind: 'fooi', amount: 200, currency: 'USD' }),
  tx({ date: '2026-10-10', kind: 'loon', amount: 1000 }),
  tx({ date: '2026-10-02', kind: 'kosten', amount: 35.25, note: 'taxi' }),
  tx({ date: '2026-09-15', kind: 'investering', amount: 500, source: 'overig' }),
  tx({ date: '2026-09-15', kind: 'kosten', amount: 40, currency: 'GBP', source: 'overig' }),
  tx({ date: '2026-08-01', kind: 'fooi', amount: 999, deletedAt: '2026-08-02T00:00:00.000Z' }),
]

describe('zeilgeld', () => {
  it('telt EUR op en houdt andere valuta apart', () => {
    expect(totals(sample)).toEqual({
      incomeEur: 1200.5,
      costsEur: 535.25,
      balanceEur: 665.25,
      other: { USD: { income: 200, costs: 0 }, GBP: { income: 0, costs: 40 } },
    })
    expect(otherCurrencies(sample)).toEqual(['GBP', 'USD'])
  })

  it('rekent een bekend EUR-bedrag van een andere valuta wel mee', () => {
    const converted = [tx({ date: '2026-10-01', kind: 'fooi', amount: 100, currency: 'USD', amountEur: 92 })]
    expect(totals(converted)).toEqual({ incomeEur: 92, costsEur: 0, balanceEur: 92, other: {} })
  })

  it('groepeert per maand, nieuwste eerst, en per bron', () => {
    const months = perMonth(sample)
    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-09'])
    expect(months[0]).toMatchObject({ incomeEur: 1200.5, costsEur: 35.25, balanceEur: 1165.25 })
    expect(months[1]).toMatchObject({ incomeEur: 0, costsEur: 500, other: { GBP: { income: 0, costs: 40 } } })
    const sources = perSource(sample)
    expect(sources.map((s) => s.source)).toEqual(['yacht-week', 'sailing-virgins', 'overig'])
    expect(sources[0]).toMatchObject({ incomeEur: 1120, costsEur: 35.25 })
  })

  it('geeft fooi per week voor 12 weken, oudste eerst, met de huidige week als laatste', () => {
    const weeks = tipsPerWeek(sample, TODAY)
    expect(weeks).toHaveLength(12)
    expect(weeks[11]?.weekStart).toBe('2026-10-19')
    expect(weeks[11]?.eur).toBe(200.5)
    expect(weeks[10]?.weekStart).toBe('2026-10-12')
    expect(weeks[10]?.other).toEqual({ USD: 200 })
    expect(weeks[0]?.weekStart).toBe('2026-08-03')
    expect(weeks.reduce((s, w) => s + w.eur, 0)).toBe(200.5)
  })

  it('telt fooi van de afgelopen 30 dagen', () => {
    expect(recentTips(sample, TODAY)).toEqual({ eur: 200.5, other: { USD: 200 } })
    expect(recentTips(sample, '2026-11-30')).toEqual({ eur: 0, other: {} })
  })

  it('leest bedragen in Nederlandse en Engelse notatie', () => {
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('12.50')).toBe(12.5)
    expect(parseAmount('1.250,75')).toBe(1250.75)
    expect(parseAmount('€ 40')).toBe(40)
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })

  it('rekent met weken en dagen', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19')
    expect(mondayOf('2026-10-19')).toBe('2026-10-19')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('reeksen voor de grafieken', () => {
  it('geeft 12 maanden inkomsten en kosten, oudste eerst, ook lege maanden en over een jaargrens', async () => {
    const { monthSeries } = await import('../src/model/money')
    const { lastMonths } = await import('../src/model/derive')
    expect(lastMonths('2026-02-15', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    const tx = (date: string, kind: 'fooi' | 'kosten', amount: number) => ({
      id: `${date}-${kind}`,
      date,
      kind,
      amount,
      currency: 'EUR' as const,
      amountEur: amount,
      source: 'overig' as const,
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    })
    const series = monthSeries([tx('2026-02-01', 'fooi', 50), tx('2026-02-03', 'kosten', 20), tx('2025-12-24', 'fooi', 10), tx('2024-01-01', 'fooi', 99)], '2026-02-15', 3)
    expect(series.map((m) => [m.month, m.incomeEur, m.costsEur])).toEqual([
      ['2025-12', 10, 0],
      ['2026-01', 0, 0],
      ['2026-02', 50, 20],
    ])
  })
})
