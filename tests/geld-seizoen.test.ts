import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eerderSeizoenInvoeren, geldToevoegen, seasonDate, uitbetalingInvoeren } from '../src/domain/geld'
import { booked, linkOf } from '../src/domain/geldmodel'
import { tripResult } from '../src/domain/geldrapport'
import { violations } from '../src/domain/invariants'
import { tipsPerTrip } from '../src/model/guests'
import { totals } from '../src/model/money'
import { setRates } from '../src/model/rates'
import { taxYear } from '../src/model/tax-year'
import type { Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { RATES } from './helpers/geld-dataset'
import { putMany } from './helpers/schrijf'

// Geld van een eerder seizoen (Geld → Eerder seizoen, src/domain/geld.ts) en geld per tocht (het geldblok in Trip
// bewerken). Verzonnen data; 1 EUR = 1,25 USD.

const TOKEN = 'github_pat_SEIZOEN_0123456789abcdefghijklmnopqrstuvwxyz'
const T = '2026-10-31T12:00:00.000Z'
let counter = 0

beforeAll(() => setRates(RATES))
afterAll(() => setRates(null))

const trip = (id: string, organisation: string, startDate: string, endDate: string): Trip => ({ id, name: `Nep ${id}`, kind: 'werk', type: 'skipper-charter', organisation, startDate, endDate, updatedAt: T, deletedAt: null })

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const s = await Store.open(await openLogboekDb(`logboek-geld-seizoen-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
  await putMany(s, 'trips.json.enc', [trip('yw-1', 'yacht-week', '2025-06-01', '2025-06-07'), trip('yw-2', 'yacht-week', '2025-08-10', '2025-08-16'), trip('sv-1', 'sailing-virgins', '2025-11-01', '2025-11-07')])
  return s
}

describe('eerder seizoen', () => {
  it('datum: de laatste dag van de laatste tocht van die organisatie in dat jaar, anders 31 december', async () => {
    const s = await store()
    expect(seasonDate(s.list('trips.json.enc'), [], 'yacht-week', 2025)).toBe('2025-08-16')
    expect(seasonDate(s.list('trips.json.enc'), [], 'yacht-week', 2024)).toBe('2024-12-31')
  })

  it('elk ingevuld bedrag wordt één transactie bij het seizoen; telt in de totalen, per organisatie en het jaaroverzicht', async () => {
    const s = await store()
    const { result, undo } = await eerderSeizoenInvoeren(s, { org: 'yacht-week', year: 2025, salary: { amount: 2000, currency: 'EUR' }, tips: { amount: 500, currency: 'USD' }, costs: undefined })
    expect(result).toHaveLength(2)
    const all = s.list('transactions.json.enc')
    for (const tx of all) {
      expect(linkOf(tx)).toEqual({ kind: 'seizoen', season: { org: 'yacht-week', year: 2025 } })
      expect(tx.date).toBe('2025-08-16')
      expect(tx.tripId).toBeUndefined()
    }
    expect(all.find((x) => x.kind === 'loon')).toMatchObject({ amount: 2000, status: 'ontvangen', source: 'yacht-week' })
    // Met de hand: 2000 + 500 USD / 1,25 = 2400.
    expect(totals(booked(all)).incomeEur).toBe(2400)
    const year = taxYear(all, s.list('trips.json.enc'), 2025, RATES)
    expect(year.groups.map((g) => [g.group, g.eur])).toEqual([['yacht-week', 2400]])
    // Niet in de fooi per tocht (er is geen tocht), en geen "geld zonder periode".
    expect(tipsPerTrip(s.list('trips.json.enc'), all, [])).toEqual([])
    expect(violations(s).filter((v) => v.rule === 'geld-zonder-periode')).toEqual([])
    await undo()
    expect(s.list('transactions.json.enc')).toEqual([])
  })

  it('zonder bedrag geen transactie', async () => {
    const s = await store()
    const { result } = await eerderSeizoenInvoeren(s, { org: 'sailing-virgins', year: 2025 })
    expect(result).toEqual([])
    expect(s.list('transactions.json.enc')).toEqual([])
  })
})

describe('geld per tocht', () => {
  it('kosten en fooien bij een tocht: het resultaat is de som van de transacties, ook na bewerken en verwijderen', async () => {
    const s = await store()
    const t = s.list('trips.json.enc').find((x) => x.id === 'sv-1')!
    await geldToevoegen(s, { date: '2025-11-07', kind: 'fooi', amount: 250, currency: 'USD', source: 'sailing-virgins' }, 'sv-1')
    const { result: cost, undo } = await geldToevoegen(s, { date: '2025-11-02', kind: 'kosten', category: 'eten', amount: 40, currency: 'EUR', source: 'sailing-virgins' }, 'sv-1')
    // 250 USD = 200 EUR, min 40 = 160.
    expect(tripResult(t, s.list('transactions.json.enc')).result.eur).toBe(160)
    expect(cost.tripId).toBe('sv-1')
    await undo()
    expect(tripResult(t, s.list('transactions.json.enc')).result.eur).toBe(200)
  })
})

describe('uitbetaling zonder tochten', () => {
  it('hoort bij het seizoen van de organisatie (per organisatie en jaaroverzicht), niet bij Overig', async () => {
    const s = await store()
    await uitbetalingInvoeren(s, { org: 'org:nep', amount: 500, currency: 'EUR', date: '2025-09-30' }, [], RATES)
    const [tx] = s.list('transactions.json.enc')
    expect(tx).toMatchObject({ kind: 'loon', status: 'ontvangen', season: { org: 'org:nep', year: 2025 } })
    expect(taxYear(s.list('transactions.json.enc'), s.list('trips.json.enc'), 2025, RATES).groups.map((g) => g.group)).toEqual(['org:nep'])
    expect(violations(s).filter((v) => v.rule === 'geld-zonder-periode')).toEqual([])
  })
})
