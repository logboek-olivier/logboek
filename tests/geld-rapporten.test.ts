import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { geldToevoegen } from '../src/domain/geld'
import { booked } from '../src/domain/geldmodel'
import { geldOmzetten } from '../src/domain/geld-omzetten'
import { perOrganisation, tipReports, toCheck, transactionList, tripResult, yearOverview, type ReportPeriod } from '../src/domain/geldrapport'
import { aantalGastenZetten } from '../src/domain/trips'
import { active } from '../src/model/derive'
import { eurOf, isEarned, totals } from '../src/model/money'
import { setRates } from '../src/model/rates'
import { formatMoney, formatMoneyShort } from '../src/format'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { RATES, oldTransactions, oldTrips } from './helpers/geld-dataset'
import { putMany } from './helpers/schrijf'

// Alle geldrapporten rekenen uit dezelfde transacties (src/domain/geldrapport.ts). Met de gouden dataset (verzonnen, na
// "Geld omzetten"): voor dezelfde periode is per organisatie = het jaaroverzicht = de transactielijst, en het resultaat
// van een tocht is de som van zijn transacties. Verwachte bedragen met de hand uitgerekend (1 EUR = 1,25 USD).

const TOKEN = 'github_pat_RAPPORT_0123456789abcdefghijklmnopqrstuvwxyz'
let counter = 0

beforeAll(() => setRates(RATES))
afterAll(() => setRates(null))

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const s = await Store.open(await openLogboekDb(`logboek-geld-rapporten-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
  await putMany(s, 'trips.json.enc', oldTrips())
  await putMany(s, 'transactions.json.enc', oldTransactions())
  await geldOmzetten(s)
  await geldToevoegen(s, { date: '2025-12-31', kind: 'fooi', amount: 120, currency: 'EUR', source: 'yacht-week', season: { org: 'yacht-week', year: 2025 } }, null)
  return s
}

const year = (y: number): ReportPeriod => ({ from: `${y}-01-01`, to: `${y}-12-31` })
const earnedOf = (list: ReturnType<typeof transactionList>) => Math.round(list.filter((tx) => isEarned(tx.kind)).reduce((n, tx) => n + (eurOf(tx) ?? 0), 0) * 100) / 100

describe('geldrapporten uit dezelfde transacties', () => {
  it('per organisatie = jaaroverzicht = transactielijst, per jaar en samen', async () => {
    const s = await store()
    const all = s.list('transactions.json.enc')
    const trips = s.list('trips.json.enc')
    let total = 0
    for (const [y, expected] of [
      [2025, 3620],
      [2026, 4990],
    ] as const) {
      const list = transactionList(all, year(y))
      const orgs = perOrganisation(all, trips, year(y))
      const overview = yearOverview(all, trips, y, RATES)
      const orgSum = Math.round(orgs.reduce((n, g) => n + g.incomeEur, 0) * 100) / 100
      expect(orgSum, `per organisatie ${y}`).toBe(expected)
      expect(overview.totalEur, `jaaroverzicht ${y}`).toBe(expected)
      expect(earnedOf(list), `transactielijst ${y}`).toBe(expected)
      // Per organisatie per groep gelijk aan het jaaroverzicht.
      expect(Object.fromEntries(orgs.map((g) => [g.group, g.incomeEur]))).toEqual(Object.fromEntries(overview.groups.map((g) => [g.group, g.eur])))
      total += expected
    }
    // Zonder periode: alles samen, en de transactielijst heeft geen verwacht salaris of "geen salaris".
    expect(earnedOf(transactionList(all))).toBe(total)
    expect(transactionList(all).some((tx) => tx.kind === 'loon' && (tx.status === 'verwacht' || tx.status === 'geen'))).toBe(false)
    expect(totals(booked(all)).incomeEur).toBe(total)
  })

  it('het resultaat van een tocht is de som van zijn transacties', async () => {
    const s = await store()
    const all = active(s.list('transactions.json.enc'))
    for (const trip of s.list('trips.json.enc')) {
      const sum = Math.round(
        all
          .filter((tx) => tx.tripId === trip.id && !(tx.kind === 'loon' && tx.status === 'geen'))
          .reduce((n, tx) => n + (tx.kind === 'kosten' || tx.kind === 'investering' ? -1 : 1) * (eurOf(tx) ?? 0), 0) * 100,
      ) / 100
      expect(tripResult(trip, all).result.eur, trip.id).toBe(sum)
    }
  })

  it('Te controleren: ontvangen zonder bedrag en een tocht met meer dan één salaris (alleen signaleren)', async () => {
    const s = await store()
    const items = toCheck(s.list('transactions.json.enc'), s.list('trips.json.enc'))
    expect(items.map((i) => `${i.kind}:${i.trip.id}`).sort()).toEqual(['meerdere:sv26-b', 'zonder-bedrag:yw26-2'])
  })

  it('fooi per gast: elke tocht met fooien, Yacht Week met een aantal gasten, en Yacht Week en Sailing Virgins naast elkaar', async () => {
    const s = await store()
    // Yacht Week heeft geen namen: alleen een aantal gasten (bij één week).
    await aantalGastenZetten(s, 'yw26-1', 8)
    const r = tipReports(s.list('trips.json.enc'), s.list('transactions.json.enc'), [])
    // Elke tocht met fooien staat erin (zeven tochten; de seizoensfooi hoort bij geen tocht).
    expect(r.perTrip.map((x) => x.trip.id).sort()).toEqual(['sv26-a', 'sv26-b', 'yw25-1', 'yw25-2', 'yw25-3', 'yw26-1', 'yw26-2'].sort())
    // yw26-1: 400 / 8 = 50 per gast; sv26-a: 500 USD = 400 EUR over vier gasten = 100; zonder aantal: onbekend.
    expect(r.perTrip.find((x) => x.trip.id === 'yw26-1')).toMatchObject({ guests: 8, perGuest: 50 })
    expect(r.perTrip.find((x) => x.trip.id === 'sv26-a')).toMatchObject({ guests: 4, perGuest: 100 })
    expect(r.perTrip.find((x) => x.trip.id === 'yw25-1')).toMatchObject({ guests: 0, perGuest: null })
    // Per soort: Yacht Week en Sailing Virgins naast elkaar. Yacht Week: 1500 fooi in 5 tochten (300+250+200+400+350),
    // gemiddelde alleen over de tocht met een aantal gasten (50); Sailing Virgins: 880 over 2 tochten, 400 / 4 = 100.
    const byOrg = Object.fromEntries(r.perType.map((g) => [g.org, g]))
    expect(byOrg['yacht-week']).toMatchObject({ trips: 5, eur: 1500, guests: 8, perGuest: 50 })
    expect(byOrg['sailing-virgins']).toMatchObject({ trips: 2, eur: 880, guests: 4, perGuest: 100 })
  })
})

describe('bedragen', () => {
  it('negatief altijd met een minteken vooraan, zoals de rest van de app', () => {
    expect(formatMoney(-1830.52, 'EUR', 'nl')).toBe('−€ 1.830,52')
    expect(formatMoney(-1830.52, 'EUR', 'en')).toBe('−€1,830.52')
    expect(formatMoney(-20, 'USD', 'nl')).toBe('−$ 20,00')
    expect(formatMoney(1830.52, 'EUR', 'nl')).toBe('€ 1.830,52')
    // Afgerond op centen is −0,004 gewoon nul.
    expect(formatMoney(-0.004, 'EUR', 'nl')).toBe('€ 0,00')
    expect(formatMoneyShort(-1830, 'EUR', 'nl')).toBe('−€ 1.830')
  })
})
