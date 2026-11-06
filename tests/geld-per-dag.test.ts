import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resultDrill } from '../src/domain/doorklik'
import { transactionList } from '../src/domain/geldrapport'
import { compactEur, dayMoney, dayNets, monthNet, monthPeriod } from '../src/model/day-money'
import { totals } from '../src/model/money'
import { eurValue, setRates } from '../src/model/rates'
import type { Transaction } from '../src/model/types'
import { profileA, profileB, RATES, T } from './helpers/profielen'

// Geld per dag in de agenda (src/model/day-money.ts): netto per dag uit het echte geld op zijn eigen datum, met dezelfde
// functies als Geld. De som van de dagen = de maandsom = "Zeilgeld: resultaat" in Geld voor dezelfde maand.

beforeAll(() => setRates(RATES))
afterAll(() => setRates(null))

const cents = (n: number) => Math.round(n * 100)
const tx = (id: string, date: string, kind: Transaction['kind'], amount: number, currency: Transaction['currency'] = 'EUR', extra: Partial<Transaction> = {}): Transaction => ({
  id,
  date,
  kind,
  amount,
  currency,
  source: 'overig',
  updatedAt: T,
  deletedAt: null,
  ...extra,
})

describe.each([
  ['A', profileA],
  ['B', profileB],
] as const)('profiel %s: de som van de dagen is de maandsom is Geld', (_, make) => {
  it('voor elke maand met geld', () => {
    const p = make()
    const months = new Set(transactionList(p.input.transactions).map((x) => x.date.slice(0, 7)))
    expect(months.size).toBeGreaterThan(0)
    for (const month of months) {
      const days = dayNets(p.input.transactions, month)
      const sum = [...days.values()].reduce((n, d) => n + cents(d.balanceEur), 0)
      const net = monthNet(p.input.transactions, month)
      expect(sum, month).toBe(cents(net.balanceEur))
      // Hetzelfde getal als "Zeilgeld: resultaat" in Geld (de totalen en het doorklikbedrag) voor die maand.
      const period = monthPeriod(month)
      expect(cents(totals(transactionList(p.input.transactions, period)).balanceEur), month).toBe(cents(net.balanceEur))
      expect(cents(resultDrill(p.input.transactions, p.input.trips, period).eur), month).toBe(cents(net.balanceEur))
      // Profiel A heeft rekeningen met standen (ook overboekingen tussen eigen rekeningen): die zijn geen transacties
      // en tellen dus niet mee. Alleen dagen van die maand.
      for (const date of days.keys()) expect(date.startsWith(month)).toBe(true)
    }
  })
})

describe('regels', () => {
  it('een fooi in dollars wordt omgerekend zoals in Geld', () => {
    const tip = tx('fooi-usd', '2026-10-10', 'fooi', 100, 'USD')
    const day = dayNets([tip], '2026-10').get('2026-10-10')!
    expect(day.balanceEur).toBe(eurValue(tip)!.eur)
    expect(day.balanceEur).toBe(80)
  })

  it('een grote uitgave maakt één dag rood: niet verdeeld over meerdere dagen', () => {
    const flight = tx('vlucht', '2026-10-05', 'kosten', 950, 'EUR', { category: 'vervoer' })
    const tip = tx('fooi', '2026-10-07', 'fooi', 60)
    const days = dayNets([flight, tip], '2026-10')
    expect([...days.keys()].sort()).toEqual(['2026-10-05', '2026-10-07'])
    expect(days.get('2026-10-05')!.balanceEur).toBe(-950)
    expect(days.get('2026-10-07')!.balanceEur).toBe(60)
    expect(monthNet([flight, tip], '2026-10').balanceEur).toBe(-890)
  })

  it('geen verwacht salaris en geen "geen salaris"; een ontvangen salaris telt op de dag van ontvangst; verwijderd telt niet', () => {
    const expected = tx('salaris:a', '2026-10-20', 'loon', 1200, 'EUR', { status: 'verwacht', tripId: 'a' })
    const none = tx('salaris:b', '2026-10-21', 'loon', 0, 'EUR', { status: 'geen', tripId: 'b' })
    const received = tx('salaris:c', '2026-10-22', 'loon', 1000, 'EUR', { status: 'ontvangen', tripId: 'c' })
    const gone = { ...tx('weg', '2026-10-23', 'kosten', 40), deletedAt: T }
    const days = dayNets([expected, none, received, gone], '2026-10')
    expect([...days.keys()]).toEqual(['2026-10-22'])
    expect(days.get('2026-10-22')!.balanceEur).toBe(1000)
  })

  it('een terugbetaling telt mee in het netto, zoals in "Zeilgeld: resultaat"', () => {
    const cost = tx('decl', '2026-10-03', 'kosten', 25, 'EUR', { claimId: 'c1' })
    const back = tx('terug', '2026-10-09', 'terugbetaling', 25, 'EUR', { claimId: 'c1' })
    expect(monthNet([cost, back], '2026-10').balanceEur).toBe(0)
    expect(dayMoney([cost, back], '2026-10-09')).toMatchObject({ list: [back], totals: { balanceEur: 25 } })
  })
})

describe('kort in de dagtegel', () => {
  it('+120, −85, +1,2k, −12k, en leeg bij nul', () => {
    expect(compactEur(120, 'nl')).toBe('+120')
    expect(compactEur(-85.4, 'nl')).toBe('−85')
    expect(compactEur(1234, 'nl')).toBe('+1,2k')
    expect(compactEur(1234, 'en')).toBe('+1.2k')
    expect(compactEur(-1000, 'nl')).toBe('−1k')
    expect(compactEur(-12_345, 'en')).toBe('−12k')
    expect(compactEur(0.3, 'nl')).toBe('')
    expect(compactEur(0, 'en')).toBe('')
  })
})
