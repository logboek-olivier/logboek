import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { fixedAmount, fixedDueMonth, fixedMonthlyEquivalent, fixedRate } from '../src/model/costs'
import { missingBookings } from '../src/model/fixed-bookings'
import { reviewInput, reviewItems } from '../src/model/review'
import type { FixedCost, StayPeriod } from '../src/model/types'
import { violations } from '../src/domain/invariants'
import { uitgaveBewerken, uitgaveToevoegen, vasteLastToevoegen } from '../src/domain/geld'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'

// Kosten om te leven: een jaarlijks abonnement als vaste last, en een privé-uitgave die bewust bij geen periode hoort.
// Alle namen en bedragen zijn verzonnen.

const NOW = '2026-11-24T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
async function device() {
  return Store.open(await openLogboekDb(`logboek-prive-${++counter}`), masterKey, new GithubClient('github_pat_PRIVE_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
}

describe('jaarlijkse vaste last', () => {
  const yearly: FixedCost = { id: 'f1', name: 'Nepabonnement', currency: 'EUR', every: 'jaar', amounts: [{ from: '2026-03', amount: 120 }], updatedAt: NOW, deletedAt: null }

  it('kost alleen iets in de betaalmaand, elk jaar opnieuw', () => {
    expect(fixedAmount(yearly, '2026-02')).toBe(0)
    expect(fixedAmount(yearly, '2026-03')).toBe(120)
    expect(fixedAmount(yearly, '2026-04')).toBe(0)
    expect(fixedAmount(yearly, '2027-03')).toBe(120)
    expect(fixedRate(yearly, '2026-11')).toBe(120)
    expect(fixedDueMonth(yearly, '2026-11')).toBe(3)
    // Een nieuw bedrag vanaf maart 2027 (de volgende betaling).
    const changed = { ...yearly, amounts: [...yearly.amounts, { from: '2027-03', amount: 150 }] }
    expect(fixedAmount(changed, '2026-03')).toBe(120)
    expect(fixedAmount(changed, '2027-03')).toBe(150)
  })

  it('samen per maand: een twaalfde; boeken: alleen de betaalmaand', () => {
    const monthly: FixedCost = { id: 'f2', name: 'Nephuur', currency: 'EUR', amounts: [{ from: '2026-01', amount: 500 }], updatedAt: NOW, deletedAt: null }
    expect(fixedMonthlyEquivalent([yearly, monthly], '2026-11', null)).toEqual({ eur: 510, other: {} })
    const booked = missingBookings([yearly], [], '2026-11-24', NOW)
    expect(booked.map((tx) => [tx.date, tx.amount])).toEqual([['2026-03-31', 120]])
  })

  it('toevoegen per jaar', async () => {
    const store = await device()
    const { result } = await vasteLastToevoegen(store, { name: 'Nepstreaming', amount: 99, currency: 'EUR', from: '2026-05', every: 'jaar' })
    expect(result).toMatchObject({ every: 'jaar', amounts: [{ from: '2026-05', amount: 99 }] })
  })
})

describe('privé-uitgave', () => {
  it('hoort bij geen periode, staat niet in Nakijken of Gezondheid; naar een periode haalt privé weg', async () => {
    const store = await device()
    const home: StayPeriod = { id: 'thuis1', kind: 'thuis', startDate: '2026-11-01', endDate: '2026-11-30', updatedAt: NOW, deletedAt: null }
    await put(store, 'periods.json.enc', home)
    const { result } = await uitgaveToevoegen(store, { kind: 'prive' }, { date: '2026-11-24', kind: 'kosten', amount: 25, currency: 'EUR', category: 'overig', note: 'Nepcadeau' }, {})
    expect(result.tripId).toBeUndefined()
    expect(result.personal).toBe(true)
    expect(reviewItems(reviewInput(store)).filter((i) => i.kind === 'geld-zonder-periode')).toEqual([])
    expect(violations(store).filter((v) => v.rule === 'geld-zonder-periode')).toEqual([])

    const saved = store.get('transactions.json.enc').find((x) => x.id === result.id)!
    const period = { id: 'thuis1', kind: 'thuis', name: 'Thuis', start: home.startDate, end: home.endDate, stay: home } as never
    await uitgaveBewerken(store, saved, { kind: 'periode', period }, { date: saved.date, kind: 'kosten', amount: 25, currency: 'EUR', category: 'overig', note: 'Nepcadeau' })
    const moved = store.get('transactions.json.enc').find((x) => x.id === result.id)!
    expect(moved.tripId).toBe('thuis1')
    expect(moved).not.toHaveProperty('personal')
  })
})
