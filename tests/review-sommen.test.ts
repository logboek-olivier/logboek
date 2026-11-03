import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { perOrganisation, transactionList, tripResult, yearOverview } from '../src/domain/geldrapport'
import { booked, expectedSalaries } from '../src/domain/geldmodel'
import { eurOf, isEarned, totals } from '../src/model/money'
import { setRates } from '../src/model/rates'
import { tripKind } from '../src/model/trip-kind'
import type { Currency, Transaction, TransactionKind, Trip } from '../src/model/types'
import { LEGACY_ORGS, setOrganisations } from '../src/basis/organisatie'
import { profileA, profileB, RATES, type Profile } from './helpers/profielen'

// Onafhankelijke review (docs/review.md, Werking): sluiten de sommen in Geld op elkaar, ook voor willekeurige
// gegevens en voor een gebruiker die niet op Olivier lijkt? Alles verzonnen; 1 EUR = 1,25 USD (tests/helpers/profielen.ts).
// - per organisatie = jaaroverzicht = transactielijst (verdiend, kosten en saldo), per jaar;
// - het resultaat van een tocht is de som van zijn transacties (salaris + fooi + overig − uitgaven);
// - alle tochtresultaten samen plus het geld zonder (levende) tocht = het saldo in Geld plus de verwachte salarissen
//   (die tellen in het resultaat van een tocht, maar zijn nog geen geld).

beforeAll(() => setRates(RATES))
afterAll(() => {
  setRates(null)
  setOrganisations(LEGACY_ORGS)
})

const T = '2026-11-01T12:00:00.000Z'
const cents = (n: number) => Math.round(n * 100)
const KINDS: TransactionKind[] = ['fooi', 'loon', 'bonus', 'terugbetaling', 'overig-inkomen', 'kosten', 'investering']
const CURRENCIES: Currency[] = ['EUR', 'USD']
const ORGS = ['org:a', 'org:b']

/** Deterministische pseudo-toevalsgenerator (mulberry32), zodat een falende reeks te herhalen is. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomData(seed: number): { trips: Trip[]; transactions: Transaction[] } {
  const r = rng(seed)
  const pick = <X>(xs: readonly X[]): X => xs[Math.floor(r() * xs.length)]!
  const day = () => {
    const y = pick([2025, 2026])
    const m = 1 + Math.floor(r() * 12)
    const d = 1 + Math.floor(r() * 28)
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const trips: Trip[] = []
  for (let i = 0; i < 6; i++) {
    const start = day()
    trips.push({ id: `t${i}`, name: `Neptocht ${i}`, kind: 'werk', type: 'skipper-charter', organisation: r() < 0.8 ? pick(ORGS) : undefined, startDate: start, endDate: start, updatedAt: T, deletedAt: r() < 0.15 ? T : null })
  }
  const transactions: Transaction[] = []
  for (let i = 0; i < 40; i++) {
    const kind = pick(KINDS)
    const link = r()
    const tx: Transaction = {
      id: `x${i}`,
      date: day(),
      kind,
      amount: kind === 'loon' && r() < 0.2 ? 0 : Math.round(r() * 300000) / 100 + 1,
      currency: pick(CURRENCIES),
      source: 'overig',
      updatedAt: T,
      deletedAt: r() < 0.1 ? T : null,
    }
    if (link < 0.65) tx.tripId = pick(trips).id
    else if (link < 0.85) tx.season = { org: pick(ORGS), year: pick([2025, 2026]) }
    if (kind === 'loon') tx.status = tx.amount === 0 ? 'geen' : pick(['verwacht', 'ontvangen', 'verwacht'])
    if (kind === 'kosten') tx.category = pick(['vervoer', 'eten', 'verblijf', 'overig'])
    if (kind === 'investering') tx.category = pick(['opleiding', 'uitrusting'])
    transactions.push(tx)
  }
  return { trips, transactions }
}

function checkReports(trips: readonly Trip[], transactions: readonly Transaction[], label: string): void {
  for (const y of [2025, 2026]) {
    const period = { from: `${y}-01-01`, to: `${y}-12-31` }
    const list = transactionList(transactions, period)
    const shown = totals(list)
    const orgs = perOrganisation(transactions, trips, period)
    const overview = yearOverview(transactions, trips, y, RATES)
    const earned = list.filter((tx) => isEarned(tx.kind)).reduce((n, tx) => n + cents(eurOf(tx) ?? 0), 0)
    expect(cents(orgs.reduce((n, g) => n + g.incomeEur, 0)), `${label} verdiend per organisatie ${y}`).toBe(earned)
    expect(cents(overview.totalEur), `${label} jaaroverzicht ${y}`).toBe(earned)
    expect(cents(shown.incomeEur), `${label} transactielijst ${y}`).toBe(earned)
    expect(cents(orgs.reduce((n, g) => n + g.costsEur, 0)), `${label} kosten per organisatie ${y}`).toBe(cents(shown.costsEur))
    expect(cents(orgs.reduce((n, g) => n + g.balanceEur, 0)), `${label} saldo per organisatie ${y}`).toBe(cents(shown.balanceEur))
    // Elke groep van het jaaroverzicht staat met hetzelfde bedrag in per organisatie.
    for (const g of overview.groups) {
      const org = orgs.find((o) => o.group === g.group)
      expect(org, `${label} groep ${g.group} ${y}`).toBeDefined()
      expect(cents(org!.incomeEur)).toBe(cents(g.eur))
    }
  }
}

function checkTripResults(trips: readonly Trip[], transactions: readonly Transaction[], label: string): void {
  const live = trips.filter((t) => t.deletedAt === null)
  const liveIds = new Set(live.map((t) => t.id))
  let sum = 0
  for (const trip of live) {
    const res = tripResult(trip, transactions)
    expect(cents(res.result.eur), `${label} resultaat ${trip.id} = som van de delen`).toBe(cents(res.salary.eur) + cents(res.tips.eur) + cents(res.otherIncome.eur) - cents(res.costs.eur))
    sum += cents(res.result.eur)
  }
  const all = booked(transactions)
  const unlinked = all.filter((tx) => !tx.tripId || !liveIds.has(tx.tripId))
  const unlinkedBalance = unlinked.reduce((n, tx) => n + (tx.kind === 'kosten' || tx.kind === 'investering' ? -1 : 1) * cents(eurOf(tx) ?? 0), 0)
  const expected = expectedSalaries(transactions)
    .filter((tx) => tx.tripId && liveIds.has(tx.tripId))
    .reduce((n, tx) => n + cents(eurOf(tx) ?? 0), 0)
  expect(sum + unlinkedBalance, `${label} tochten + los = saldo + verwacht salaris`).toBe(cents(totals(all).balanceEur) + expected)
}

describe('sommen in Geld sluiten op elkaar (onafhankelijke review)', () => {
  it.each([
    ['A (twee organisaties, euro en dollars, rekeningen, planning)', profileA],
    ['B (één organisatie, alleen dollars, geen rekeningen of planning)', profileB],
  ])('profiel %s: per organisatie = jaaroverzicht = transactielijst, en elk tochtresultaat is de som van zijn transacties', (_, make: () => Profile) => {
    const p = make()
    setOrganisations(p.settings.organisations ?? [])
    checkReports(p.input.trips, p.input.transactions, 'profiel')
    checkTripResults(p.input.trips, p.input.transactions, 'profiel')
  })

  it('500 willekeurige logboeken (alle soorten geld, verwijderde tochten, seizoenen, geld zonder tocht): dezelfde sommen', () => {
    setOrganisations(ORGS.map((id) => ({ id, name: `Nep ${id}` })))
    for (let seed = 1; seed <= 500; seed++) {
      const { trips, transactions } = randomData(seed)
      checkReports(trips, transactions, `seed ${seed}`)
      checkTripResults(trips, transactions, `seed ${seed}`)
    }
  })
})

describe('soort van een trip bij een eigen organisatie (bevinding W-3 in docs/review.md)', () => {
  const base: Trip = { id: 'k1', name: 'Week 7', startDate: '2026-05-01', endDate: '2026-05-07', updatedAt: T, deletedAt: null }

  it('een trip van Sailing Virgins of Yacht Week zonder type is zeker werk', () => {
    expect(tripKind({ ...base, organisation: 'yacht-week' }, []).sure).toBe(true)
    expect(tripKind({ ...base, organisation: 'sailing-virgins' }, []).sure).toBe(true)
  })

  // FIXME (review W-3): dezelfde trip bij een eigen organisatie is "niet zeker" en komt in Nakijken terecht, terwijl
  // een organisatie uit Instellingen → Organisaties voor een nieuwe gebruiker precies hetzelfde betekent als Sailing
  // Virgins voor Olivier. src/model/trip-kind.ts:45 kent alleen de twee vaste id's.
  it.skip('een trip van een eigen organisatie zonder type is net zo zeker werk', () => {
    setOrganisations([{ id: 'org:nep', name: 'Nepzeil', short: 'NZ' }])
    expect(tripKind({ ...base, organisation: 'org:nep' }, []).sure).toBe(true)
  })
})
