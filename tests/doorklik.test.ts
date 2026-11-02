import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actualCostsDrill, changeDrills, costsDrill, incomeDrill, investmentDrill, organisationDrill, receivableDrill, reimbursedDrill, resultDrill, taxGroupDrill, type Drill } from '../src/domain/doorklik'
import { perOrganisation, transactionList, yearOverview, type ReportPeriod } from '../src/domain/geldrapport'
import { actualCosts } from '../src/model/actual-costs'
import { careerInvestment } from '../src/model/expenses'
import { eurOf, totals } from '../src/model/money'
import { careerStart, netWorthChange, positionAt, resolvePeriod, type Position } from '../src/model/position'
import { setRates } from '../src/model/rates'
import { setOrganisations, LEGACY_ORGS } from '../src/basis/organisatie'
import { profileA, profileB, RATES, TODAY, type Profile } from './helpers/profielen'

// Doorklikken in Geld en de verandering van de netto waarde (src/domain/doorklik.ts, src/model/position.ts), met twee
// nepprofielen (tests/helpers/profielen.ts). Invarianten: elk doorklikscherm telt op tot het getikte bedrag, Inkomsten is
// de som van zijn posten in dezelfde periode, en de netto waarde op een dag sluit met de uitsplitsing. Verwachte bedragen
// met de hand uitgerekend (1 EUR = 1,25 USD).

beforeAll(() => setRates(RATES))
afterAll(() => {
  setRates(null)
  setOrganisations(LEGACY_ORGS)
})

const cents = (n: number) => Math.round(n * 100)

/** Elk doorklikscherm telt op: de groepen tot het totaal, de posten tot hun groep. */
function closes(d: Drill): void {
  expect(d.groups.reduce((n, g) => n + cents(g.eur), 0)).toBe(cents(d.eur))
  for (const g of d.groups) expect(g.posts.filter((p) => p.eur !== null).reduce((n, p) => n + cents(p.eur!), 0), g.key).toBe(cents(g.eur))
}

/** De netto waarde op een dag is de som van haar delen. */
function netCloses(p: Position): void {
  const parts = ['bank', 'cash', 'receivable', 'investments', 'debts'] as const
  expect(parts.reduce((n, k) => n + cents(p.totals[k].eur), 0)).toBe(cents(p.totals.net.eur))
  const rows = [...p.bank, ...p.cashAccounts, ...p.investments, ...p.debts]
  expect(rows.reduce((n, r) => n + cents(r.eur?.eur ?? 0), 0)).toBe(cents(p.totals.net.eur) - cents(p.totals.receivable.eur))
}

function periods(profile: Profile): ReportPeriod[] {
  return [
    resolvePeriod({ preset: 'carriere' }, profile.settings, TODAY, null, '2025-07-05'),
    resolvePeriod({ preset: 'jaar' }, profile.settings, TODAY, null, null),
    resolvePeriod({ preset: 'alles' }, profile.settings, TODAY, '2027-01-24', '2025-07-05'),
    { from: '2026-03-01', to: '2026-09-30' },
    { from: '2025-01-01', to: '2025-12-31' },
  ]
}

describe.each([
  ['A', profileA],
  ['B', profileB],
])('profiel %s: elk bedrag in Geld en zijn doorklikscherm komen uit dezelfde posten', (_, make) => {
  it('Inkomsten, Uitgaven, Terugbetaald, Investering en Zeilgeld: resultaat tellen op tot het getikte bedrag', () => {
    const p = make()
    setOrganisations(p.settings.organisations ?? [])
    const { transactions, trips } = p.input
    for (const period of periods(p)) {
      const list = transactionList(transactions, period)
      const shown = totals(list)
      const drills = {
        income: incomeDrill(transactions, trips, period),
        costs: costsDrill(transactions, trips, period),
        reimbursed: reimbursedDrill(transactions, trips, period),
        result: resultDrill(transactions, trips, period),
        investment: investmentDrill(transactions, trips, period),
      }
      for (const d of Object.values(drills)) closes(d)
      expect(drills.income.eur, `inkomsten ${period.from}`).toBe(shown.incomeEur)
      expect(drills.costs.eur).toBe(shown.costsEur)
      expect(drills.reimbursed.eur).toBe(shown.reimbursedEur)
      expect(drills.result.eur).toBe(shown.balanceEur)
      expect(drills.investment.eur).toBe(careerInvestment(list, eurOf).eur)
      // Inkomsten = de som van de posten in Inkomsten in dezelfde periode.
      const posts = drills.income.groups.flatMap((g) => g.posts)
      expect(posts.every((x) => x.date >= period.from && x.date <= period.to)).toBe(true)
      expect(posts.reduce((n, x) => n + cents(x.eur!), 0) / 100).toBe(shown.incomeEur)
    }
  })

  it('per organisatie, het jaaroverzicht en kosten per maand: elke regel en cel telt op tot zijn posten', () => {
    const p = make()
    setOrganisations(p.settings.organisations ?? [])
    const { transactions, trips } = p.input
    for (const period of periods(p)) {
      for (const g of perOrganisation(transactions, trips, period)) {
        const d = organisationDrill(transactions, trips, g.group, period)
        closes(d)
        const income = d.groups.filter((x) => x.section === 'inkomsten').reduce((n, x) => n + cents(x.eur), 0)
        const costs = d.groups.filter((x) => x.section === 'kosten').reduce((n, x) => n + cents(x.eur), 0)
        expect(income / 100, g.group).toBe(g.incomeEur)
        expect((0 - costs) / 100, g.group).toBe(g.costsEur)
      }
      for (const row of actualCosts(transactions, TODAY, 6, period)) {
        const fixed = actualCostsDrill(transactions, trips, row.month, 'vast', period)
        const loose = actualCostsDrill(transactions, trips, row.month, 'los', period)
        const total = actualCostsDrill(transactions, trips, row.month, 'totaal', period)
        for (const d of [fixed, loose, total]) closes(d)
        expect([fixed.eur, loose.eur, total.eur]).toEqual([row.fixedEur, row.looseEur, row.totalEur])
      }
    }
    for (const year of [2025, 2026]) {
      const overview = yearOverview(transactions, trips, year, RATES)
      for (const g of overview.groups) {
        const d = taxGroupDrill(transactions, trips, year, g.group, RATES)
        closes(d)
        expect(d.eur).toBe(g.eur)
      }
      // Inkomsten over dat kalenderjaar = Totaal verdiend in het jaaroverzicht (dezelfde functies).
      expect(incomeDrill(transactions, trips, { from: `${year}-01-01`, to: `${year}-12-31` }).eur).toBe(overview.totalEur)
    }
  })

  it('te ontvangen in Mijn positie: de posten tellen op tot het bedrag, en de netto waarde is de som van haar delen', () => {
    const p = make()
    for (const date of ['2026-01-01', '2026-06-30', '2026-10-25', TODAY]) {
      const position = positionAt(p.input, date)
      netCloses(position)
      const d = receivableDrill(position, p.input.trips, RATES)
      closes(d)
      expect(d.eur).toBe(position.totals.receivable.eur)
    }
  })
})

describe('profiel A (met de hand uitgerekend)', () => {
  it('bedragen in 2026 en over twee jaar: het verschil met het jaaroverzicht is per jaar te verklaren', () => {
    const { input } = profileA()
    const in2026 = totals(transactionList(input.transactions, { from: '2026-01-01', to: '2026-12-31' }))
    // 1200 + 2500 USD + 300 + 400 USD + 150 + 100 = 4070; terugbetaald 90; uitgaven 120 + 300 + 80 USD + 650 + 50 + 90 + 60.
    expect(in2026).toMatchObject({ incomeEur: 4070, reimbursedEur: 90, costsEur: 1334, balanceEur: 2826 })
    // Over 2025 en 2026 samen: 1750 + 4070; het jaaroverzicht van 2026 alleen 4070.
    const both = incomeDrill(input.transactions, input.trips, { from: '2025-01-01', to: '2026-12-31' })
    expect(both.eur).toBe(5820)
    expect(yearOverview(input.transactions, input.trips, 2026, RATES).totalEur).toBe(4070)
    expect(yearOverview(input.transactions, input.trips, 2025, RATES).totalEur).toBe(1750)
    // Investering: alleen de cursus in 2026; de oude investering zonder soort in 2025 staat als "zonder soort".
    expect(investmentDrill(input.transactions, input.trips, { from: '2025-01-01', to: '2026-12-31' }).groups.map((g) => [g.kind, g.eur])).toEqual([
      ['opleiding', 650],
      ['onbekend', 200],
    ])
  })

  it('verandering van de netto waarde sinds 1 januari 2026: sluit met zeilresultaat, te ontvangen en overig', () => {
    const { input } = profileA()
    const change = netWorthChange(input, { from: '2026-01-01', to: '2027-01-24' }, TODAY)
    expect(change.state).toBe('bekend')
    if (change.state !== 'bekend') return
    expect(change.to).toBe(TODAY)
    // Begin: 3000 + 10000 + 2000 − 20000 + 500 USD = −4600, niets te ontvangen. Einde: 6100 + 10500 + 2600 − 19000 +
    // 800 USD = 840, plus te ontvangen 2000 USD + declaratie 60 = 1660: 2500.
    expect(change.start.totals.net.eur).toBe(-4600)
    expect(change.end.totals.net.eur).toBe(2500)
    expect(change.change).toBe(7100)
    expect(change.sailing).toBe(2826)
    expect(change.receivable).toBe(1660)
    expect(change.other).toBe(2614)
    expect(cents(change.sailing) + cents(change.receivable) + cents(change.other)).toBe(cents(change.change))
    // Elke regel van de uitsplitsing opent posten die optellen tot die regel.
    const drills = changeDrills(change, input.transactions, input.trips, RATES)
    for (const d of Object.values(drills)) closes(d)
    expect(drills.sailing.eur).toBe(change.sailing)
    expect(drills.receivable.eur).toBe(change.receivable)
    expect(drills.other.eur).toBe(change.other)
    // Overig = de rekeningen samen (+3100 + 500 + 600 + 1000 + 240 USD) min het zeilresultaat.
    expect(change.accounts.map((a) => [a.account.id, a.eur])).toEqual([
      ['a-bank', 3100],
      ['a-beleg', 600],
      ['a-usd', 240],
      ['a-lening', 1000],
      ['a-spaar', 500],
    ])
  })

  it('geen saldo op de begindag: onbekend, met de rekeningen erbij; nooit een getal', () => {
    const { input } = profileA()
    const change = netWorthChange(input, { from: '2025-12-31', to: '2026-12-31' }, TODAY)
    expect(change).toMatchObject({ state: 'onbekend', from: '2025-12-31' })
    expect(change.state === 'onbekend' && change.missing.map((a) => a.name)).toEqual(['Nepbeleggen', 'Nepdollars', 'Nepspaar'])
    expect('change' in change).toBe(false)
  })

  it('een periode in de toekomst: geen verandering', () => {
    const { input } = profileA()
    expect(netWorthChange(input, { from: '2026-12-01', to: '2027-01-31' }, TODAY).state).toBe('toekomst')
  })
})

describe('profiel B: één organisatie, alleen dollars, geen rekeningen, geen planning, geen start zeilcarrière', () => {
  it('de periode is dit jaar, er is geen verandering van de netto waarde, en de bedragen kloppen in euro', () => {
    const { input, settings } = profileB()
    expect(careerStart(settings)).toBeNull()
    expect(resolvePeriod({ preset: 'carriere' }, settings, TODAY, null, null)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(netWorthChange(input, { from: '2026-01-01', to: '2026-12-31' }, TODAY).state).toBe('geen-rekeningen')
    // 6000 USD salaris + 1050 USD fooi = 5640 EUR; 200 USD kosten = 160.
    expect(totals(transactionList(input.transactions, { from: '2026-01-01', to: '2026-12-31' }))).toMatchObject({ incomeEur: 5640, costsEur: 160, balanceEur: 5480 })
    setOrganisations(settings.organisations ?? [])
    expect(perOrganisation(input.transactions, input.trips).map((g) => g.group)).toEqual(['org:een'])
    // Te ontvangen: het salaris van de laatste tocht (3000 USD).
    expect(receivableDrill(positionAt(input, TODAY), input.trips, RATES).eur).toBe(2400)
  })
})
