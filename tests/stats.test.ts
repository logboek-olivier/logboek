import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/model/calendar'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import { instructorStats, moneyStats, periodFor, ryaYachtmasterOffshore, sailingStats, seasonStart, workStats } from '../src/model/stats'
import type { CalendarDay, Curriculum, Leg, Student, Transaction, Trip } from '../src/model/types'

// PR F: statistieken. Zeilen, RYA Yachtmaster Offshore, werk, geld en instructeur over een periode. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, name: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name, startDate, endDate, updatedAt: T0, deletedAt: null, ...extra })
const leg = (id: string, tripId: string, date: string, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nephaven',
  fromCountry: '',
  toPlace: 'Nepdorp',
  toCountry: '',
  role: 'schipper',
  boat: 'Nepboot (Lagoon 42)',
  nmInland: 0,
  nmSea: 10,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: T0,
  deletedAt: null,
  ...extra,
})
const tx = (id: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({ id, date, kind: 'fooi', amount, currency: 'EUR', source: 'yacht-week', updatedAt: T0, deletedAt: null, ...extra })
const day = (date: string, type: CalendarDay['type']): CalendarDay => ({ id: `dag:${date}`, date, type, updatedAt: T0, deletedAt: null })

describe('Periode', () => {
  const trips = [trip('oud', 'Oud', '2026-01-10', '2026-01-16'), trip('a', 'A', '2026-05-01', '2026-05-07'), trip('b', 'B', '2026-05-20', '2026-05-26'), trip('c', 'C', '2026-06-10', '2026-06-16'), trip('later', 'Later', '2026-12-01', '2026-12-07')]

  it('dit seizoen begint na de laatste pauze van minstens vier weken', () => {
    expect(seasonStart(trips, [], '2026-07-01')).toBe('2026-05-01')
    // Een geplande trip na vandaag telt niet mee.
    expect(seasonStart(trips, [], '2026-11-01')).toBe('2026-05-01')
    expect(seasonStart([], [], '2026-11-01')).toBeNull()
  })

  it('dit jaar, dit seizoen, alles (vanaf de eerste dag met gegevens) en een eigen periode', () => {
    const data = { trips, legs: [leg('l', 'oud', '2025-03-04')], calendar: [] }
    expect(periodFor('jaar', '2026-07-01', data)).toEqual({ from: '2026-01-01', to: '2026-07-01' })
    expect(periodFor('seizoen', '2026-07-01', data)).toEqual({ from: '2026-05-01', to: '2026-07-01' })
    expect(periodFor('alles', '2026-07-01', data)).toEqual({ from: '2025-03-04', to: '2026-07-01' })
    expect(periodFor('eigen', '2026-07-01', data, { from: '2026-02-01', to: '2026-02-28' })).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodFor('eigen', '2026-07-01', data, { from: '2026-03-01', to: '2026-02-28' })).toBeNull()
    expect(periodFor('eigen', '2026-07-01', data, { from: '', to: '2026-02-28' })).toBeNull()
  })
})

describe('Zeilen', () => {
  const trips = [
    trip('yw', 'Yacht week Nep', '2026-06-01', '2026-06-03', { area: 'Nepgebied', boat: 'Nepcat', boatModel: 'Lagoon 42', boatKind: 'catamaran' }),
    trip('sv', 'Nepcursus', '2026-07-01', '2026-07-02', { organisation: 'sailing-virgins', area: 'Nepzee' }),
  ]
  const legs = [
    leg('1', 'yw', '2026-06-01', { nmSea: 20, toPlace: 'Tiha bay' }),
    leg('2', 'yw', '2026-06-02', { nmTidal: 5, nmSea: 70, nightHours: 3, role: 'co-schipper', toPlace: 'Tihabay', fromPlace: 'Nepdorp' }),
    leg('3', 'sv', '2026-07-01', { nmInland: 4, nmSea: 0, boat: 'Nepeenromp (Nepmodel 38)', role: 'instructeur' }),
    leg('weg', 'sv', '2026-07-02', { deletedAt: T0 }),
    leg('buiten', 'sv', '2025-07-02'),
  ]
  const s = sailingStats(trips, legs, { ...DEFAULT_SETTINGS, orgFirst: { 'yacht-week': 10 } }, { from: '2026-01-01', to: '2026-12-31' })

  it('totalen, per rol en per watertype, alleen dagen in de periode', () => {
    expect(s).toMatchObject({ nm: 99, days: 3, trips: 2, nightHours: 3 })
    expect(s.byRole).toMatchObject({ schipper: 20, 'co-schipper': 75, instructeur: 4 })
    expect(s.byWater).toEqual({ inland: 4, sea: 90, tidal: 5 })
  })

  it('per boot, boottype en gebied; langste dagtocht; meest bezochte plaats (spelling samen)', () => {
    expect(s.byBoat.map((r) => [r.label, r.value])).toEqual([
      ['Nepcat', 95],
      ['Nepeenromp', 4],
    ])
    expect(s.byKind.map((r) => [r.key, r.value])).toEqual([
      ['catamaran', 95],
      ['onbekend', 4],
    ])
    expect(s.byArea.map((r) => [r.label, r.value])).toEqual([
      ['Nepgebied', 95],
      ['Nepzee', 4],
    ])
    expect(s.longest?.id).toBe('2')
    expect(s.topPlaces[0]).toMatchObject({ value: 2 })
    expect(['Tiha bay', 'Tihabay']).toContain(s.topPlaces[0]!.label)
  })

  it('nm per maand, of per jaar als de periode langer is dan twee jaar; trips per organisatie met de teller', () => {
    expect(s.byYear).toBe(false)
    // Alle maanden van de periode, ook zonder dagen.
    expect(s.perMonth.length).toBe(12)
    expect(s.perMonth.filter((b) => b.value > 0).map((b) => [b.key, b.value])).toEqual([
      ['2026-06', 95],
      ['2026-07', 4],
    ])
    expect(s.perOrganisation).toEqual([
      { org: 'sailing-virgins', trips: 1, last: 'SV #1' },
      { org: 'yacht-week', trips: 1, last: 'YW #10' },
    ])
    const long = sailingStats(trips, legs, DEFAULT_SETTINGS, { from: '2023-01-01', to: '2026-12-31' })
    expect(long.byYear).toBe(true)
    expect(long.perMonth.map((b) => [b.key, b.value])).toEqual([
      ['2023', 0],
      ['2024', 0],
      ['2025', 10],
      ['2026', 99],
    ])
  })
})

describe('RYA Yachtmaster Offshore', () => {
  it('dagen en mijlen op zee, schipper, passages van meer dan 60 nm, getijdenwater', () => {
    const legs = [
      leg('a', 't', '2026-01-01', { nmSea: 61, nightHours: 4 }),
      leg('b', 't', '2026-01-02', { nmSea: 30, nmTidal: 40, role: 'bemanningslid' }),
      leg('c', 't', '2026-01-03', { nmSea: 0, nmInland: 80 }),
    ]
    const items = Object.fromEntries(ryaYachtmasterOffshore(legs).map((i) => [i.id, i]))
    expect(items.dagen).toMatchObject({ value: 2, target: 50, done: false })
    expect(items.mijlen).toMatchObject({ value: 131, target: 2500 })
    expect(items.schipper).toMatchObject({ value: 1, target: 5 })
    expect(items.passages).toMatchObject({ value: 2, target: 5 })
    expect(items.nacht).toMatchObject({ value: 1, target: 2 })
    expect(items.passagesSchipper).toMatchObject({ value: 1, target: 2 })
    expect(items.getij).toMatchObject({ value: 31, target: 50, done: false })
    expect(ryaYachtmasterOffshore([]).every((i) => i.value === 0)).toBe(true)
  })
})

describe('Werk', () => {
  it('werk-, rust-, reis- en thuisdagen per maand; aandeel werkdagen', () => {
    const trips = [trip('a', 'A', '2026-03-02', '2026-03-06')]
    const index = buildIndex([day('2026-03-07', 'rust'), day('2026-03-08', 'reis'), day('2026-04-01', 'thuis')], trips, [])
    const w = workStats(index, { from: '2026-03-01', to: '2026-04-10' }, '2026-04-10')
    expect(w).toMatchObject({ werk: 5, rust: 1, reis: 1, thuis: 1, onbeschikbaar: 0, days: 41 })
    expect(w.share).toBeCloseTo(5 / 41)
    expect(w.months.map((m) => [m.month, m.werk, m.days])).toEqual([
      ['2026-03', 5, 31],
      ['2026-04', 0, 10],
    ])
  })
})

describe('Onbeschikbaar', () => {
  it('telt apart, niet als werk; het aandeel werk blijft gelijk', () => {
    const index = buildIndex([day('2026-03-10', 'onbeschikbaar'), day('2026-03-11', 'onbeschikbaar'), day('2026-04-02', 'onbeschikbaar')], [trip('a', 'A', '2026-03-02', '2026-03-06')], [])
    const w = workStats(index, { from: '2026-03-01', to: '2026-04-10' }, '2026-04-10')
    expect(w).toMatchObject({ werk: 5, onbeschikbaar: 3 })
    expect(w.share).toBeCloseTo(5 / 41)
    expect(w.months.map((m) => [m.month, m.onbeschikbaar])).toEqual([
      ['2026-03', 2],
      ['2026-04', 1],
    ])
  })
})

describe('Geld', () => {
  it('verdiend per trip en organisatie, per werkdag, beste en slechtste per dag', () => {
    const trips = [trip('kort', 'Kort', '2026-03-02', '2026-03-03', { organisation: 'yacht-week' }), trip('lang', 'Sailing Virgins lang', '2026-04-01', '2026-04-10')]
    const transactions = [
      tx('1', '2026-03-02', 300, { tripId: 'kort' }),
      tx('2', '2026-04-05', 500, { tripId: 'lang', kind: 'loon' }),
      tx('3', '2026-04-06', 80, { tripId: 'lang', kind: 'terugbetaling' }),
      tx('4', '2026-04-07', 40, { kind: 'kosten' }),
      tx('5', '2026-05-01', 25, { kind: 'overig-inkomen' }),
      tx('buiten', '2025-05-01', 999, { tripId: 'kort' }),
    ]
    const index = buildIndex([], trips, [])
    const m = moneyStats(trips, [], transactions, index, { from: '2026-01-01', to: '2026-12-31' }, '2026-12-31')
    expect(m.earned).toBe(825)
    expect(m.perTrip.map((t) => [t.trip.id, t.eur, t.days, t.perDay])).toEqual([
      ['lang', 500, 10, 50],
      ['kort', 300, 2, 150],
    ])
    expect(m.perOrganisation).toEqual([
      { org: 'sailing-virgins', eur: 500 },
      { org: 'yacht-week', eur: 300 },
    ])
    expect(m.withoutTrip).toBe(25)
    expect(m.workdays).toBe(12)
    expect(m.perWorkday).toBe(68.75)
    expect(m.best?.trip.id).toBe('kort')
    expect(m.worst?.trip.id).toBe('lang')
    expect(m.tipsPerWeek.length).toBe(26)
  })

  it('beste en slechtste pas vanaf twee trips', () => {
    const trips = [trip('a', 'A', '2026-03-02', '2026-03-03')]
    const m = moneyStats(trips, [], [tx('1', '2026-03-02', 10, { tripId: 'a' })], buildIndex([], trips, []), { from: '2026-03-01', to: '2026-03-31' }, '2026-03-31')
    expect(m.best).toBeNull()
    expect(m.worst).toBeNull()
    expect(m.tipsPerWeek.length).toBeLessThanOrEqual(6)
  })
})

describe('Instructeur', () => {
  const course: Curriculum = {
    id: 'nep-cursus',
    body: 'eigen',
    courseCode: '',
    name: { nl: 'Nepcursus', en: 'Fake course' },
    groups: [{ id: 'g', title: { nl: 'Deel', en: 'Part' }, topics: [{ id: 'knoop', title: { nl: 'Nepknoop', en: 'Fake knot' }, kind: 'praktijk', examCritical: true }, { id: 'kaart', title: { nl: 'Nepkaart', en: 'Fake chart' }, kind: 'theorie', examCritical: false }] }],
    source: 'eigen',
    updatedAt: T0,
    deletedAt: null,
  }
  const student = (id: string, extra: Partial<Student>): Student => ({ id, firstName: 'Nep', curriculumId: 'nep-cursus', level: 'beginner', progress: {}, updatedAt: T0, deletedAt: null, ...extra })
  const P = (status: 'geoefend' | 'beheerst' | 'nieuw', updatedAt: string) => ({ status, updatedAt })

  it('studenten in de periode, slagingspercentage per cursus, meest geoefende onderwerpen', () => {
    const students = [
      student('a', { startedAt: '2026-03-01', exam: { date: '2026-03-07', passed: true }, progress: { knoop: P('beheerst', '2026-03-05T10:00:00.000Z'), kaart: P('geoefend', '2026-03-04T10:00:00.000Z') } }),
      student('b', { startedAt: '2026-03-01', exam: { date: '2026-03-07', passed: false }, progress: { knoop: P('geoefend', '2026-03-05T10:00:00.000Z') } }),
      student('oud', { startedAt: '2025-03-01', progress: { knoop: P('geoefend', '2025-03-05T10:00:00.000Z') } }),
      student('gewist', { deletedAt: T0, startedAt: '2026-03-01' }),
    ]
    const s = instructorStats(students, [course], [], [], { from: '2026-01-01', to: '2026-12-31' }, 'nl')
    expect(s.students).toBe(2)
    expect(s.perCourse).toEqual([{ curriculumId: 'nep-cursus', label: 'Nepcursus', students: 2, exams: 2, passed: 1, rate: 0.5 }])
    expect(s.topTopics.map((r) => [r.label, r.value])).toEqual([
      ['Nepknoop', 2],
      ['Nepkaart', 1],
    ])
  })
})
