import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { actualCosts } from '../src/model/actual-costs'
import { buildIndex } from '../src/model/calendar'
import { dayAverages } from '../src/model/costs'
import { bookFixedCosts, bookingId, missingBookings } from '../src/model/fixed-bookings'
import { reviewInput, reviewItems } from '../src/model/review'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { FixedCost, Transaction, WeekClosing } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, remove } from './helpers/schrijf'

// PR 3 van het periodemodel: Geld met Werkelijk en Verwacht. Vaste lasten worden per voorbije maand als echte uitgave
// geboekt (aan te passen of te verwijderen per maand); losse kosten werkelijk = ingevoerd plus de weekschatting.
// Alle gegevens verzonnen.

const T = '2026-10-01T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store() {
  const db = await openLogboekDb(`logboek-werkelijk-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_WERKELIJK_0123456789abcdefghijklmno', new FakeGithub().fetch))
}

const rent: FixedCost = { id: 'huur', name: 'Nephuur', currency: 'EUR', amounts: [{ from: '2026-08', amount: 500 }, { from: '2026-10', amount: 550 }], updatedAt: T, deletedAt: null }
const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date: '2026-10-05', kind: 'kosten', amount: 10, currency: 'EUR', source: 'overig', updatedAt: T, deletedAt: null, ...extra })

describe('vaste lasten per voorbije maand geboekt', () => {
  it('elke voorbije maand één uitgave met het bedrag van die maand; de lopende maand niet (eerst rood: niets geboekt)', () => {
    const list = missingBookings([rent], [], '2026-11-12', T)
    expect(list.map((x) => [x.id, x.date, x.amount])).toEqual([
      [bookingId('huur', '2026-08'), '2026-08-31', 500],
      [bookingId('huur', '2026-09'), '2026-09-30', 500],
      [bookingId('huur', '2026-10'), '2026-10-31', 550],
    ])
    expect(list[0]).toMatchObject({ kind: 'kosten', fixedCostId: 'huur', note: 'Nephuur', amountEur: 500 })
  })

  it('een aangepaste of verwijderde maand boekt de app nooit opnieuw; twee apparaten boeken hetzelfde', async () => {
    const s = await store()
    await put(s, 'fixedcosts.json.enc', rent)
    await s.sync()
    expect(await inTx(s, bookFixedCosts, '2026-11-12')).toBe(3)
    const sept = s.list('transactions.json.enc').find((x) => x.id === bookingId('huur', '2026-09'))!
    await put(s, 'transactions.json.enc', { ...sept, amount: 480, updatedAt: new Date().toISOString() })
    const aug = s.list('transactions.json.enc').find((x) => x.id === bookingId('huur', '2026-08'))!
    await remove(s, 'transactions.json.enc', aug.id)
    expect(await inTx(s, bookFixedCosts, '2026-11-12')).toBe(0)
    expect(s.list('transactions.json.enc').find((x) => x.id === sept.id)?.amount).toBe(480)
    expect(s.list('transactions.json.enc').some((x) => x.id === aug.id)).toBe(false)
    // Een tweede apparaat met dezelfde vaste last maakt precies dezelfde id's.
    expect(missingBookings([rent], [], '2026-11-12', T).map((x) => x.id)).toEqual([bookingId('huur', '2026-08'), sept.id, bookingId('huur', '2026-10')])
  })

  it('een geboekte vaste last is geen losse uitgave en hoort bij geen periode zonder Nakijken', async () => {
    const s = await store()
    await put(s, 'transactions.json.enc', tx('vast', { fixedCostId: 'huur', id: bookingId('huur', '2026-09'), date: '2026-09-30', amount: 500 }))
    expect(reviewItems(reviewInput(s)).some((i) => i.kind === 'geld-zonder-periode')).toBe(false)
    const index = buildIndex([], [], [])
    const averages = dayAverages(s.list('transactions.json.enc'), [], index, '2026-10-10', { ...DEFAULT_SETTINGS, updatedAt: T, deletedAt: null }, null)
    expect(averages.thuis.days).toBe(0)
  })
})

describe('kosten werkelijk per maand', () => {
  it('vast, los (zonder declaraties en investeringen) en de weekschatting verdeeld over de dagen van de week', () => {
    const closing: WeekClosing = { id: 'week:2026-W44', week: '2026-W44', start: '2026-10-26', spent: { amount: 70, currency: 'EUR' }, updatedAt: T, deletedAt: null }
    const rows = actualCosts(
      [
        tx('v', { fixedCostId: 'huur', date: '2026-10-31', amount: 550, amountEur: 550 }),
        tx('l', { amount: 20, amountEur: 20 }),
        tx('d', { amount: 99, amountEur: 99, claimId: 'c' }),
        tx('i', { kind: 'investering', amount: 300, amountEur: 300 }),
      ],
      [closing],
      '2026-11-03',
      null,
    )
    // 26 okt t/m 1 nov: zes dagen in oktober, één in november.
    expect(rows).toEqual([
      { month: '2026-11', fixedEur: 0, looseEur: 0, weekEur: 10, totalEur: 10, other: {} },
      { month: '2026-10', fixedEur: 550, looseEur: 20, weekEur: 60, totalEur: 630, other: {} },
    ])
  })
})
