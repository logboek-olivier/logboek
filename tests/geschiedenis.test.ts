import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dagBewerken, dagLoggen } from '../src/domain/dagen'
import { uitgaveBewerken } from '../src/domain/geld'
import { geschiedenisTerugzetten } from '../src/domain/prullenbak'
import { landperiodeZetten } from '../src/domain/agenda'
import { periodeVerwijderen } from '../src/domain/trips'
import { historyRows } from '../src/model/history-view'
import { placeLeg } from '../src/model/leg-trip'
import type { Leg, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'

// PR 2: nooit stil verhuizen, en de geschiedenis per dag en per periode met terugzetten. Alleen nepdata.

const TOKEN = 'github_pat_GESCHIEDENIS_0123456789abcdefghijklmnopqrstuvwxyz'
const T0 = '2026-10-01T00:00:00.000Z'
let counter = 0

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return Store.open(await openLogboekDb(`logboek-geschiedenis-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Neptrip ${id}`, startDate: '2026-10-10', endDate: '2026-10-16', ...extra, updatedAt: T0, deletedAt: null })
const expense = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date: '2026-10-12', kind: 'kosten', amount: 30, currency: 'EUR', amountEur: 30, source: 'overig', category: 'eten', ...extra, updatedAt: T0, deletedAt: null })

describe('nooit stil verhuizen', () => {
  it('een uitgave bewerken waarvan de periode in de prullenbak ligt: "Zonder periode" houdt de koppeling', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('weg'))
    await put(s, 'transactions.json.enc', expense('e1', { tripId: 'weg', note: 'Nep cursusgeld' }))
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'behouden')
    // Een thuisperiode op die datum: vroeger viel "Hoort bij" daarop terug en verhuisde het geld bij opslaan.
    await landperiodeZetten(s, ['2026-10-12'], 'thuis')
    await uitgaveBewerken(s, s.list('transactions.json.enc')[0]!, { kind: 'zonder', keep: 'weg' }, { date: '2026-10-12', kind: 'kosten', amount: 35, currency: 'EUR', category: 'eten' })
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ amount: 35, tripId: 'weg' })
  })

  it('een periode aan land korter maken of weghalen laat het geld bij die periode', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2026-11-01', '2026-11-02', '2026-11-03'], 'thuis')
    const home = s.list('periods.json.enc')[0]!
    await put(s, 'transactions.json.enc', expense('e2', { date: '2026-11-03', tripId: home.id }))
    await landperiodeZetten(s, ['2026-11-03'], null)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe(home.id)
  })

  it('een thuisperiode die gesplitst wordt of samengaat met een buur: het geld blijft bij dezelfde dagen thuis', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'], 'thuis')
    const home = s.list('periods.json.enc')[0]!
    await put(s, 'transactions.json.enc', expense('e3', { date: '2026-11-05', tripId: home.id }))
    // Splitsen: 3 november wordt reis; 4 en 5 november zijn een nieuw stuk thuis (nieuw id).
    await landperiodeZetten(s, ['2026-11-03'], 'reis')
    const second = s.list('periods.json.enc').find((p) => p.kind === 'thuis' && p.startDate === '2026-11-04')!
    expect(second.id).not.toBe(home.id)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe(second.id)
    // Samengaan: 3 november weer thuis; het geld volgt de periode die blijft.
    await landperiodeZetten(s, ['2026-11-03'], 'thuis')
    const merged = s.list('periods.json.enc').filter((p) => p.kind === 'thuis')
    expect(merged).toHaveLength(1)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe(merged[0]!.id)
    // Een andere soort op die dag: het geld blijft bij zijn eigen (nu kortere) periode, niet bij de reis.
    await landperiodeZetten(s, ['2026-11-05'], 'reis')
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe(merged[0]!.id)
  })

  it('een voorgevulde trip slokt nooit een dag op die ver weg ligt; vlak ernaast zegt het formulier dat Opslaan verlengt', () => {
    const follow = trip('volgt', { startDate: '2026-10-10', endDate: '2026-10-11', datesFromDays: true })
    const legs: Leg[] = [{ id: 'l1', tripId: 'volgt', date: '2026-10-10', fromPlace: '', fromCountry: '', toPlace: '', toCountry: '', role: 'schipper', boat: '', nmInland: 0, nmSea: 0, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T0, deletedAt: null }]
    expect(placeLeg([follow], legs, 'volgt', '2026-10-11').tripId).toBe('volgt')
    expect(placeLeg([follow], legs, 'volgt', '2026-10-12')).toEqual({ tripId: 'volgt', extend: { start: '2026-10-10', end: '2026-10-12' } })
    expect(placeLeg([follow], legs, 'volgt', '2026-12-01')).toEqual({ tripId: null, moved: true })
  })
})

describe('geschiedenis', () => {
  async function logged(): Promise<Store> {
    const s = await store()
    await put(s, 'trips.json.enc', trip('a'))
    await dagLoggen(s, { date: '2026-10-11', tripId: 'a', newTripName: '', fromPlace: 'Nephaven', toPlace: 'Nepbaai', role: 'schipper', boat: '', water: 'zee', nm: 12, nightHours: 0, wind: '', notes: '' })
    return s
  }

  it('per periode en per dag: de opdrachten die hem raakten, nieuwste eerst', async () => {
    const s = await logged()
    const leg = s.list('legs.json.enc')[0]!
    await dagBewerken(s, leg, { ...leg, nmSea: 14 } as Omit<Leg, 'id' | 'updatedAt' | 'deletedAt' | 'source' | 'dateEstimated' | 'tripId'>, { id: 'a' })
    expect(historyRows(s, { periodId: 'a' }).map((r) => r.entry.command)).toEqual(['dagBewerken', 'dagLoggen'])
    expect(historyRows(s, { date: '2026-10-11' }).map((r) => r.entry.command)).toEqual(['dagBewerken', 'dagLoggen'])
    expect(historyRows(s, { date: '2026-10-20' })).toEqual([])
    expect(historyRows(s, { periodId: 'ander' })).toEqual([])
  })

  it('terugzetten zet een bewerking terug, en is zelf weer terug te zetten', async () => {
    const s = await logged()
    const leg = s.list('legs.json.enc')[0]!
    await dagBewerken(s, leg, { ...leg, nmSea: 14 } as Omit<Leg, 'id' | 'updatedAt' | 'deletedAt' | 'source' | 'dateEstimated' | 'tripId'>, { id: 'a' })
    const edit = historyRows(s).find((r) => r.entry.command === 'dagBewerken')!
    await geschiedenisTerugzetten(s, edit.entry.id)
    expect(s.list('legs.json.enc')[0]!.nmSea).toBe(12)
    expect(historyRows(s).find((r) => r.entry.id === edit.entry.id)!.entry.undoneAt).toBeTruthy()
    const back = historyRows(s).find((r) => r.entry.command === 'geschiedenisTerugzetten')!
    await geschiedenisTerugzetten(s, back.entry.id)
    expect(s.list('legs.json.enc')[0]!.nmSea).toBe(14)
  })

  it('per dag: ook een dag die naar die datum verschoof', async () => {
    const s = await logged()
    const leg = s.list('legs.json.enc')[0]!
    await dagBewerken(s, leg, { ...leg, date: '2026-10-12' } as Omit<Leg, 'id' | 'updatedAt' | 'deletedAt' | 'source' | 'dateEstimated' | 'tripId'>, { id: 'a' })
    expect(historyRows(s, { date: '2026-10-12' }).map((r) => r.entry.command)).toEqual(['dagBewerken', 'dagLoggen'])
  })

  it('een nieuwe trip terugzetten waar intussen een dag aan hangt: de trip blijft, de eerste dag gaat weg', async () => {
    const s = await store()
    await dagLoggen(s, { date: '2026-10-11', tripId: null, newTripName: 'Nep nieuw', fromPlace: 'Nephaven', toPlace: 'Nepbaai', role: 'schipper', boat: '', water: 'zee', nm: 5, nightHours: 0, wind: '', notes: '' })
    const created = historyRows(s).find((r) => r.entry.command === 'dagLoggen')!
    const tripId = s.list('trips.json.enc')[0]!.id
    await dagLoggen(s, { date: '2026-10-12', tripId, explicit: true, newTripName: '', fromPlace: 'Nepbaai', toPlace: 'Nephaven', role: 'schipper', boat: '', water: 'zee', nm: 5, nightHours: 0, wind: '', notes: '' })
    await geschiedenisTerugzetten(s, created.entry.id)
    expect(s.list('trips.json.enc').map((x) => x.id)).toEqual([tripId])
    expect(s.list('legs.json.enc').map((l) => [l.date, l.tripId])).toEqual([['2026-10-12', tripId]])
  })

  it('een gelogde dag terugzetten haalt hem weg (een nieuwe dag)', async () => {
    const s = await logged()
    const log = historyRows(s).find((r) => r.entry.command === 'dagLoggen')!
    await geschiedenisTerugzetten(s, log.entry.id)
    expect(s.list('legs.json.enc')).toEqual([])
  })
})
