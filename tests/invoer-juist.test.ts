import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { addClaim, markRepaid } from '../src/model/claims'
import { deleteTransaction } from '../src/model/edit'
import { logPlanned } from '../src/model/routes'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Leg, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Fundering: invoer komt goed terecht. "Zoals gepland" logt een dag nooit twee keer en neemt het land van de plaats of
// van de trip, nooit van een andere trip; de uitgave of terugbetaling van een declaratie verwijderen in Geld laat de
// declaratie kloppen. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  return Store.open(await openLogboekDb(`logboek-invoer-${++counter}`), masterKey, new GithubClient('github_pat_INVOER_0123456789abcdefghijklmnopqrstuvwxy', new FakeGithub().fetch))
}

const englishLeg: Leg = {
  id: 'eng',
  tripId: 'andere',
  date: '2026-12-01',
  fromPlace: 'Nepcowes',
  fromCountry: 'Nepengeland',
  toPlace: 'Neplymington',
  toCountry: 'Nepengeland',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 10,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: T0,
  deletedAt: null,
}

describe('Zoals gepland', () => {
  it('twee tikken loggen één dag, met het land van de trip en nooit dat van een andere trip', async () => {
    const s = await store()
    const trip = { id: 'bvi', name: 'Nep BVI', startDate: '2026-11-01', endDate: '2026-11-07', type: 'skipper-charter', route: [{ day: 0, from: 'Nepcay', to: 'Nepnorman', nm: 6 }, { day: 1, from: 'Nepnorman', to: 'Nepjost', nm: 8 }], updatedAt: T0, deletedAt: null } as Trip
    await s.put('trips.json.enc', trip)
    // Een andere trip in een ander land, met een latere datum (vooruit ingevoerd).
    await s.put('legs.json.enc', englishLeg)
    const first = trip.route![0]!
    await Promise.all([logPlanned(s, trip, first, '2026-11-01', DEFAULT_SETTINGS), logPlanned(s, trip, first, '2026-11-01', DEFAULT_SETTINGS)])
    const mine = () => s.list('legs.json.enc').filter((l) => l.tripId === 'bvi')
    expect(mine()).toHaveLength(1)
    expect(mine()[0]!.toCountry).not.toBe('Nepengeland')
    // De dag erna: het land van de vorige dag in dezelfde trip (hier nog onbekend, dus leeg), niet Engeland.
    await s.put('legs.json.enc', { ...mine()[0]!, toCountry: 'Nepmaagden', fromCountry: 'Nepmaagden', updatedAt: new Date().toISOString() })
    await logPlanned(s, trip, trip.route![1]!, '2026-11-02', DEFAULT_SETTINGS)
    expect(mine().find((l) => l.date === '2026-11-02')).toMatchObject({ fromCountry: 'Nepmaagden', toCountry: 'Nepmaagden' })
  })
})

describe('de uitgave of terugbetaling van een declaratie verwijderen in Geld', () => {
  it('de terugbetaling weg: de declaratie staat weer op ingediend (en telt weer als te ontvangen); ongedaan maken zet alles terug', async () => {
    const s = await store()
    const claim = await addClaim(s, { date: '2026-10-03', tripId: null, note: '', amount: 40, currency: 'EUR' }, null)
    await markRepaid(s, { ...claim, status: 'ingediend', submittedAt: '2026-10-04' }, { date: '2026-10-09', amount: 40, currency: 'EUR' })
    const repayment = s.list('transactions.json.enc').find((tx) => tx.kind === 'terugbetaling')!
    const undo = await deleteTransaction(s, repayment)
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'ingediend' })
    expect(s.list('claims.json.enc')[0]!.repaid).toBeUndefined()
    await undo()
    expect(s.list('claims.json.enc')[0]).toMatchObject({ status: 'terugbetaald' })
    expect(s.list('transactions.json.enc').some((tx) => tx.kind === 'terugbetaling')).toBe(true)
  })

  it('de uitgave weg: de declaratie houdt geen bedrag meer (niets meer te ontvangen); ongedaan maken zet het terug', async () => {
    const s = await store()
    await addClaim(s, { date: '2026-10-03', tripId: null, note: '', amount: 40, currency: 'EUR' }, null)
    const cost = s.list('transactions.json.enc').find((tx) => tx.kind === 'kosten')!
    const undo = await deleteTransaction(s, cost)
    expect(s.list('claims.json.enc')[0]!.amount).toBeUndefined()
    await undo()
    expect(s.list('claims.json.enc')[0]).toMatchObject({ amount: 40, currency: 'EUR' })
    expect(s.list('transactions.json.enc').some((tx) => tx.kind === 'kosten')).toBe(true)
  })
})
