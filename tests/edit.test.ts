import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { deleteLeg, deleteTransaction, deleteTrip, parseNonNegative, renameTrip, updateLeg, updateTransaction } from '../src/model/edit'
import { currentSettings, DEFAULT_SETTINGS, yearGoal } from '../src/model/settings'
import type { Leg, Settings, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { decodeRecords, encodeRecords } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'

// Bewerken en verwijderen met ongedaan maken. Verzonnen data.

const TOKEN = 'github_pat_BEWERK_0123456789abcdefghijklmnopqrstuvwxyz'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-bewerk-${++counter}`)
  return Store.open(db, masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, name: string): Trip => ({ id, name, updatedAt: T0, deletedAt: null })
const leg = (id: string, tripId: string, date: string, nmSea = 10): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nepstad',
  fromCountry: 'Nepland',
  toPlace: 'Nepdorp',
  toCountry: 'Nepland',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: true,
  source: 'import',
  updatedAt: T0,
  deletedAt: null,
})
const tx = (id: string, date: string, currency: Transaction['currency'] = 'EUR'): Transaction => ({
  id,
  date,
  kind: 'fooi',
  amount: 50,
  currency,
  ...(currency === 'EUR' ? { amountEur: 50 } : {}),
  source: 'yacht-week',
  updatedAt: T0,
  deletedAt: null,
})

describe('verwijderen en ongedaan maken', () => {
  it('verwijdert een transactie als tombstone en zet hem terug', async () => {
    const s = await store()
    await s.put('transactions.json.enc', tx('t1', '2026-05-01'))
    const undo = await deleteTransaction(s, s.get('transactions.json.enc')[0]!)
    expect(s.list('transactions.json.enc')).toHaveLength(0)
    expect(s.get('transactions.json.enc')[0]?.deletedAt).not.toBeNull()
    await undo()
    expect(s.list('transactions.json.enc').map((t) => t.id)).toEqual(['t1'])
    expect(s.list('transactions.json.enc')[0]!.updatedAt > T0).toBe(true)
  })

  it('de laatste dag van een tocht neemt de tocht mee; ongedaan maken zet beide terug', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'Tocht A')])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-05-01')])
    const undo = await deleteLeg(s, s.list('legs.json.enc')[0]!)
    expect(s.list('trips.json.enc')).toHaveLength(0)
    await undo()
    expect(s.list('trips.json.enc')).toHaveLength(1)
    expect(s.list('legs.json.enc')).toHaveLength(1)
  })

  it('de laatste dag van een trip waar iets aan hangt (fooi, deelnemers, eigen salaris) of met eigen datums: de trip blijft', async () => {
    const s = await store()
    // Een trip die de dagen volgt, met een fooi; een met deelnemers; een met een eigen salaris; een met eigen datums.
    await s.putMany('trips.json.enc', [
      { ...trip('fooi', 'Met fooi'), datesFromDays: true, startDate: '2026-05-01', endDate: '2026-05-01' },
      { ...trip('gasten', 'Met gasten'), participants: [{ id: 'p1', firstName: 'Nepnick' }] },
      { ...trip('salaris', 'Met salaris'), salary: { amount: 900, currency: 'EUR', status: 'verwacht', source: 'eigen' } },
      { ...trip('gepland', 'Gepland'), startDate: '2026-05-01', endDate: '2026-05-07' },
    ])
    await s.put('transactions.json.enc', { ...tx('t1', '2026-05-01'), tripId: 'fooi' })
    await s.putMany('legs.json.enc', [leg('l1', 'fooi', '2026-05-01'), leg('l2', 'gasten', '2026-05-02'), leg('l3', 'salaris', '2026-05-03'), leg('l4', 'gepland', '2026-05-04')])
    for (const l of s.list('legs.json.enc')) await deleteLeg(s, l)
    expect(s.list('legs.json.enc')).toHaveLength(0)
    expect(s.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['fooi', 'gasten', 'gepland', 'salaris'])
  })

  it('een tocht verwijderen verwijdert ook de dagen', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'Tocht A'), trip('b', 'Tocht B')])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-05-01'), leg('l2', 'a', '2026-05-02'), leg('l3', 'b', '2026-06-01')])
    const undo = await deleteTrip(s, s.list('trips.json.enc').find((t) => t.id === 'a')!)
    expect(s.list('legs.json.enc').map((l) => l.id)).toEqual(['l3'])
    await undo()
    expect(s.list('legs.json.enc')).toHaveLength(3)
  })
})

describe('bewerken', () => {
  it('hernoemt een tocht, en negeert een lege naam', async () => {
    const s = await store()
    await s.put('trips.json.enc', trip('a', 'Oud'))
    await renameTrip(s, s.list('trips.json.enc')[0]!, '  Nieuw  ')
    expect(s.list('trips.json.enc')[0]!.name).toBe('Nieuw')
    await renameTrip(s, s.list('trips.json.enc')[0]!, '   ')
    expect(s.list('trips.json.enc')[0]!.name).toBe('Nieuw')
  })

  it('verplaatst een dag naar een andere of nieuwe tocht; een nieuwe datum is niet meer geschat', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'A'), trip('b', 'B')])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-05-01')])
    const { id: _id, updatedAt: _u, deletedAt: _d, source: _s, dateEstimated: _e, tripId: _t, ...patch } = s.list('legs.json.enc')[0]!
    void [_id, _u, _d, _s, _e, _t]
    await updateLeg(s, s.list('legs.json.enc')[0]!, { ...patch, nmSea: 12.5 }, { id: 'b' })
    expect(s.list('legs.json.enc')[0]).toMatchObject({ tripId: 'b', nmSea: 12.5, dateEstimated: true, source: 'import' })
    await updateLeg(s, s.list('legs.json.enc')[0]!, { ...patch, date: '2026-05-03', notes: '' }, { newName: 'Nieuwe tocht' })
    const moved = s.list('legs.json.enc')[0]!
    expect(moved.dateEstimated).toBe(false)
    expect(moved.notes).toBeUndefined()
    expect(s.list('trips.json.enc').find((t) => t.id === moved.tripId)?.name).toBe('Nieuwe tocht')
  })

  it('werkt een transactie bij: amountEur volgt de valuta, tripId volgt de datum', async () => {
    const s = await store()
    await s.putMany('trips.json.enc', [trip('a', 'A')])
    await s.putMany('legs.json.enc', [leg('l1', 'a', '2026-05-01'), leg('l2', 'a', '2026-05-03')])
    await s.put('transactions.json.enc', tx('t1', '2026-04-01'))
    const base = { kind: 'fooi' as const, source: 'yacht-week' as const }
    await updateTransaction(s, s.list('transactions.json.enc')[0]!, { ...base, amount: 70, currency: 'EUR', date: '2026-05-02' })
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ amount: 70, amountEur: 70, tripId: 'a' })
    await updateTransaction(s, s.list('transactions.json.enc')[0]!, { ...base, amount: 70, currency: 'USD', date: '2026-06-02', note: 'Nep' })
    const usd = s.list('transactions.json.enc')[0]!
    expect(usd.amountEur).toBeUndefined()
    expect(usd.tripId).toBeUndefined()
    expect(usd.note).toBe('Nep')
  })

  it('leest getallen voor mijlen en nachturen, waar 0 en leeg geldig zijn', () => {
    expect(parseNonNegative('')).toBe(0)
    expect(parseNonNegative('12,5')).toBe(12.5)
    expect(parseNonNegative('0')).toBe(0)
    expect(parseNonNegative('-1')).toBeNull()
    expect(parseNonNegative('twaalf')).toBeNull()
  })
})

describe('instellingen van de vorige versie', () => {
  it('een settings-record zonder de nieuwe velden blijft geldig; jaardoel standaard 2.500 nm', () => {
    const old = {
      id: 'settings',
      updatedAt: T0,
      deletedAt: null,
      lastBoat: 'Nepboot',
      lastRole: 'schipper',
      lastCurrency: 'EUR',
      lastSource: 'yacht-week',
    }
    const [record] = decodeRecords<Settings>('settings.json.enc', encodeRecords([old]))
    const settings = currentSettings([record!])
    expect(yearGoal(settings)).toBe(2500)
    expect(settings.lastWater).toBeUndefined()
    expect(yearGoal({ ...DEFAULT_SETTINGS, yearGoalNm: 3000 })).toBe(3000)
    expect(yearGoal({ ...DEFAULT_SETTINGS, yearGoalNm: -5 })).toBe(2500)
  })
})
