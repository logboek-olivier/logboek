import { describe, expect, it } from 'vitest'
import { taxYear, taxYears } from '../src/model/tax-year'
import type { RatesFile } from '../src/model/rates'
import type { Transaction, Trip } from '../src/model/types'

// Jaaroverzicht voor de belasting: inkomsten van één jaar per organisatie in euro, met de gebruikte koers en datum.
// Alle gegevens verzonnen.

const NOW = '2026-10-26T10:00:00.000Z'
const rates: RatesFile = {
  format: 'logboek-rates',
  source: 'nep',
  dates: ['2026-10-21', '2026-10-22', '2026-10-23'],
  rates: { USD: [1.06, 1.07, 1.08], GBP: [0.85, null, 0.84] },
}

const tx = (id: string, date: string, kind: Transaction['kind'], amount: number, currency: Transaction['currency'], extra: Partial<Transaction> = {}): Transaction => ({
  id,
  date,
  kind,
  amount,
  currency,
  source: 'overig',
  updatedAt: NOW,
  deletedAt: null,
  ...extra,
})
const trips: Trip[] = [
  { id: 'sv', name: 'Neptrip SV', organisation: 'sailing-virgins', updatedAt: NOW, deletedAt: null },
  { id: 'yw', name: 'Neptrip YW', organisation: 'yacht-week', updatedAt: NOW, deletedAt: null },
  { id: 'los', name: 'Neptrip los', organisation: 'overig', updatedAt: NOW, deletedAt: null },
]

describe('jaaroverzicht', () => {
  const all = [
    tx('a', '2026-10-22', 'loon', 1070, 'USD', { tripId: 'sv' }),
    tx('b', '2026-10-23', 'fooi', 50, 'EUR', { tripId: 'sv' }),
    tx('c', '2026-10-21', 'fooi', 100, 'USD', { tripId: 'yw', receivedEur: 90 }),
    tx('d', '2026-10-21', 'bonus', 85, 'GBP', { tripId: 'los', source: 'delivery' }),
    tx('e', '2026-10-25', 'fooi', 108, 'USD', { source: 'yacht-week' }),
    tx('f', '2026-10-20', 'fooi', 20, 'SEK'),
    tx('g', '2026-10-22', 'terugbetaling', 107, 'USD', { tripId: 'sv' }),
    tx('h', '2026-10-22', 'kosten', 30, 'EUR', { tripId: 'sv' }),
    tx('i', '2025-12-31', 'loon', 500, 'EUR', { source: 'sailing-virgins' }),
    tx('weg', '2026-10-22', 'loon', 999, 'EUR', { deletedAt: NOW }),
    tx('opgeslagen', '2026-10-22', 'loon', 200, 'USD', { source: 'sailing-virgins', amountEur: 180, rate: 1.1111, rateDate: '2026-10-22' }),
  ]

  it('jaren met inkomsten, nieuwste eerst', () => {
    expect(taxYears(all)).toEqual([2026, 2025])
  })

  it('per organisatie in euro met de gebruikte koers, terugbetaald apart, kosten en verwijderd niet', () => {
    const year = taxYear(all, trips, 2026, rates)
    expect(year.groups.map((g) => g.group)).toEqual(['sailing-virgins', 'yacht-week', 'delivery', 'overig'])
    const sv = year.groups[0]!
    // 1070 USD tegen 1,07 = 1000 euro; 50 euro; opgeslagen koers 180 euro.
    expect(sv.eur).toBe(1230)
    expect(sv.lines.find((l) => l.id === 'a')).toMatchObject({ eur: 1000, basis: 'rate', rate: 1.07, rateDate: '2026-10-22', provisional: false, trip: 'Neptrip SV' })
    expect(sv.lines.find((l) => l.id === 'b')).toMatchObject({ eur: 50, basis: 'eur' })
    expect(sv.lines.find((l) => l.id === 'b')).not.toHaveProperty('rate')
    expect(sv.lines.find((l) => l.id === 'opgeslagen')).toMatchObject({ eur: 180, basis: 'stored', rate: 1.1111, rateDate: '2026-10-22' })
    const yw = year.groups[1]!
    // Ontvangen in euro gaat voor de koers; de bron van een inkomen zonder trip telt ook.
    expect(yw.lines.find((l) => l.id === 'c')).toMatchObject({ eur: 90, basis: 'received' })
    expect(yw.lines.find((l) => l.id === 'c')).not.toHaveProperty('rate')
    // Na het einde van het koersbestand: de laatst bekende koers, voorlopig.
    expect(yw.lines.find((l) => l.id === 'e')).toMatchObject({ eur: 100, basis: 'rate', rate: 1.08, provisional: true })
    // Een trip met organisatie overig valt terug op de bron van de transactie.
    expect(year.groups[2]).toMatchObject({ group: 'delivery', eur: 100 })
    // Zonder koers: apart per valuta, nooit omgerekend.
    expect(year.groups[3]).toMatchObject({ group: 'overig', eur: 0, other: { SEK: 20 } })
    expect(year.groups[3]!.lines[0]).toMatchObject({ eur: null, basis: 'none' })
    expect(year.totalEur).toBe(1230 + 190 + 100)
    expect(year.reimbursed.map((l) => l.id)).toEqual(['g'])
    expect(year.reimbursedEur).toBe(100)
    expect(year.provisional).toBe(true)
    const ids = year.groups.flatMap((g) => g.lines.map((l) => l.id))
    expect(ids).not.toContain('h')
    expect(ids).not.toContain('weg')
    expect(ids).not.toContain('i')
  })

  it('zonder koersbestand: alleen euro en opgeslagen koersen omgerekend', () => {
    const year = taxYear(all, trips, 2026, null)
    expect(year.groups[0]).toMatchObject({ eur: 230, other: { USD: 1070 } })
    expect(year.provisional).toBe(false)
  })
})
