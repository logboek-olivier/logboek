import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildIndex, clearDay, dayInfo, monthSummary, monthWeeks, setDay, shiftMonth, tripBars } from '../src/model/calendar'
import type { CalendarDay, Leg, Reminder, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Agenda: dagsoort per dag met de voorrang eigen instelling > binnen een trip > gelogde etappe > rust tussen twee
// trips > toekomst beschikbaar > verleden leeg. Alle gegevens verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
const TODAY = '2026-11-10'
let counter = 0
let masterKey: CryptoKey

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, updatedAt: NOW, deletedAt: null, ...extra })
const leg = (id: string, tripId: string, date: string, nm = 10, boat = 'Nepboot'): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nephaven',
  fromCountry: 'NL',
  toPlace: 'Nepdorp',
  toCountry: 'NL',
  role: 'schipper',
  boat,
  nmInland: 0,
  nmSea: nm,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'import',
  updatedAt: NOW,
  deletedAt: null,
})
const own = (date: string, type: CalendarDay['type'], extra: Partial<CalendarDay> = {}): CalendarDay => ({ id: `dag:${date}`, date, type, updatedAt: NOW, deletedAt: null, ...extra })

describe('dagsoort afleiden', () => {
  // Trip A 2–8 november (eerste en laatste dag werk), trip B 10–16 november: de 9e ertussen is rust.
  const trips = [trip('a', { startDate: '2026-11-02', endDate: '2026-11-08', boat: 'Nepboot A' }), trip('b', { startDate: '2026-11-10', endDate: '2026-11-16' })]
  const legs = [leg('l1', 'a', '2026-11-03', 12.5), leg('l2', 'a', '2026-11-03', 3), leg('los', 'x', '2026-11-20', 8)]

  it('voorrang: eigen instelling > trip > gelogde etappe > rust tussen trips > toekomst beschikbaar > verleden leeg', () => {
    const index = buildIndex([own('2026-11-05', 'rust')], trips, legs)
    expect(dayInfo(index, '2026-11-05', TODAY)).toMatchObject({ type: 'rust', source: 'eigen' })
    expect(dayInfo(index, '2026-11-02', TODAY)).toMatchObject({ type: 'werk', source: 'trip' })
    expect(dayInfo(index, '2026-11-08', TODAY)).toMatchObject({ type: 'werk', source: 'trip' })
    expect(dayInfo(index, '2026-11-09', TODAY)).toMatchObject({ type: 'rust', source: 'tussen' })
    expect(dayInfo(index, '2026-11-20', TODAY)).toMatchObject({ type: 'werk', source: 'etappe', nm: 8 })
    expect(dayInfo(index, '2026-11-25', TODAY)).toMatchObject({ type: 'beschikbaar', source: 'toekomst' })
    expect(dayInfo(index, '2026-10-20', TODAY)).toMatchObject({ type: null, source: null })
  })

  it('nm en boot van de dag; een eigen boot gaat voor de boot van de trip', () => {
    const index = buildIndex([own('2026-11-04', 'werk', { boat: 'Andere nepboot' })], trips, legs)
    expect(dayInfo(index, '2026-11-03', TODAY)).toMatchObject({ nm: 15.5, boat: 'Nepboot A' })
    expect(dayInfo(index, '2026-11-04', TODAY)).toMatchObject({ boat: 'Andere nepboot' })
  })

  it('geïmporteerde tochten zonder datums krijgen ze uit hun dagen; dagen ertussen zijn ook werk', () => {
    const imported = [trip('imp')]
    const days = [leg('i1', 'imp', '2025-07-01'), leg('i2', 'imp', '2025-07-04')]
    const index = buildIndex([], imported, days)
    for (const d of ['2025-07-01', '2025-07-02', '2025-07-03', '2025-07-04']) expect(dayInfo(index, d, TODAY).type, d).toBe('werk')
    expect(dayInfo(index, '2025-07-05', TODAY).type).toBeNull()
  })

  it('rust alleen bij een korte pauze (hoogstens twee dagen); daarna beschikbaar of leeg', () => {
    const two = [trip('a', { startDate: '2026-12-01', endDate: '2026-12-05' }), trip('b', { startDate: '2026-12-08', endDate: '2026-12-10' })]
    const three = [trip('a', { startDate: '2026-12-01', endDate: '2026-12-05' }), trip('b', { startDate: '2026-12-09', endDate: '2026-12-10' })]
    expect(dayInfo(buildIndex([], two, []), '2026-12-06', TODAY).type).toBe('rust')
    expect(dayInfo(buildIndex([], two, []), '2026-12-07', TODAY).type).toBe('rust')
    expect(dayInfo(buildIndex([], three, []), '2026-12-06', TODAY).type).toBe('beschikbaar')
  })

  it('verwijderde trips en eigen dagen tellen niet', () => {
    const index = buildIndex([{ ...own('2026-11-25', 'thuis'), deletedAt: NOW }], [trip('weg', { startDate: '2026-11-20', endDate: '2026-11-22', deletedAt: NOW })], [])
    expect(dayInfo(index, '2026-11-21', TODAY).type).toBe('beschikbaar')
    expect(dayInfo(index, '2026-11-25', TODAY).type).toBe('beschikbaar')
  })

  it('termijnen op hun dag (afgeronde niet)', () => {
    const reminders: Reminder[] = [
      { id: 'r1', title: 'Nepdeadline', date: '2026-11-12', kind: 'deadline', doneAt: null, updatedAt: NOW, deletedAt: null },
      { id: 'r2', title: 'Nep klaar', date: '2026-11-12', kind: 'deadline', doneAt: '2026-11-01', updatedAt: NOW, deletedAt: null },
    ]
    expect(dayInfo(buildIndex([], [], [], reminders), '2026-11-12', TODAY).reminders.map((r) => r.id)).toEqual(['r1'])
  })
})

describe('maandoverzicht', () => {
  it('weken beginnen op maandag en bedekken de hele maand', () => {
    const weeks = monthWeeks('2026-11')
    expect(weeks[0]![0]).toBe('2026-10-26')
    expect(weeks.at(-1)!.at(-1)).toBe('2026-12-06')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('tripbalken: over de dagen van de trip, twee rijen op een wisseldag', () => {
    const trips = [trip('a', { startDate: '2026-11-01', endDate: '2026-11-07' }), trip('b', { startDate: '2026-11-07', endDate: '2026-11-14' })]
    const index = buildIndex([], trips, [])
    const week = monthWeeks('2026-11')[1]! // 2–8 november
    const bars = tripBars(index, week)
    expect(bars.map((b) => [b.view.trip.id, b.from, b.to, b.lane, b.starts])).toEqual([
      ['a', 0, 5, 0, false],
      ['b', 5, 6, 1, true],
    ])
  })

  it('per maand werk-, rust-, reis- en thuisdagen en nm', () => {
    const trips = [trip('a', { startDate: '2026-11-02', endDate: '2026-11-08' }), trip('b', { startDate: '2026-11-10', endDate: '2026-11-11' })]
    const index = buildIndex([own('2026-11-20', 'reis'), own('2026-11-21', 'thuis'), own('2026-11-22', 'thuis')], trips, [leg('l', 'a', '2026-11-03', 20)])
    expect(monthSummary(index, '2026-11', TODAY)).toEqual({ werk: 9, rust: 1, reis: 1, thuis: 2, nm: 20 })
  })
})

describe('dag zelf instellen', () => {
  it('opslaan en terug naar automatisch; één record per dag (zelfde id op elk apparaat)', async () => {
    const db = await openLogboekDb(`logboek-agenda-${++counter}`)
    const store = await Store.open(db, masterKey, new GithubClient('github_pat_AGENDA_0123456789abcdefghijklmnopqrstu', new FakeGithub().fetch))
    await setDay(store, '2026-11-20', 'reis', { travel: { from: ' Nepstad ', to: 'Nepeiland', flight: 'NP 123' }, note: '  ' })
    await setDay(store, '2026-11-20', 'reis', { travel: { from: 'Nepstad', to: 'Nepeiland' } })
    expect(store.list('calendar.json.enc')).toEqual([expect.objectContaining({ id: 'dag:2026-11-20', type: 'reis', travel: { from: 'Nepstad', to: 'Nepeiland' } })])
    await clearDay(store, '2026-11-20')
    expect(store.list('calendar.json.enc')).toEqual([])
    expect(dayInfo(buildIndex(store.get('calendar.json.enc'), [], []), '2026-11-20', TODAY).source).toBe('toekomst')
  })
})
