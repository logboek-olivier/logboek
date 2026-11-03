import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { forecastDrills, type Drill } from '../src/domain/doorklik'
import { blokToevoegen, blokVerplaatsen, blokVerwijderen, scenarioActiveren, scenarioBeginAanpassen, scenarioMaken, scenarioVerwijderen } from '../src/domain/geld'
import { buildIndex } from '../src/model/calendar'
import { dayAverages } from '../src/model/costs'
import { forecast, positionAt, type Forecast } from '../src/model/position'
import { SCHEMA_VERSION, WRITER_VERSION } from '../src/model/schema'
import { decodeRecords, encodeRecords } from '../src/storage/sync'
import { setRates } from '../src/model/rates'
import { activeScenario, blockRanges, monthlyRate, scenarioEnd, scenarioParts, scenarioPlan, scenarioStart } from '../src/model/scenario'
import { currentSettings } from '../src/model/settings'
import type { Scenario, Settings } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { profileA, profileB, RATES, T, TODAY, type Profile } from './helpers/profielen'

// Geld → Verwacht: Gepland en Scenario (src/model/scenario.ts, `forecast` in src/model/position.ts). De som is zichtbaar
// en sluit in centen: netto waarde vandaag + salaris + geschatte fooien + scenario-inkomen − kosten = netto waarde op de
// einddatum; elke regel opent posten die optellen tot die regel. Met de twee nepprofielen (tests/helpers/profielen.ts).

beforeAll(() => setRates(RATES))
afterAll(() => setRates(null))

const cents = (n: number) => Math.round(n * 100)

const scenario = (blocks: Scenario['blocks'], startDate?: string): Scenario => ({ id: 'sc-1', name: 'Nepscenario', ...(startDate ? { startDate } : {}), blocks, updatedAt: T, deletedAt: null })
const EXAMPLE = scenario([
  { id: 'b1', weeks: 20, incomePerWeek: 2000, currency: 'EUR' },
  { id: 'b2', weeks: 10, incomePerWeek: 1000, currency: 'EUR' },
])

/** De vooruitblik zoals Geld → Verwacht hem rekent, met de kosten (vaste lasten en het gemiddelde per dagsoort). */
function outlook(p: Profile, planningEnd: string | null, s: Scenario | null, to?: string, settings: Settings = p.settings): Forecast {
  const index = buildIndex([], p.input.trips, p.input.legs, [], [])
  const averages = dayAverages(p.input.transactions, index, TODAY, settings)
  const plan = s ? scenarioPlan(s, planningEnd, TODAY) : null
  const end = to ?? plan?.end ?? planningEnd ?? TODAY
  return forecast(p.input, settings, TODAY, planningEnd, 6, { fixed: p.fixed, averages, index }, { from: '2026-01-01', to: end }, plan)
}

function closes(d: Drill): void {
  expect(d.groups.reduce((n, g) => n + cents(g.eur), 0)).toBe(cents(d.eur))
  for (const g of d.groups) expect(g.posts.reduce((n, x) => n + cents(x.eur ?? 0), 0), g.key).toBe(cents(g.eur))
}

/** De som sluit, begint bij de netto waarde van vandaag (zoals Mijn positie) en elke regel telt op tot zijn posten. */
function sumCloses(p: Profile, f: Forecast): void {
  const lines = f.lines!
  expect(lines).not.toBeNull()
  const today = positionAt(p.input, TODAY)
  expect(lines.start).toBe(today.totals.net.eur)
  expect(cents(lines.start) + cents(lines.salary) + cents(lines.tips) + cents(lines.scenario) + cents(lines.costs) + cents(lines.oneOffs) + cents(lines.growth)).toBe(cents(lines.end))
  expect(f.endEur).toBe(lines.end)
  // Het laatste punt van de grafiek is het einde van de som.
  expect(f.months.at(-1)!.eur).toBe(lines.end)
  const drills = forecastDrills(f, today, p.input.trips, RATES)
  for (const d of Object.values(drills)) closes(d)
  expect([drills.start.eur, drills.salary.eur, drills.tips.eur, drills.scenario.eur, drills.costs.eur, drills.oneOffs.eur, drills.growth.eur]).toEqual([lines.start, lines.salary, lines.tips, lines.scenario, lines.costs, lines.oneOffs, lines.growth])
}

describe('schemaversie 4', () => {
  it('leest bestanden van versie 2 en 3 (standen, instellingen) ongewijzigd in en schrijft versie 4 met schrijfversie 10', () => {
    const p = profileA()
    const v2 = (records: readonly unknown[]) => new TextEncoder().encode(JSON.stringify({ format: 'logboek-collection', schemaVersion: 2, minWriterVersion: 6, records }))
    expect(decodeRecords('balances.json.enc', v2(p.input.balances))).toEqual(p.input.balances)
    expect(decodeRecords('settings.json.enc', v2([p.settings]))).toEqual([p.settings])
    expect(SCHEMA_VERSION).toBe(4)
    expect(WRITER_VERSION).toBe(10)
    const v3 = (records: readonly unknown[]) => new TextEncoder().encode(JSON.stringify({ format: 'logboek-collection', schemaVersion: 3, minWriterVersion: 9, records }))
    expect(decodeRecords('settings.json.enc', v3([p.settings]))).toEqual([p.settings])
    expect(JSON.parse(new TextDecoder().decode(encodeRecords([EXAMPLE])))).toMatchObject({ schemaVersion: 4, minWriterVersion: 10 })
  })
})

describe('blokken', () => {
  it('het eerste blok begint de dag na de planning, elk volgend direct na het vorige', () => {
    const ranges = blockRanges(EXAMPLE, scenarioStart(EXAMPLE, '2027-01-24', TODAY))
    expect(ranges.map((r) => [r.number, r.from, r.to])).toEqual([
      [1, '2027-01-25', '2027-06-13'],
      [2, '2027-06-14', '2027-08-22'],
    ])
    // Een eigen begindatum gaat voor.
    expect(scenarioStart({ startDate: '2027-03-01' }, '2027-01-24', TODAY)).toBe('2027-03-01')
    // Zonder planning: de dag na vandaag.
    expect(scenarioStart({}, null, TODAY)).toBe('2026-11-03')
  })

  it('een blok over de jaargrens: per maand naar rato, samen precies weken × bedrag', () => {
    const s = scenario([{ id: 'b', weeks: 4, incomePerWeek: 1000, currency: 'USD', costsPerWeek: 70 }], '2026-12-15')
    const parts = scenarioParts(blockRanges(s, '2026-12-15'), '2027-12-31', RATES)
    expect(parts.map((x) => [x.month, x.days])).toEqual([
      ['2026-12', 17],
      ['2027-01', 11],
    ])
    expect(parts.reduce((n, x) => n + cents(x.income), 0)).toBe(400000)
    expect(parts.reduce((n, x) => n + cents(x.costs!), 0)).toBe(28000)
    // In euro: 4000 USD / 1,25 = 3200.
    expect(parts.reduce((n, x) => n + cents(x.incomeEur!), 0)).toBe(320000)
  })
})

describe.each([
  ['A', profileA, '2027-01-24'],
  ['B', profileB, null],
] as const)('profiel %s: de vooruitblik sluit', (_, make, planningEnd) => {
  it('Gepland: vandaag + salaris + fooien − kosten = einde, en elke regel telt op', () => {
    const p = make()
    const f = outlook(p, planningEnd, null)
    sumCloses(p, f)
    expect(f.lines!.scenario).toBe(0)
  })

  it('Scenario: plus 20 weken × € 2.000 en 10 weken × € 1.000 na de planning', () => {
    const p = make()
    const f = outlook(p, planningEnd, EXAMPLE)
    sumCloses(p, f)
    expect(f.lines!.scenario).toBe(50000)
    // Scenario = Gepland tot het einde van de planning, plus het scenario en de kosten van de weken erna.
    const planned = outlook(p, planningEnd, null)
    expect(f.lines!.salary).toBe(planned.lines!.salary)
    expect(f.lines!.tips).toBe(planned.lines!.tips)
  })
})

describe('kosten', () => {
  it('kosten per week in een blok vervangen het gemiddelde per dagsoort; vaste lasten lopen door', () => {
    const p = profileA()
    const settings: Settings = { ...p.settings, costDefaults: { thuis: 10, reis: 10, werk: 10, rust: 10 } }
    const own = scenario([{ id: 'b', weeks: 2, incomePerWeek: 0, currency: 'EUR', costsPerWeek: 35 }], '2027-02-01')
    const average = scenario([{ id: 'b', weeks: 2, incomePerWeek: 0, currency: 'EUR' }], '2027-02-01')
    const withOwn = outlook(p, '2027-01-24', own, '2027-02-14', settings)
    const withAverage = outlook(p, '2027-01-24', average, '2027-02-14', settings)
    sumCloses(p, withOwn)
    sumCloses(p, withAverage)
    // Twee weken: eigen kosten 2 × 35 = 70 in plaats van 14 dagen × 10 = 140 (en dezelfde vaste lasten).
    expect(cents(withOwn.lines!.costs) - cents(withAverage.lines!.costs)).toBe(7000)
    expect(withOwn.items.filter((i) => i.kind === 'scenario-kosten').reduce((n, i) => n + cents(i.eur), 0)).toBe(-7000)
    expect(withOwn.items.filter((i) => i.kind === 'vaste-lasten')).toEqual(withAverage.items.filter((i) => i.kind === 'vaste-lasten'))
  })

  it('kosten tellen tot en met de einddatum, niet tot het einde van die maand', () => {
    const p = profileA()
    const f = outlook(p, '2027-01-24', null)
    // Vaste lasten van € 50 per maand: januari tot en met de 24e = 50 × 24 / 31.
    expect(f.items.find((i) => i.kind === 'vaste-lasten' && i.date.startsWith('2027-01'))).toMatchObject({ date: '2027-01-24', eur: -38.71 })
  })
})

describe('bevindingen van de review', () => {
  it('een einddatum in de lopende maand: het laatste punt van de grafiek is het einde; einde = vandaag geeft de netto waarde van vandaag', () => {
    const p = profileA()
    const f = outlook(p, '2027-01-24', null, '2026-11-30')
    sumCloses(p, f)
    expect(f.months.at(-1)).toMatchObject({ date: '2026-11-30', eur: f.lines!.end })
    const today = outlook(p, '2027-01-24', null, TODAY)
    expect(today.lines!.end).toBe(positionAt(p.input, TODAY).totals.net.eur)
    // Niets in de vooruitblik valt op vandaag of eerder.
    expect(outlook(p, '2027-01-24', EXAMPLE).items.every((i) => i.date > TODAY)).toBe(true)
  })

  it('maandelijkse uitbetaling: het salaris telt vanaf het einde van de tocht, zoals te ontvangen in de netto waarde daarna', () => {
    const p = profileA()
    const settings: Settings = { ...p.settings, payouts: { 'org:noord': { kind: 'maandelijks', day: 15 } } }
    const f = outlook(p, '2027-01-24', null, '2026-12-31', settings)
    sumCloses(p, f)
    // a26-4 eindigt 11 december en wordt 15 januari uitbetaald: op 31 december is het te ontvangen.
    expect(f.items.find((i) => i.kind === 'salaris')).toMatchObject({ date: '2026-12-11', payout: '2027-01-15', eur: 1200 })
    expect(f.lines!.salary).toBe(positionAt(p.input, '2026-12-31').totals.receivable.eur - positionAt(p.input, TODAY).totals.receivable.eur)
  })

  it('een scenario met een begindatum in het verleden telt alleen de dagen na vandaag', () => {
    const p = profileB()
    const past = scenario([{ id: 'b', weeks: 10, incomePerWeek: 1000, currency: 'EUR' }], '2026-09-01')
    const f = outlook(p, null, past)
    sumCloses(p, f)
    // 10 weken vanaf 1 september lopen tot en met 9 november: alleen 3 tot en met 9 november (7 dagen = 1 week) telt.
    expect(f.lines!.scenario).toBe(1000)
  })

  it('een vaste last zonder koers valt niet stil weg: hij staat apart per valuta', () => {
    const p = profileA()
    p.fixed.push({ id: 'gbp', name: 'Nepabonnement', currency: 'GBP', amounts: [{ from: '2026-01', amount: 100 }], updatedAt: T, deletedAt: null })
    const f = outlook(p, '2027-01-24', null)
    sumCloses(p, f)
    // November vanaf de 3e (28 van 30 dagen), december, januari tot en met de 24e (24 van 31): 93,33 + 100 + 77,42.
    expect(f.other.GBP).toBe(-270.75)
  })
})

describe('aannames, eenmalige uitgaven en horizon', () => {
  const invest = (growthPct: number, extra: Partial<Scenario> = {}): Scenario => ({ ...scenario([], undefined), assumptions: { investmentGrowthPct: growthPct }, endDate: '2027-11-02', ...extra })

  it('groei beleggingen: twaalf volle maanden geven precies het jaarpercentage, naar rato van de dagen; de som sluit', () => {
    const p = profileB()
    // Alleen beleggingen van 10.000, geen inkomen: de groei is de enige regel.
    const input = { ...p.input, accounts: [{ id: 'b-beleg', name: 'Nepbeleggen', provider: 'bux' as const, kind: 'beleggen' as const, currency: 'EUR' as const, updatedAt: T, deletedAt: null }], balances: [{ id: 'stand:b-beleg:2026-11-01', accountId: 'b-beleg', date: '2026-11-01', amount: 10000, source: 'handmatig' as const, updatedAt: T, deletedAt: null }], transactions: [], trips: [] }
    const q: Profile = { ...p, input }
    // Van morgen (3 november) tot en met 30 november 2027: 13 maandelijkse stappen met de maandrente.
    const f = outlook(q, null, invest(12, { endDate: '2027-11-30' }))
    sumCloses(q, f)
    const r = monthlyRate(12)
    expect(r).toBeCloseTo(Math.pow(1.12, 1 / 12) - 1, 12)
    let expected = 1000000
    const steps: [number][] = [[28 / 30], ...Array.from({ length: 12 }, () => [1] as [number])]
    for (const [frac] of steps) expected += Math.round(expected * r * frac)
    expect(cents(f.lines!.growth)).toBe(expected - 1000000)
    expect(f.items.filter((i) => i.kind === 'groei')).toHaveLength(13)
    expect(f.items.every((i) => i.kind !== 'groei' || i.growth?.group === 'beleggen')).toBe(true)
    expect(f.lines!.investmentsEnd).toBe(expected / 100)
    // Twaalf volle maanden (december tot en met november) zijn samen precies 12 procent van de stand op 30 november.
    const dec = f.items.find((i) => i.kind === 'groei' && i.growth!.month === '2026-12')!
    const afterNov = cents(dec.growth!.opening)
    const nov = f.items.filter((i) => i.kind === 'groei' && i.growth!.month === '2027-11')[0]!
    expect(cents(nov.growth!.opening) + cents(nov.eur)).toBeCloseTo(Math.round(afterNov * 1.12), -1)
  })

  it('zonder aannames geen groei; bezittingen groeien apart; rente laat een schuld groeien (negatief)', () => {
    const p = profileA()
    const none = outlook(p, '2027-01-24', scenario([]))
    expect(none.lines!.growth).toBe(0)
    expect(none.items.some((i) => i.kind === 'groei')).toBe(false)
    const s = { ...scenario([]), assumptions: { assetGrowthPct: 2, debtInterestPct: 3 }, endDate: '2027-01-24' }
    const f = outlook(p, '2027-01-24', s)
    sumCloses(p, f)
    const groups = new Set(f.items.filter((i) => i.kind === 'groei').map((i) => i.growth!.group))
    expect(groups).toEqual(new Set(['bezit', 'schuld']))
    expect(f.items.filter((i) => i.growth?.group === 'bezit').every((i) => i.eur > 0)).toBe(true)
    expect(f.items.filter((i) => i.growth?.group === 'schuld').every((i) => i.eur < 0)).toBe(true)
  })

  it('een deel van het inkomen beleggen: de inleg groeit mee, en staat ter informatie (de som verandert alleen door de groei)', () => {
    const p = profileB()
    // Inkomen in november en december uit een blok; 50% belegd met 12% groei.
    const s: Scenario = { ...scenario([{ id: 'b', weeks: 8, incomePerWeek: 700, currency: 'EUR' }], '2026-11-03'), assumptions: { investmentGrowthPct: 12, investPct: 50 }, endDate: '2026-12-31' }
    const f = outlook(p, null, s)
    sumCloses(p, f)
    // 8 weken × 700 = 5600 inkomen; de helft belegd.
    expect(f.lines!.scenario).toBe(5600)
    expect(f.lines!.invested).toBe(2800)
    expect(f.lines!.growth).toBeGreaterThan(0)
    expect(f.lines!.investmentsEnd).toBe(2800 + f.lines!.growth)
    const without = outlook(p, null, { ...s, assumptions: { investmentGrowthPct: 12 } })
    expect(without.lines!.growth).toBe(0)
    expect(without.lines!.invested).toBe(0)
  })

  it('eenmalige uitgaven: na vandaag en binnen de horizon, in euro met de koers; de horizon volgt de laatste uitgave', () => {
    const p = profileB()
    const s: Scenario = { ...scenario([]), oneOffs: [
      { id: 'auto', name: 'Nepauto', date: '2027-03-15', amount: 15000, currency: 'EUR' },
      { id: 'vakantie', name: 'Nepvakantie', date: '2027-08-01', amount: 2500, currency: 'USD' },
      { id: 'voorbij', name: 'Al geweest', date: '2026-10-01', amount: 999, currency: 'EUR' },
    ] }
    const plan = scenarioPlan(s, null, TODAY)
    expect(plan.end).toBe('2027-08-01')
    expect(scenarioEnd(plan.ranges)).toBeNull()
    const f = outlook(p, null, s)
    sumCloses(p, f)
    // 15000 + 2500 USD / 1,25 = 17000; de uitgave in het verleden telt niet.
    expect(f.lines!.oneOffs).toBe(-17000)
    expect(f.items.filter((i) => i.kind === 'eenmalig').map((i) => i.oneOff!.id)).toEqual(['auto', 'vakantie'])
    // Een eigen horizon vóór de laatste uitgave: die uitgave valt buiten de vooruitblik.
    const shorter = outlook(p, null, { ...s, endDate: '2027-06-30' })
    expect(shorter.lines!.oneOffs).toBe(-15000)
    // Een horizon van 30 jaar: de vooruitblik loopt gewoon door (en niet verder dan 40 jaar).
    expect(scenarioPlan({ ...s, endDate: '2099-01-01' }, null, TODAY).end).toBe('2066-11-02')
  })
})

describe('bevindingen van de review (aannames)', () => {
  it('de horizon geldt ook als de periode bovenaan later eindigt: blokken, eenmalige uitgaven en eigen kosten stoppen bij de horizon', () => {
    const p = profileB()
    const s: Scenario = { ...scenario([{ id: 'b', weeks: 20, incomePerWeek: 1000, currency: 'EUR', costsPerWeek: 100 }], '2026-11-03'), endDate: '2026-11-30', oneOffs: [{ id: 'x', name: 'Nepuitgave', date: '2026-12-15', amount: 500, currency: 'EUR' }] }
    const f = outlook(p, null, s, '2026-12-31')
    sumCloses(p, f)
    // November: 28 dagen van 140 (20 weken): 4000 inkomen en 400 kosten; niets in december.
    expect(f.lines!.scenario).toBe(4000)
    expect(f.lines!.oneOffs).toBe(0)
    expect(f.items.filter((i) => i.kind === 'scenario-kosten').reduce((n, i) => n + cents(i.eur), 0)).toBe(-40000)
    expect(f.items.every((i) => i.kind === 'vaste-lasten' || i.kind === 'kosten' || i.date <= '2026-11-30')).toBe(true)
  })

  it('een stand zonder koers staat apart; de som en de groei gaan over het eurodeel (alleen de inleg groeit)', () => {
    const p = profileB()
    const input = { ...p.input, rates: null, accounts: [{ id: 'b-usd', name: 'Nepdollars', provider: 'revolut' as const, kind: 'beleggen' as const, currency: 'USD' as const, updatedAt: T, deletedAt: null }], balances: [{ id: 'stand:b-usd:2026-11-01', accountId: 'b-usd', date: '2026-11-01', amount: 1000, source: 'handmatig' as const, updatedAt: T, deletedAt: null }] }
    const s: Scenario = { ...scenario([{ id: 'b', weeks: 4, incomePerWeek: 1000, currency: 'EUR' }], '2026-11-03'), assumptions: { investmentGrowthPct: 12, investPct: 50 } }
    const f = outlook({ ...p, input }, null, s)
    // De dollars staan apart (niet in de euro-getallen): de stand van 1.000 en het te ontvangen salaris van 3.000 van de
    // voorbije tocht; het eurodeel van vandaag is 0.
    expect(f.unpriced).toEqual({ USD: 4000 })
    expect(f.lines).not.toBeNull()
    expect(f.lines!.start).toBe(0)
    // Groei alleen over de belegde inleg (50% van 4.000), nooit over de stand zonder koers.
    expect(f.lines!.invested).toBe(2000)
    expect(f.lines!.growth).toBeGreaterThan(0)
    expect(f.lines!.growth).toBeLessThan(2000 * 0.12 / 12 * 2)
    expect(cents(f.lines!.start + f.lines!.scenario + f.lines!.growth)).toBe(cents(f.lines!.end))
  })
})

describe('opdrachten en synchroniseren', () => {
  let counter = 0
  async function device(github: FakeGithub, key: CryptoKey): Promise<Store> {
    return Store.open(await openLogboekDb(`logboek-scenario-${++counter}`), key, new GithubClient('github_pat_SCENARIO_0123456789abcdefghijklmnopqrstuvw', github.fetch))
  }

  it('maken (meteen actief), blokken toevoegen, verplaatsen en verwijderen, en op een ander apparaat hetzelfde scenario', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const github = new FakeGithub()
    const laptop = await device(github, key)
    const phone = await device(github, key)
    const { result: created } = await scenarioMaken(laptop, 'Nepplan')
    expect(currentSettings(laptop.list('settings.json.enc')).activeScenarioId).toBe(created.id)
    await blokToevoegen(laptop, created.id, { weeks: 20, incomePerWeek: 2000, currency: 'EUR' })
    await blokToevoegen(laptop, created.id, { weeks: 10, incomePerWeek: 1000, currency: 'EUR', costsPerWeek: 300 })
    const [first, second] = laptop.list('scenarios.json.enc')[0]!.blocks
    await blokVerplaatsen(laptop, created.id, second!.id, -1)
    expect(laptop.list('scenarios.json.enc')[0]!.blocks.map((b) => b.weeks)).toEqual([10, 20])
    const { undo } = await blokVerwijderen(laptop, created.id, first!.id)
    expect(laptop.list('scenarios.json.enc')[0]!.blocks).toHaveLength(1)
    await undo()
    expect(laptop.list('scenarios.json.enc')[0]!.blocks.map((b) => b.weeks)).toEqual([10, 20])
    await scenarioBeginAanpassen(laptop, created.id, '2027-03-01')
    await laptop.sync()
    await phone.sync()
    const there = phone.list('scenarios.json.enc')
    expect(there).toEqual(laptop.list('scenarios.json.enc'))
    expect(activeScenario(there, currentSettings(phone.list('settings.json.enc')).activeScenarioId)).toMatchObject({ name: 'Nepplan', startDate: '2027-03-01' })
    // Twee scenario's, één actief; verwijderen laat een tombstone zonder naam of bedragen achter, met ongedaan maken.
    const { result: other } = await scenarioMaken(phone, 'Nepplan B')
    await scenarioActiveren(phone, created.id)
    const undoDelete = await scenarioVerwijderen(phone, other.id)
    const tomb = phone.get('scenarios.json.enc').find((s) => s.id === other.id)!
    expect(tomb).toMatchObject({ name: '', blocks: [], deletedAt: expect.any(String) })
    await undoDelete()
    expect(phone.list('scenarios.json.enc').map((s) => s.name).sort()).toEqual(['Nepplan', 'Nepplan B'])
    await phone.sync()
    await laptop.sync()
    expect(laptop.list('scenarios.json.enc').map((s) => s.name).sort()).toEqual(['Nepplan', 'Nepplan B'])
  })
})
