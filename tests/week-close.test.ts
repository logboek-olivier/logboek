import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildIndex } from '../src/model/calendar'
import { deleteWeekClosing } from '../src/model/edit'
import type { CalendarDay, Leg, Student, Trip, WeekClosing } from '../src/model/types'
import { canClose, cleanClosing, closingFor, mondayOf, saveClosing, sundayOf, weekClosingId, weekKey, weekSummary, weekToClose } from '../src/model/week-close'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Weekafsluiting: samenvatting van maandag tot en met zondag uit dagen, agenda en studenten; opgeslagen alleen cijfer en
// zin, één record per ISO-week. Alle gegevens verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
let counter = 0
let masterKey: CryptoKey

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function newStore() {
  return Store.open(await openLogboekDb(`logboek-week-close-${++counter}`), masterKey, new GithubClient('github_pat_WEEK_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
}

const leg = (id: string, date: string, to: string, nm: number, night = 0): Leg => ({
  id,
  tripId: 'trip-1',
  date,
  fromPlace: 'Nephaven',
  fromCountry: 'NL',
  toPlace: to,
  toCountry: 'NL',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: nm,
  nmTidal: 0,
  nightHours: night,
  dateEstimated: false,
  source: 'manual',
  updatedAt: NOW,
  deletedAt: null,
})
const closing = (date: string, extra: Partial<WeekClosing> = {}): WeekClosing => ({ id: weekClosingId(date), week: weekKey(date), start: mondayOf(date), updatedAt: NOW, deletedAt: null, ...extra })

describe('weken', () => {
  it('maandag, zondag en ISO-week, ook rond de jaarwisseling', () => {
    // Donderdag 29 oktober 2026 valt in week 44.
    expect(mondayOf('2026-10-29')).toBe('2026-10-26')
    expect(sundayOf('2026-10-29')).toBe('2026-11-01')
    expect(mondayOf('2026-10-26')).toBe('2026-10-26')
    expect(weekKey('2026-11-01')).toBe('2026-W44')
    // 2026 heeft 53 weken; 1 januari 2027 (vrijdag) hoort nog bij week 53 van 2026.
    expect(weekKey('2027-01-01')).toBe('2026-W53')
    expect(weekKey('2027-01-04')).toBe('2027-W01')
    // 29 december 2025 (maandag) hoort bij week 1 van 2026.
    expect(weekKey('2025-12-29')).toBe('2026-W01')
    expect(weekClosingId('2026-10-29')).toBe('week:2026-W44')
  })

  it('Vandaag vraagt op zondag de week van vandaag en op maandag die van gisteren, zolang hij niet is afgesloten', () => {
    expect(weekToClose('2026-11-01', [])).toBe('2026-11-01')
    expect(weekToClose('2026-11-02', [])).toBe('2026-11-01')
    expect(weekToClose('2026-11-03', [])).toBeNull()
    expect(weekToClose('2026-10-31', [])).toBeNull()
    expect(weekToClose('2026-11-01', [closing('2026-11-01', { rating: 7 })])).toBeNull()
    expect(weekToClose('2026-11-02', [closing('2026-11-01', { lesson: 'Nepzin' })])).toBeNull()
    // Een lege afsluiting (alleen de geldstap) telt als afgesloten; een verwijderde niet.
    expect(weekToClose('2026-11-01', [closing('2026-11-01')])).toBeNull()
    expect(weekToClose('2026-11-01', [closing('2026-11-01', { rating: 7, deletedAt: NOW })])).toBe('2026-11-01')
  })

  it('een week is af te sluiten zodra de maandag geweest is', () => {
    expect(canClose('2026-11-01', '2026-10-26')).toBe(true)
    expect(canClose('2026-11-01', '2026-10-25')).toBe(false)
    expect(canClose('2026-10-25', '2026-11-10')).toBe(true)
  })

  it('cijfer 1–10 en een zin van hoogstens 200 tekens; de rest valt weg', () => {
    expect(cleanClosing({ rating: 7, lesson: '  Nepzin  ' })).toEqual({ rating: 7, lesson: 'Nepzin' })
    expect(cleanClosing({ rating: 0, lesson: '' })).toEqual({})
    expect(cleanClosing({ rating: 11, lesson: ' ' })).toEqual({})
    expect(cleanClosing({ rating: 7.5, lesson: 'x'.repeat(300) }).lesson).toHaveLength(200)
    expect(closingFor([closing('2026-10-30', { rating: 6 })], '2026-11-01')?.rating).toBe(6)
    expect(closingFor([closing('2026-10-30', { rating: 6 })], '2026-11-02')).toBeNull()
    // Alleen "los uitgegeven", of alleen de geldstap (een lege afsluiting): ook afgesloten, zodat de kaart weg is.
    expect(closingFor([closing('2026-10-30', { spent: { amount: 40, currency: 'EUR' } })], '2026-11-01')).not.toBeNull()
    expect(weekToClose('2026-11-01', [closing('2026-10-30', { spent: { amount: 40, currency: 'EUR' } })])).toBeNull()
    expect(closingFor([{ ...closing('2026-10-30', { rating: 6 }), deletedAt: NOW }], '2026-11-01')).toBeNull()
  })
})

describe('samenvatting', () => {
  it('dagen op het water, nm, nachturen, dagsoorten, trips, plaatsen en examens van maandag tot en met zondag', () => {
    const trips: Trip[] = [{ id: 'trip-1', name: 'Nepweek', startDate: '2026-10-28', endDate: '2026-11-03', updatedAt: NOW, deletedAt: null }]
    const legs = [leg('l1', '2026-10-28', 'Nepdorp', 12.5), leg('l2', '2026-10-28', 'Nepbaai', 3), leg('l3', '2026-10-30', 'nepdorp ', 20, 4), leg('later', '2026-11-02', 'Nepeiland', 30)]
    const calendar: CalendarDay[] = [
      { id: 'dag:2026-10-26', date: '2026-10-26', type: 'reis', updatedAt: NOW, deletedAt: null },
      { id: 'dag:2026-10-27', date: '2026-10-27', type: 'rust', updatedAt: NOW, deletedAt: null },
    ]
    const students: Student[] = [
      { id: 's1', firstName: 'Nepanna', curriculumId: 'c', level: 'beginner', progress: {}, exam: { date: '2026-11-01', passed: true }, updatedAt: NOW, deletedAt: null },
      { id: 's2', firstName: 'Nepbo', curriculumId: 'c', level: 'beginner', progress: {}, exam: { date: '2026-10-31', passed: false }, updatedAt: NOW, deletedAt: null },
      { id: 's3', firstName: 'Nepcor', curriculumId: 'c', level: 'beginner', progress: {}, exam: { date: '2026-11-02', passed: true }, updatedAt: NOW, deletedAt: null },
    ]
    const summary = weekSummary(buildIndex(calendar, trips, legs), students, '2026-10-29', '2026-11-01')
    expect(summary).toMatchObject({ start: '2026-10-26', end: '2026-11-01', sailingDays: 2, nm: 35.5, nightHours: 4, trips: ['Nepweek'], werk: 5, rust: 1, reis: 1, places: 2, exams: 2, passed: 1 })
  })
})

describe('opslaan', () => {
  it('één record per week: opnieuw opslaan werkt hem bij, een leeg cijfer valt weg; verwijderen met ongedaan maken', async () => {
    const store = await newStore()
    await saveClosing(store, '2026-10-29', { rating: 8, lesson: 'Nepzin' })
    expect(store.list('weekreviews.json.enc')).toEqual([expect.objectContaining({ id: 'week:2026-W44', week: '2026-W44', start: '2026-10-26', rating: 8, lesson: 'Nepzin', deletedAt: null })])
    await saveClosing(store, '2026-11-01', { rating: null, lesson: 'Andere nepzin' })
    const [record] = store.list('weekreviews.json.enc')
    expect(record).toMatchObject({ id: 'week:2026-W44', lesson: 'Andere nepzin' })
    expect(record).not.toHaveProperty('rating')
    const undo = await deleteWeekClosing(store, record!)
    expect(closingFor(store.list('weekreviews.json.enc'), '2026-10-29')).toBeNull()
    await undo()
    expect(closingFor(store.list('weekreviews.json.enc'), '2026-10-29')?.lesson).toBe('Andere nepzin')
  })
})
