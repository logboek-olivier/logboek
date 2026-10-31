import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { geschiedenisOpruimen, geschiedenisTerugzetten, terugzetten, tripTerugzetten } from '../src/domain/prullenbak'
import { termijnAfronden } from '../src/domain/termijnen'
import { reviewInput, reviewItems } from '../src/model/review'
import { bootVerwijderen, deelnemerToevoegen, deelnemerVerwijderen, periodeVervangen, periodeVerwijderen } from '../src/domain/trips'
import { dagVerwijderen } from '../src/domain/dagen'
import { studentenWissen } from '../src/domain/training'
import { boatList } from '../src/model/boats'
import { movedAway, relinkCandidates, trashItems } from '../src/model/trash'

import type { Leg, StayPeriod, Student, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put, putMany } from './helpers/schrijf'

// De prullenbak (Meer → Prullenbak) en de geschiedenis eronder (history.json.enc): 30 dagen terug te zetten, met wat
// eraan hing; daarna definitief. Alleen nepdata.

const TOKEN = 'github_pat_PRULLENBAK_0123456789abcdefghijklmnopqrstuvwxyz'
const T0 = '2026-10-01T00:00:00.000Z'
let counter = 0

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return Store.open(await openLogboekDb(`logboek-prullenbak-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Neptrip ${id}`, startDate: '2026-10-10', endDate: '2026-10-16', ...extra, updatedAt: T0, deletedAt: null })
const leg = (id: string, tripId: string, date: string): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nephaven',
  fromCountry: '',
  toPlace: 'Nepbaai',
  toCountry: '',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 12,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: T0,
  deletedAt: null,
})
const money = (id: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date, kind: 'kosten', amount: 20, currency: 'EUR', amountEur: 20, source: 'overig', ...extra, updatedAt: T0, deletedAt: null })

async function filled(): Promise<Store> {
  const s = await store()
  await put(s, 'trips.json.enc', trip('a', { participants: [{ id: 'p1', firstName: 'Nepanna' }] }))
  await putMany(s, 'legs.json.enc', [leg('l1', 'a', '2026-10-11'), leg('l2', 'a', '2026-10-12')])
  await put(s, 'transactions.json.enc', money('t1', '2026-10-11', { tripId: 'a' }))
  return s
}

describe('prullenbak', () => {
  it('een periode met alles naar de prullenbak: staat erin met wat eraan hing, en komt met één tik helemaal terug', async () => {
    const s = await filled()
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'alles')
    expect(s.list('legs.json.enc')).toEqual([])
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'periode', title: 'Neptrip a', counts: { days: 2, money: 1, participants: 1 } })
    const { result } = await terugzetten(s, item!.key)
    expect(result).toBeGreaterThan(3)
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['a'])
    expect(s.list('legs.json.enc').map((l) => l.id).sort()).toEqual(['l1', 'l2'])
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ id: 't1', tripId: 'a' })
    expect(trashItems(s)).toEqual([])
  })

  it('geld en dagen behouden zonder periode: ze blijven staan en hangen weer aan de periode na terugzetten', async () => {
    const s = await filled()
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'behouden')
    expect(s.list('legs.json.enc')).toHaveLength(2)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe('a')
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'periode', counts: { days: 0, money: 0 } })
    await terugzetten(s, item!.key)
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['a'])
  })

  it('ongedaan maken haalt het uit de prullenbak', async () => {
    const s = await filled()
    const undo = await dagVerwijderen(s, s.list('legs.json.enc')[0]!)
    expect(trashItems(s).map((i) => i.kind)).toEqual(['dag'])
    await undo()
    expect(trashItems(s)).toEqual([])
    expect(s.list('legs.json.enc')).toHaveLength(2)
  })

  it('een deelnemer terug, ook als er intussen een andere bij kwam', async () => {
    const s = await filled()
    await deelnemerVerwijderen(s, s.list('trips.json.enc')[0]!, 'p1')
    const student: Student = { id: 'p2', firstName: 'Nepbob', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, archivedAt: null, updatedAt: T0, deletedAt: null }
    await deelnemerToevoegen(s, s.list('trips.json.enc')[0]!, student)
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'deelnemer', title: 'Nepanna · Neptrip a' })
    await terugzetten(s, item!.key)
    expect(s.list('trips.json.enc')[0]!.participants!.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('een boot terug op de trips en dagen', async () => {
    const s = await filled()
    await put(s, 'trips.json.enc', { ...s.list('trips.json.enc')[0]!, boat: 'Nepboot', updatedAt: '2026-10-02T00:00:00.000Z' })
    await bootVerwijderen(s, boatList(s.list('trips.json.enc'), s.list('legs.json.enc'))[0]!)
    expect(s.list('legs.json.enc').every((l) => !l.boat)).toBe(true)
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'boot', title: 'Nepboot' })
    await terugzetten(s, item!.key)
    expect(s.list('legs.json.enc').every((l) => l.boat === 'Nepboot')).toBe(true)
    expect(s.list('trips.json.enc')[0]!.boat).toBe('Nepboot')
  })

  it('na 30 dagen definitief: de geschiedenis verliest zijn inhoud en het staat niet meer in de prullenbak', async () => {
    const s = await filled()
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'alles')
    expect(trashItems(s)).toHaveLength(1)
    const later = new Date(Date.now() + 31 * 86_400_000).toISOString()
    expect(trashItems(s, later)).toEqual([])
    await geschiedenisOpruimen(s, later)
    expect(s.get('history.json.enc').every((h) => h.changes.length === 0)).toBe(true)
  })

  it('wissen van studenten komt niet in de geschiedenis (regel 14): hun naam staat nergens', async () => {
    const s = await store()
    const student: Student = { id: 's1', firstName: 'Nepcarla', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, archivedAt: '2026-01-01', updatedAt: T0, deletedAt: null }
    await put(s, 'students.json.enc', student)
    await studentenWissen(s, [student])
    expect(JSON.stringify(s.get('history.json.enc'))).not.toContain('Nepcarla')
    expect(JSON.stringify(s.get('students.json.enc'))).not.toContain('Nepcarla')
  })
})

describe('van vóór de geschiedenis', () => {
  it('een trip die eerder verwijderd werd: met zijn dagen terug, en geld dat nu bij Thuis staat alleen als Olivier het aanvinkt', async () => {
    const s = await store()
    const at = new Date(Date.now() - 2 * 86_400_000).toISOString()
    // Nagebootst: trip en dag als tombstone met inhoud (dezelfde tijd), de uitgave intussen bij een thuisperiode.
    await put(s, 'trips.json.enc', { ...trip('sv'), name: 'Nep SV Academy', updatedAt: at, deletedAt: at })
    await put(s, 'legs.json.enc', { ...leg('l9', 'sv', '2026-10-12'), updatedAt: at, deletedAt: at })
    const home: StayPeriod = { id: 'periode:thuis:2026-10-01', kind: 'thuis', startDate: '2026-10-01', endDate: '2026-10-31', updatedAt: T0, deletedAt: null }
    await put(s, 'periods.json.enc', home)
    await putMany(s, 'transactions.json.enc', [money('fee', '2026-09-20', { tripId: home.id, note: 'Nep cursusgeld', amount: 2499, currency: 'USD' }), money('ander', '2026-10-20', { tripId: home.id })])
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'periode', title: 'Nep SV Academy', counts: { days: 1 } })
    expect(relinkCandidates(s, item!).map((tx) => tx.id)).toEqual(['fee', 'ander'])
    await terugzetten(s, item!.key, ['fee'])
    expect(s.list('trips.json.enc').map((t) => t.id)).toEqual(['sv'])
    expect(s.list('legs.json.enc').map((l) => l.id)).toEqual(['l9'])
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'fee')!.tripId).toBe('sv')
    // Niet aangevinkt: blijft waar het was.
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'ander')!.tripId).toBe(home.id)
  })

  it('een week die met "Meenemen naar trip" in een andere opging (7 dagen, 10 gelogd): de dagen gaan terug naar hun eigen week', async () => {
    const s = await store()
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString()
    // Nagebootst zoals de oude "Meenemen naar trip …" het achterliet: de trip weg, zijn dagen bij SV #2 met dezelfde tijd.
    await put(s, 'trips.json.enc', { ...trip('sv2'), name: 'Nep SV #2', startDate: '2026-10-10', endDate: '2026-10-16' })
    await put(s, 'trips.json.enc', { ...trip('ander'), name: 'Nep andere week', startDate: '2026-10-17', endDate: '2026-10-19', updatedAt: at, deletedAt: at })
    await putMany(s, 'legs.json.enc', [leg('eigen', 'sv2', '2026-10-11'), { ...leg('m1', 'sv2', '2026-10-17'), updatedAt: at }, { ...leg('m2', 'sv2', '2026-10-18'), updatedAt: at }])
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'periode', title: 'Nep andere week' })
    expect(movedAway(s, item!).map((m) => m.record.id).sort()).toEqual(['m1', 'm2'])
    await terugzetten(s, item!.key, ['m1', 'm2'])
    expect(s.list('legs.json.enc').filter((l) => l.tripId === 'ander').map((l) => l.id).sort()).toEqual(['m1', 'm2'])
    expect(s.list('legs.json.enc').filter((l) => l.tripId === 'sv2').map((l) => l.id)).toEqual(['eigen'])
  })

  it('vervangen (overlap) staat in de prullenbak; terugzetten splitst de dagen weer', async () => {
    const s = await filled()
    await put(s, 'trips.json.enc', trip('b', { startDate: '2026-10-14', endDate: '2026-10-20' }))
    await periodeVervangen(s, s.list('trips.json.enc').find((t) => t.id === 'b')!, s.list('trips.json.enc').find((t) => t.id === 'a')!)
    expect(s.list('legs.json.enc').every((l) => l.tripId === 'b')).toBe(true)
    const [item] = trashItems(s)
    expect(item).toMatchObject({ kind: 'periode', title: 'Neptrip a', counts: { days: 2, money: 1 } })
    await terugzetten(s, item!.key)
    expect(s.list('legs.json.enc').every((l) => l.tripId === 'a')).toBe(true)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe('a')
  })

  it('een import vervangt zijn dagen: dat is geen verwijdering door Olivier en staat niet in de prullenbak', async () => {
    const s = await store()
    const at = new Date(Date.now() - 86_400_000).toISOString()
    await put(s, 'legs.json.enc', { ...leg('imp', 'x', '2026-10-12'), source: 'import', updatedAt: at, deletedAt: at })
    expect(trashItems(s)).toEqual([])
  })
})

describe('punten uit de review', () => {
  it('een gewiste student komt niet terug met zijn verwijderde trip, en staat niet meer in de geschiedenis (regel 14)', async () => {
    const s = await filled()
    const student: Student = { id: 'p1', firstName: 'Nepanna', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, archivedAt: null, weekId: 'a', updatedAt: T0, deletedAt: null }
    await put(s, 'students.json.enc', student)
    await deelnemerVerwijderen(s, s.list('trips.json.enc')[0]!, 'p1')
    await put(s, 'trips.json.enc', { ...s.list('trips.json.enc')[0]!, participants: [{ id: 'p1', firstName: 'Nepanna', curriculumId: 'seed-asa-101' }], updatedAt: new Date().toISOString() })
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'behouden')
    await studentenWissen(s, [s.list('students.json.enc')[0]!])
    expect(JSON.stringify(s.get('trips.json.enc'))).not.toContain('Nepanna')
    expect(JSON.stringify(s.get('history.json.enc'))).not.toContain('Nepanna')
    for (const item of trashItems(s)) await terugzetten(s, item.key)
    expect(JSON.stringify(s.get('trips.json.enc'))).not.toContain('Nepanna')
  })

  it('na het opruimen van de geschiedenis komen opgeruimde tochten van een import niet in de prullenbak', async () => {
    const s = await store()
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
    await dagVerwijderen(s, (await (async () => { await put(s, 'trips.json.enc', trip('x')); await put(s, 'legs.json.enc', leg('lx', 'x', '2026-10-11')); return s.list('legs.json.enc')[0]! })()))
    // Een import ruimt een tocht op (zonder regel in de geschiedenis), na de eerste regel.
    const at = day(1)
    await put(s, 'trips.json.enc', { ...trip('imp'), name: 'Nep import', updatedAt: at, deletedAt: at })
    await put(s, 'legs.json.enc', { ...leg('li', 'imp', '2026-10-12'), source: 'import', updatedAt: at, deletedAt: at })
    await geschiedenisOpruimen(s, day(31))
    expect(trashItems(s, day(32)).map((i) => i.title)).not.toContain('Nep import')
  })

  it('dagen behouden zonder periode staan in Nakijken, met de keuze terug te zetten', async () => {
    const s = await filled()
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'behouden')
    const items = reviewItems(reviewInput(s)).filter((i) => i.kind === 'dagen-zonder-trip')
    expect(items).toEqual([expect.objectContaining({ tripId: 'a', tripName: 'Neptrip a', legs: [expect.objectContaining({ id: 'l1' }), expect.objectContaining({ id: 'l2' })] })])
    await tripTerugzetten(s, 'a')
    expect(reviewItems(reviewInput(s)).filter((i) => i.kind === 'dagen-zonder-trip')).toEqual([])
  })

  it('terugzetten zet een veld dat null was weer op null (niet weg)', async () => {
    const s = await store()
    const reminder = { id: 'r1', title: 'Nep termijn', date: '2026-12-01', kind: 'deadline' as const, doneAt: null, note: '', updatedAt: T0, deletedAt: null }
    await put(s, 'reminders.json.enc', reminder)
    await termijnAfronden(s, reminder, true, '2026-11-01')
    expect(s.list('reminders.json.enc')[0]!.doneAt).toBe('2026-11-01')
    const entry = s.list('history.json.enc').find((h) => h.command === 'termijnAfronden')!
    await geschiedenisTerugzetten(s, entry.id)
    expect(s.list('reminders.json.enc')[0]).toHaveProperty('doneAt', null)
  })

  it('bij terugzetten met dagen terug van een andere trip, volgen de datums van die trip weer zijn dagen', async () => {
    const s = await store()
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString()
    await put(s, 'trips.json.enc', { ...trip('b'), name: 'Nep B', startDate: '2026-10-01', endDate: '2026-10-12', datesFromDays: true })
    await put(s, 'trips.json.enc', { ...trip('a'), name: 'Nep A', startDate: '2026-10-10', endDate: '2026-10-12', updatedAt: at, deletedAt: at })
    await putMany(s, 'legs.json.enc', [leg('b1', 'b', '2026-10-01'), leg('b2', 'b', '2026-10-05'), { ...leg('m1', 'b', '2026-10-10'), updatedAt: at }, { ...leg('m2', 'b', '2026-10-12'), updatedAt: at }])
    const [item] = trashItems(s)
    await terugzetten(s, item!.key, ['m1', 'm2'])
    expect(s.list('trips.json.enc').find((x) => x.id === 'b')).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-05' })
  })
})
