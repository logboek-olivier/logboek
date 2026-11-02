import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { geldToevoegen } from '../src/domain/geld'
import { booked, salariesOf, salaryOf, salaryStatus, sumPerCurrency } from '../src/domain/geldmodel'
import { geldOmzetten, needsMoneyConversion, planMoneyConversion } from '../src/domain/geld-omzetten'
import { tripResult } from '../src/domain/geldrapport'
import { violations } from '../src/domain/invariants'
import { terugzetten } from '../src/domain/prullenbak'
import { active } from '../src/model/derive'
import { totals } from '../src/model/money'
import { positionAt } from '../src/model/position'
import { setRates } from '../src/model/rates'
import { taxYear } from '../src/model/tax-year'
import { SCHEMA_VERSION } from '../src/model/schema'
import { trashItems } from '../src/model/trash'
import { decodeRecords, encodeRecords } from '../src/storage/sync'
import type { Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { RATES, TODAY, oldTransactions, oldTrips } from './helpers/geld-dataset'
import { putMany } from './helpers/schrijf'

// Eén waarheid voor geld (src/domain/geldmodel.ts) met de gouden dataset (tests/helpers/geld-dataset.ts, verzonnen):
// "Geld omzetten" en de rapporten daarna. Elke verwachte uitkomst is hieronder met de hand uitgerekend (1 EUR = 1,25 USD).

const TOKEN = 'github_pat_GELDGOUD_0123456789abcdefghijklmnopqrstuvwx'
let counter = 0

beforeAll(() => setRates(RATES))
afterAll(() => setRates(null))

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const s = await Store.open(await openLogboekDb(`logboek-geld-gouden-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
  await putMany(s, 'trips.json.enc', oldTrips())
  await putMany(s, 'transactions.json.enc', oldTransactions())
  return s
}

const tripById = (s: Store, id: string) => s.list('trips.json.enc').find((x) => x.id === id)!
const result = (s: Store, id: string) => tripResult(tripById(s, id), s.list('transactions.json.enc')).result

/** Alles zonder wijzigingstijden en met gesorteerde velden, om te vergelijken. */
function snapshot(s: Store): string {
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v)
  const strip = <T extends { updatedAt: string }>(r: T) => sorted({ ...r, updatedAt: '' }) as T
  const trips = active(s.get('trips.json.enc')).map(strip).sort((a, b) => a.id.localeCompare(b.id))
  const money = active(s.get('transactions.json.enc')).map(strip).sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify([trips, money])
}

describe('Geld omzetten met de gouden dataset', () => {
  it('toont vooraf alleen aantallen, en verandert niets zonder tik', async () => {
    const s = await store()
    expect(needsMoneyConversion(s)).toBe(true)
    // Samengevoegd: yw25-1, yw25-2, yw26-1 (salaris op de tocht plus één loon). Nieuw: yw26-2, yw26-3, sv26-a, sv26-c.
    // Contant of gestort: vier fooien. Ontvangen zonder bedrag: yw26-2. Meer dan één salaris: sv26-b.
    expect(planMoneyConversion(s, TODAY).counts).toEqual({ merged: 3, created: 4, cashMarks: 4, missing: 1, multiple: 1 })
    expect(s.list('trips.json.enc').filter((x) => 'salary' in x)).toHaveLength(8)
  })

  it('na één tik: het salaris alleen als transactie, contant en gestort weg, en elke fooi op haar eigen datum', async () => {
    const s = await store()
    const { result: counts } = await geldOmzetten(s)
    expect(counts).toEqual({ merged: 3, created: 4, cashMarks: 4, missing: 1, multiple: 1 })
    expect(needsMoneyConversion(s)).toBe(false)
    expect(s.get('trips.json.enc').filter((x) => 'salary' in x)).toEqual([])
    expect(s.get('transactions.json.enc').filter((x) => 'tipVia' in x || 'depositedAt' in x)).toEqual([])
    const all = s.list('transactions.json.enc')
    // De transactie houdt het bedrag; de status komt van de tocht.
    expect(salaryOf('yw25-1', all)).toMatchObject({ id: 'salaris:yw25-1', amount: 900, status: 'ontvangen' })
    // Alleen een status op de tocht: een loon-transactie met die status, op de einddatum van de tocht.
    expect(salaryOf('yw26-2', all)).toMatchObject({ amount: 0, status: 'ontvangen', date: '2026-07-17' })
    expect(salaryOf('yw26-3', all)).toMatchObject({ amount: 1000, currency: 'EUR', status: 'ontvangen' })
    expect(salaryOf('sv26-a', all)).toMatchObject({ id: 'salaris:sv26-a', amount: 1500, currency: 'USD', status: 'verwacht', date: '2026-10-09' })
    expect(salaryOf('sv26-c', all)).toMatchObject({ amount: 0, status: 'geen' })
    // Een los ingevoerd loon zonder salaris op de tocht is ontvangen (dat was het al).
    expect(salaryStatus(salaryOf('yw25-3', all)!)).toBe('ontvangen')
    // Twee salarissen bij één tocht: niet samengevoegd, beide blijven staan.
    expect(salariesOf('sv26-b', all).map((x) => x.amount)).toEqual([1500, 200])
    // De fooien blijven op hun eigen datum.
    expect(all.find((x) => x.id === 'fooi-yw25-2')).toMatchObject({ date: '2025-07-18', amount: 250 })
    // Te controleren: ontvangen zonder bedrag en de tocht met twee salarissen (signaleren, niet aanpassen).
    const rules = violations(s).map((v) => `${v.rule}:${v.id}`)
    expect(rules).toEqual(expect.arrayContaining(['salaris-zonder-bedrag:salaris:yw26-2', 'meerdere-salarissen:sv26-b']))
  })

  it('verliest geen bedrag: de som per valuta blijft, plus wat alleen op de tocht stond', async () => {
    const s = await store()
    const before = sumPerCurrency(active(s.list('transactions.json.enc')))
    // Met de hand: EUR 900+300+50 + 900+250 + 950+200 + 1000+400 + 350 + 80 = 5380; USD 500 + 1500+200+600+100 = 2900.
    expect(before).toEqual({ EUR: 5380, USD: 2900 })
    await geldOmzetten(s)
    // Erbij: yw26-3 ontvangen 1000 EUR en sv26-a verwacht 1500 USD (yw26-2 en sv26-c zijn 0).
    expect(sumPerCurrency(active(s.list('transactions.json.enc')))).toEqual({ EUR: 6380, USD: 4400 })
  })

  it('rekent elk rapport uit dezelfde transacties (met de hand uitgerekend)', async () => {
    const s = await store()
    await geldOmzetten(s)
    // Een fooi van een eerder seizoen (Yacht Week 2025), zonder tocht.
    await geldToevoegen(s, { date: '2025-12-31', kind: 'fooi', amount: 120, currency: 'EUR', source: 'yacht-week', season: { org: 'yacht-week', year: 2025 } }, null)
    const all = s.list('transactions.json.enc')
    const trips = s.list('trips.json.enc')
    // Jaaroverzicht 2025: loon 900+900+950 + fooi 300+250+200 + seizoensfooi 120 = 3620, alles Yacht Week.
    const y2025 = taxYear(all, trips, 2025, RATES)
    expect(y2025.totalEur).toBe(3620)
    expect(y2025.groups.map((g) => [g.group, g.eur])).toEqual([['yacht-week', 3620]])
    // 2026: Yacht Week loon 1000+0+1000 + fooi 400+350 = 2750; Sailing Virgins (USD / 1,25): fooi 400, loon 1200+160,
    // fooi 480 = 2240. Het verwachte salaris van sv26-a en "geen salaris" van sv26-c tellen niet.
    const y2026 = taxYear(all, trips, 2026, RATES)
    expect(Object.fromEntries(y2026.groups.map((g) => [g.group, g.eur]))).toEqual({ 'yacht-week': 2750, 'sailing-virgins': 2240 })
    expect(y2026.totalEur).toBe(4990)
    // De transactielijst (alleen echt geld): verdiend 3620 + 4990 = 8610, kosten 50 + 80 + 80 (100 USD) = 210.
    const list = totals(booked(all))
    expect(list.incomeEur).toBe(8610)
    expect(list.costsEur).toBe(210)
    expect(list.incomeEur).toBe(y2025.totalEur + y2026.totalEur)
    // Resultaat per tocht = de som van zijn transacties.
    expect(result(s, 'yw25-1').eur).toBe(1150)
    expect(result(s, 'yw25-3').eur).toBe(1150)
    expect(result(s, 'yw26-2').eur).toBe(350)
    expect(result(s, 'yw26-3').eur).toBe(920)
    expect(result(s, 'sv26-a').eur).toBe(1600)
    expect(tripResult(tripById(s, 'sv26-a'), all).salaryExpected).toBe(true)
    expect(result(s, 'sv26-b').eur).toBe(1760)
    expect(result(s, 'sv26-c').eur).toBe(0)
    // Alle tochten samen: verdiend bij tochten 8490 + verwacht 1200 − kosten 210 = 9480.
    expect(trips.reduce((n, x) => n + result(s, x.id).eur, 0)).toBe(9480)
    // Mijn positie: te ontvangen is alleen het verwachte salaris van sv26-a (voorbij): 1500 USD = 1200 EUR. Geen contant.
    const position = positionAt({ accounts: [], balances: [], trips, legs: [], transactions: all, rates: RATES }, TODAY)
    expect(position.totals.receivable.eur).toBe(1200)
    expect(position.totals.cash.eur).toBe(0)
    expect(position.totals.net.eur).toBe(1200)
  })

  it('twee keer omzetten is één keer', async () => {
    const s = await store()
    await geldOmzetten(s)
    const once = snapshot(s)
    const { result: again } = await geldOmzetten(s)
    expect(again).toEqual({ merged: 0, created: 0, cashMarks: 0, missing: 0, multiple: 0 })
    expect(snapshot(s)).toBe(once)
  })

  it('het herstelpunt in de prullenbak zet alles terug zoals het was', async () => {
    const s = await store()
    const before = snapshot(s)
    await geldOmzetten(s)
    const item = trashItems(s).find((i) => i.kind === 'omzetten')
    expect(item).toBeDefined()
    await terugzetten(s, item!.key)
    expect(snapshot(s)).toBe(before)
    expect(needsMoneyConversion(s)).toBe(true)
    // Daarna kan het opnieuw, met dezelfde aantallen.
    expect(planMoneyConversion(s, TODAY).counts).toEqual({ merged: 3, created: 4, cashMarks: 4, missing: 1, multiple: 1 })
  })
})

describe('schemaversie 2', () => {
  it('leest een bestand van versie 1 (het oude geldmodel) gewoon in en schrijft de huidige versie', () => {
    const v1 = new TextEncoder().encode(JSON.stringify({ format: 'logboek-collection', schemaVersion: 1, records: oldTrips() }))
    const trips = decodeRecords<Trip>('trips.json.enc', v1)
    expect(trips).toHaveLength(9)
    expect(trips.filter((x) => 'salary' in x)).toHaveLength(8)
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2)
    expect((JSON.parse(new TextDecoder().decode(encodeRecords(trips))) as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('omzetten verliest nooit een bedrag (eigenschap)', () => {
  // Kleine, vaste pseudo-willekeur (reproduceerbaar).
  function rng(seed: number) {
    let x = seed
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x / 2147483648
    }
  }
  const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!

  it('voor 200 willekeurige logboeken: som per valuta na = vóór + salarissen die alleen op de tocht stonden', async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed)
      const trips: Trip[] = []
      const money: Transaction[] = []
      const onlyOnTrip: Record<string, number> = {}
      const n = 1 + Math.floor(r() * 5)
      for (let i = 0; i < n; i++) {
        const id = `t${seed}-${i}`
        const currency = pick(r, ['EUR', 'USD'] as const)
        const status = pick(r, ['verwacht', 'ontvangen', 'geen', undefined] as const)
        const amount = pick(r, [0, 750, 1000.5])
        const loons = Math.floor(r() * 3)
        const trip = { id, name: `Nep ${i}`, organisation: pick(r, ['yacht-week', 'sailing-virgins']), startDate: '2026-06-01', endDate: '2026-06-07', updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null } as Trip
        if (status) Object.assign(trip, { salary: { amount, currency, status, source: 'eigen' } })
        trips.push(trip)
        for (let j = 0; j < loons; j++) money.push({ id: j === 0 && r() < 0.5 ? `salaris:${id}` : `loon-${id}-${j}`, date: '2026-06-10', kind: 'loon', amount: pick(r, [500, 800.25]), currency, source: 'overig', tripId: id, updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null })
        if (r() < 0.7) money.push({ id: `fooi-${id}`, date: '2026-06-07', kind: 'fooi', amount: 99.99, currency, source: 'overig', tripId: id, ...(r() < 0.6 ? { tipVia: pick(r, ['contant', 'bank']) } : {}), ...(r() < 0.3 ? { depositedAt: '2026-06-20' } : {}), updatedAt: '2026-06-01T00:00:00.000Z', deletedAt: null } as Transaction)
        if (status && loons === 0 && status !== 'geen') onlyOnTrip[currency] = (onlyOnTrip[currency] ?? 0) + amount
      }
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      const s = await Store.open(await openLogboekDb(`logboek-geld-eigenschap-${seed}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
      await putMany(s, 'trips.json.enc', trips)
      if (money.length > 0) await putMany(s, 'transactions.json.enc', money)
      const before = sumPerCurrency(active(s.list('transactions.json.enc')))
      const ids = new Set(s.list('transactions.json.enc').map((x) => x.id))
      await geldOmzetten(s)
      const after = sumPerCurrency(active(s.list('transactions.json.enc')))
      for (const c of new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(onlyOnTrip)])) {
        expect(after[c] ?? 0, `seed ${seed} ${c}`).toBeCloseTo((before[c] ?? 0) + (onlyOnTrip[c] ?? 0), 2)
      }
      // Geen transactie verdwenen, geen tocht met een salaris-veld, en geen contant of gestort meer.
      for (const id of ids) expect(s.list('transactions.json.enc').some((x) => x.id === id), `seed ${seed} ${id}`).toBe(true)
      expect(needsMoneyConversion(s)).toBe(false)
    }
  }, 120_000)
})

describe('randgevallen van de omzetting (onafhankelijke review)', () => {
  const T0 = '2026-10-01T00:00:00.000Z'
  const trip = (id: string, salary?: Record<string, unknown>, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, organisation: 'yacht-week', startDate: '2026-07-01', endDate: '2026-07-07', ...(salary ? { salary } : {}), ...extra, updatedAt: T0, deletedAt: null }) as Trip
  const money = (id: string, extra: Partial<Transaction>): Transaction => ({ id, date: '2026-07-10', kind: 'loon', amount: 900, currency: 'EUR', source: 'yacht-week', updatedAt: T0, deletedAt: null, ...extra }) as Transaction
  async function fresh(trips: Trip[], txs: Transaction[]): Promise<Store> {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const s = await Store.open(await openLogboekDb(`logboek-geld-rand-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
    await putMany(s, 'trips.json.enc', trips)
    if (txs.length > 0) await putMany(s, 'transactions.json.enc', txs)
    return s
  }

  it('een salaris dat al een status heeft (nieuw model) houdt die: een verwacht salaris wordt nooit ontvangen', async () => {
    const s = await fresh([trip('a', { amount: 900, currency: 'EUR', status: 'ontvangen', source: 'eigen' })], [money('salaris:a', { tripId: 'a', status: 'verwacht', amount: 2000 })])
    await geldOmzetten(s)
    expect(salaryOf('a', s.list('transactions.json.enc'))).toMatchObject({ amount: 2000, status: 'verwacht' })
  })

  it('het vaste id dat intussen een ander soort inkomen is, wordt nooit overschreven', async () => {
    const s = await fresh([trip('a', { amount: 900, currency: 'EUR', status: 'verwacht', source: 'eigen' })], [money('salaris:a', { tripId: 'a', kind: 'bonus', amount: 300 })])
    await geldOmzetten(s)
    const all = s.list('transactions.json.enc')
    expect(all.find((x) => x.id === 'salaris:a')).toMatchObject({ kind: 'bonus', amount: 300 })
    expect(salaryOf('a', all)).toMatchObject({ amount: 900, status: 'verwacht' })
    expect(salaryOf('a', all)!.id).not.toBe('salaris:a')
  })

  it('een salaris waarvan het inkomen naar een andere tocht verhuisde, krijgt geen tweede inkomen', async () => {
    const s = await fresh([trip('a', { amount: 900, currency: 'EUR', status: 'ontvangen', source: 'eigen', transactionId: 'salaris:a' }), trip('b')], [money('salaris:a', { tripId: 'b' })])
    const before = sumPerCurrency(booked(s.list('transactions.json.enc')))
    await geldOmzetten(s)
    expect(sumPerCurrency(booked(s.list('transactions.json.enc')))).toEqual(before)
    expect(salaryOf('a', s.list('transactions.json.enc'))).toBeUndefined()
  })

  it('een verwijderde contante fooi blijft zoals hij was (de prullenbak van vóór de geschiedenis)', async () => {
    const s = await fresh([trip('a')], [{ ...money('fooi-weg', { tripId: 'a', kind: 'fooi', amount: 400 }), tipVia: 'contant', deletedAt: '2026-09-28T10:00:00.000Z' } as Transaction])
    expect(needsMoneyConversion(s)).toBe(false)
    const { result } = await geldOmzetten(s)
    expect(result.cashMarks).toBe(0)
    expect(s.get('transactions.json.enc').find((x) => x.id === 'fooi-weg')).toMatchObject({ tipVia: 'contant', deletedAt: '2026-09-28T10:00:00.000Z' })
  })

  it('een kapotte tripdatum houdt de omzetting niet tegen: dan de datum van vandaag', async () => {
    const s = await fresh([trip('a', { amount: 700, currency: 'EUR', status: 'verwacht', source: 'eigen' }, { startDate: '1-7-2026', endDate: '7-7-2026' })], [])
    await geldOmzetten(s)
    expect(salaryOf('a', s.list('transactions.json.enc'))?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
