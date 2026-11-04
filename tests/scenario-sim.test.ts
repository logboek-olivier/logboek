import { describe, expect, it } from 'vitest'
import { fromHistory, simEnd, simMonths, simulate, simStart, type SimInput } from '../src/model/scenario-sim'
import type { FixedCost, Scenario, Transaction } from '../src/model/types'

// Het stappenplan van een scenario (src/model/scenario-sim.ts): week voor week vanaf de start, alles uit het scenario;
// het doel (waar sta ik, of wanneer haal ik een bedrag en wat is daarvoor per week nodig); het voorstel uit eerdere
// weken. Verzonnen bedragen, alles in euro.

const T = '2026-11-01T00:00:00.000Z'
const TODAY = '2026-11-02' // een maandag
const scenario = (extra: Partial<Scenario> = {}): Scenario => ({ id: 's', name: 'Nepplan', blocks: [], version: 2, updatedAt: T, deletedAt: null, ...extra })
const block = (weeks: number, salary: number, tips: number, costs?: number) => ({ id: `b${weeks}${salary}`, weeks, incomePerWeek: salary + tips, salaryPerWeek: salary, tipsPerWeek: tips, currency: 'EUR' as const, ...(costs !== undefined ? { costsPerWeek: costs } : {}) })
const input = (s: Scenario, extra: Partial<SimInput> = {}): SimInput => ({ scenario: s, today: TODAY, position: { net: 1000, investments: 0, assets: 0, debts: 0 }, defaultCostsPerWeek: 50, rates: null, ...extra })

describe('stappenplan: week voor week', () => {
  it('start vandaag met de netto waarde van vandaag, of een eigen startwaarde; standaard anderhalf jaar', () => {
    expect(simStart(scenario(), TODAY)).toBe(TODAY)
    expect(simStart(scenario({ startDate: '2026-10-01' }), TODAY)).toBe(TODAY)
    expect(simStart(scenario({ startDate: '2027-01-04' }), TODAY)).toBe('2027-01-04')
    expect(simEnd(scenario(), TODAY)).toBe('2028-05-02')
    const own = simulate(input(scenario({ startValue: 5000, endDate: '2026-11-15' })))
    expect(own).toMatchObject({ startValue: 5000, ownStart: true })
    expect(simulate(input(scenario({ endDate: '2026-11-15' })))).toMatchObject({ startValue: 1000, ownStart: false })
  })

  it('een blok: salaris, fooi en eigen kosten per week; daarna de gemiddelde kosten; de som sluit', () => {
    // 4 weken blok (salaris 700, fooi 300, kosten 200), daarna nog 2 weken met de gemiddelde kosten (50).
    const r = simulate(input(scenario({ blocks: [block(4, 700, 300, 200)], endDate: '2026-12-13' })))
    expect(r.weeks).toHaveLength(6)
    expect(r.weeks.map((w) => w.block)).toEqual([1, 1, 1, 1, null, null])
    expect(r.totals).toMatchObject({ salary: 2800, tips: 1200, costs: 900, oneOffs: 0, growth: 0 })
    expect(r.endValue).toBe(1000 + 2800 + 1200 - 900)
    expect(r.endValue).toBe(r.startValue + r.totals.salary + r.totals.tips - r.totals.costs - r.totals.oneOffs + r.totals.growth)
    const months = simMonths(r)
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-12'])
    expect(months.reduce((n, m) => n + m.income, 0)).toBe(4000)
  })

  it('beleggen en groei: 10% per jaar over een jaar is 10%; het belegde deel van het inkomen gaat naar de beleggingen', () => {
    const r = simulate(input(scenario({ assumptions: { investmentGrowthPct: 10 }, endDate: '2027-10-31' }), { position: { net: 1000, investments: 1000, assets: 0, debts: 0 }, defaultCostsPerWeek: 0 }))
    expect(r.weeks).toHaveLength(52)
    expect(r.totals.growth).toBeCloseTo(100, 0)
    const invest = simulate(input(scenario({ blocks: [block(2, 1000, 0, 0)], assumptions: { investPct: 25 }, endDate: '2026-11-15' }), { defaultCostsPerWeek: 0 }))
    expect(invest.totals.invested).toBe(500)
    expect(invest.endValue).toBe(3000)
  })

  it('eenmalige uitgaven op hun week, nooit vandaag of eerder; zonder koers apart per valuta', () => {
    const r = simulate(
      input(
        scenario({
          oneOffs: [
            { id: 'o1', name: 'Nepauto', date: '2026-11-10', amount: 400, currency: 'EUR' },
            { id: 'o2', name: 'Nepoud', date: TODAY, amount: 999, currency: 'EUR' },
            { id: 'o3', name: 'Nepdollar', date: '2026-11-11', amount: 100, currency: 'USD' },
          ],
          endDate: '2026-11-15',
        }),
        { defaultCostsPerWeek: 0 },
      ),
    )
    expect(r.totals.oneOffs).toBe(400)
    expect(r.unpriced).toEqual({ USD: 100 })
  })

  it('doel: wanneer gehaald (het laatste blok loopt door) en de winst per week die nodig is om het op tijd te halen', () => {
    // Elke week 500 winst (salaris 550, kosten 50); start 1000. 6000 is na 10 weken gehaald.
    const s = scenario({ blocks: [block(4, 550, 0, 50)], endDate: '2026-11-29', goal: { kind: 'doel', amount: 6000, by: '2027-01-24' } })
    const r = simulate(input(s))
    if (r.goal.kind !== 'doel') throw new Error('verwacht')
    expect(r.goal.reachedOn).toBe('2027-01-10')
    // Tot 24 januari (12 weken): het plan geeft 500 per week, dus 7000; nodig is minder.
    expect(r.goal.plannedPerWeek).toBe(500)
    expect(r.goal.valueOnBy).toBe(7000)
    expect(r.goal.neededPerWeek).toBeCloseTo(500 - 1000 / 12, 1)
    // Al gehaald bij de start.
    const already = simulate(input(scenario({ goal: { kind: 'doel', amount: 500 } })))
    if (already.goal.kind !== 'doel') throw new Error('verwacht')
    expect(already.goal.reachedOn).toBe(TODAY)
    // Nooit gehaald (geen inkomen, alleen kosten).
    const never = simulate(input(scenario({ goal: { kind: 'doel', amount: 1_000_000 } })))
    if (never.goal.kind !== 'doel') throw new Error('verwacht')
    expect(never.goal.reachedOn).toBeNull()
    // Waar sta ik: de waarde op de einddatum.
    expect(simulate(input(scenario({ endDate: '2026-11-15' }))).goal).toEqual({ kind: 'stand', date: '2026-11-15', value: 900 })
  })

  it('trips in een blok: 10 trips in 10 weken, evenredig verdeeld; het blok geeft samen precies trips × per trip', () => {
    const tripsBlock = { id: 'tb', weeks: 10, trips: 10, salaryPerTrip: 1000, tipsPerTrip: 300, incomePerWeek: 1300, salaryPerWeek: 1000, tipsPerWeek: 300, currency: 'EUR' as const, costsPerWeek: 0 }
    const r = simulate(input(scenario({ blocks: [tripsBlock], endDate: '2027-01-10' }), { defaultCostsPerWeek: 0 }))
    expect(r.weeks).toHaveLength(10)
    expect(r.totals).toMatchObject({ salary: 10000, tips: 3000 })
    // 7 trips in 3 weken: elke week een derde, samen precies 7 × 100.
    const odd = simulate(input(scenario({ blocks: [{ ...tripsBlock, weeks: 3, trips: 7, salaryPerTrip: 100, tipsPerTrip: 0 }], endDate: '2026-11-22' }), { defaultCostsPerWeek: 0 }))
    expect(odd.totals.salary).toBeCloseTo(700, 2)
  })

  it('doel op verdiend: salaris plus fooi opgeteld vanaf de start, los van de kosten', () => {
    // 500 inkomen per week (salaris 400, fooi 100), kosten 450: de netto waarde stijgt nauwelijks, het verdiende wel.
    const s = scenario({ blocks: [block(4, 400, 100, 450)], endDate: '2026-11-29', goal: { kind: 'doel', amount: 1500, by: '2026-11-29', measure: 'verdiend' } })
    const r = simulate(input(s))
    if (r.goal.kind !== 'doel') throw new Error('verwacht')
    expect(r.goal.measure).toBe('verdiend')
    // Na drie weken 1500 verdiend.
    expect(r.goal.reachedOn).toBe('2026-11-22')
    expect(r.goal.valueOnBy).toBe(2000)
    expect(r.goal.plannedPerWeek).toBe(500)
    expect(simMonths(r).at(-1)!.earned).toBe(2000)
  })

  it('een ouder scenario: de planning als eerste blok (niet opgeslagen), daarna de oude blokken met hun inkomen als salaris', () => {
    const old = scenario({ version: undefined, blocks: [{ id: 'oud', weeks: 2, incomePerWeek: 300, currency: 'EUR', costsPerWeek: 0 }], endDate: '2026-11-29' })
    const r = simulate(input(old, { planningBlock: block(2, 1000, 200, 100) }))
    expect(r.weeks.slice(0, 4).map((w) => [w.block, w.salary, w.tips])).toEqual([
      [1, 1000, 200],
      [1, 1000, 200],
      [2, 300, 0],
      [2, 300, 0],
    ])
  })
})

describe('voorstel uit eerdere weken', () => {
  it('per week het salaris en de fooi die binnenkwamen, de losse uitgaven en de vaste lasten; zonder declaraties of geboekte vaste lasten', () => {
    const tx = (id: string, date: string, kind: Transaction['kind'], amount: number, extra: Partial<Transaction> = {}): Transaction => ({ id, date, kind, amount, currency: 'EUR', source: 'overig', updatedAt: T, deletedAt: null, ...extra })
    const list = [
      tx('l', '2026-10-20', 'loon', 1200, { tripId: 'trip-a' }),
      tx('v', '2026-10-21', 'loon', 999, { status: 'verwacht' }),
      tx('f', '2026-10-22', 'fooi', 600, { tripId: 'trip-b' }),
      tx('k', '2026-10-23', 'kosten', 240),
      tx('d', '2026-10-24', 'kosten', 100, { claimId: 'c' }),
      tx('vast', '2026-10-31', 'kosten', 520, { fixedCostId: 'h' }),
      tx('oud', '2026-07-01', 'fooi', 5000),
    ]
    const fixed: FixedCost[] = [{ id: 'h', name: 'Nephuur', currency: 'EUR', amounts: [{ from: '2026-01', amount: 520 }], updatedAt: T, deletedAt: null }]
    expect(fromHistory(list, fixed, TODAY, 12)).toEqual({ salary: 100, tips: 50, costs: 20 + 120, tripsPerWeek: 2 / 12, salaryPerTrip: 600, tipsPerTrip: 300 })
  })
})
