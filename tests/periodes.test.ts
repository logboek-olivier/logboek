import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildIndex, dayInfo, setDay } from '../src/model/calendar'
import { migratePeriods, migrationChanges, stayId } from '../src/model/migrate-periods'
import { allPeriods, periodAt, planStayDays } from '../src/model/periods'
import { legOutsideCanExtend, reviewInput, reviewItems } from '../src/model/review'
import { tripKind } from '../src/model/trip-kind'
import { startWeek, type WeekInput } from '../src/model/weeks'
import type { CalendarDay, Leg, StayPeriod, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'
import { landperiodeZetten, periodeDatumsWijzigen } from '../src/domain/agenda'
import { dagBeginAansluiten, dagBuitenPeriodeOplossen, geldKoppelen, periodeSoortZetten } from '../src/domain/trips'

// Het periodemodel (docs/PERIODEMODEL.md): soort per trip, periodes aan land (maken, verlengen, korter, splitsen,
// samenvoegen), de eenmalige migratie van agenda en geld, en Nakijken. Alle gegevens verzonnen.

const T = '2026-10-01T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(github = new FakeGithub()) {
  const db = await openLogboekDb(`logboek-periodes-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_PERIODES_0123456789abcdefghijklmnopq', github.fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Neptrip ${id}`, updatedAt: T, deletedAt: null, ...extra })
const leg = (id: string, tripId: string, date: string, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId,
  date,
  fromPlace: 'Nepbaai',
  fromCountry: 'NL',
  toPlace: 'Nepdorp',
  toCountry: 'NL',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 10,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: T,
  deletedAt: null,
  ...extra,
})
const day = (date: string, type: CalendarDay['type'], extra: Partial<CalendarDay> = {}): CalendarDay => ({ id: `dag:${date}`, date, type, updatedAt: T, deletedAt: null, ...extra })
const tx = (id: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date, kind: 'kosten', amount: 10, currency: 'EUR', source: 'overig', updatedAt: T, deletedAt: null, ...extra })
const stay = (id: string, kind: StayPeriod['kind'], startDate: string, endDate: string, extra: Partial<StayPeriod> = {}): StayPeriod => ({ id, kind, startDate, endDate, updatedAt: T, deletedAt: null, ...extra })

describe('soort van een trip', () => {
  it('opgeslagen soort, type, organisatie, rollen en naam; twijfel alleen zonder signaal', () => {
    expect(tripKind(trip('a', { kind: 'plezier' }), [])).toMatchObject({ kind: 'plezier', sure: true })
    expect(tripKind(trip('a', { type: 'zelf-trainen' }), [])).toMatchObject({ kind: 'training', sure: true })
    expect(tripKind(trip('a', { type: 'delivery' }), [])).toMatchObject({ kind: 'werk', type: 'delivery', sure: true })
    expect(tripKind(trip('a', { organisation: 'sailing-virgins' }), [leg('l', 'a', '2026-10-02', { role: 'instructeur' })])).toMatchObject({ kind: 'werk', type: 'training-geven', sure: true })
    expect(tripKind(trip('a', { name: 'Yacht week 7' }), [])).toMatchObject({ kind: 'werk', type: 'skipper-charter', sure: true })
    expect(tripKind(trip('a', { name: 'RYA Offshore prep' }), [])).toMatchObject({ kind: 'training', sure: true })
    expect(tripKind(trip('a'), [leg('l', 'a', '2026-10-02', { role: 'trainee' })])).toMatchObject({ kind: 'training', sure: true })
    // Geen signaal (type overig of niets): een voorstel, niet zeker.
    expect(tripKind(trip('a', { type: 'overig', name: 'Nepboot okt 2026' }), [])).toMatchObject({ kind: 'werk', sure: false })
    expect(tripKind(trip('a', { name: 'Nepboot okt 2026' }), [leg('l', 'a', '2026-10-02', { role: 'bemanningslid' })])).toMatchObject({ kind: 'plezier', sure: false })
  })
})

describe('periodes aan land', () => {
  const none = () => false
  let n = 0
  const id = () => `nieuw-${++n}`

  it('een dag naast een periode van dezelfde soort maakt die langer; tussen twee periodes gaan ze samen', () => {
    const stays = [stay('a', 'thuis', '2026-11-01', '2026-11-03', { note: 'Nepnotitie a' }), stay('b', 'thuis', '2026-11-05', '2026-11-06', { note: 'Nepnotitie b' })]
    const plan = planStayDays(stays, ['2026-11-04'], 'thuis', none, T, id)
    const after = new Map(plan.changes.map((c) => [c.after.id, c.after]))
    expect(after.get('a')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-06', deletedAt: null, note: 'Nepnotitie a\nNepnotitie b' })
    expect(after.get('b')?.deletedAt).not.toBeNull()
  })

  it('een andere soort midden in een periode splitst hem; het tweede stuk krijgt een nieuwe id', () => {
    const plan = planStayDays([stay('a', 'thuis', '2026-11-01', '2026-11-10', { name: 'Nepthuis' })], ['2026-11-05'], 'reis', none, T, () => 'nieuw')
    const list = plan.changes.map((c) => c.after).sort((x, y) => (x.startDate < y.startDate ? -1 : 1))
    expect(list.map((s) => [s.kind, s.startDate, s.endDate])).toEqual([
      ['thuis', '2026-11-01', '2026-11-04'],
      ['reis', '2026-11-05', '2026-11-05'],
      ['thuis', '2026-11-06', '2026-11-10'],
    ])
    expect(list[0]!.id).toBe('a')
    expect(list[2]!.name).toBe('Nepthuis')
  })

  it('dagen weghalen maakt korter of laat de periode verdwijnen; dagen in een trip krijgen nooit een soort aan land', () => {
    const shorter = planStayDays([stay('a', 'vrij', '2026-11-01', '2026-11-03')], ['2026-11-03'], null, none, T, id)
    expect(shorter.changes[0]!.after).toMatchObject({ id: 'a', endDate: '2026-11-02', deletedAt: null })
    const gone = planStayDays([stay('a', 'vrij', '2026-11-01', '2026-11-01')], ['2026-11-01'], null, none, T, id)
    expect(gone.changes[0]!.after.deletedAt).not.toBeNull()
    const water = planStayDays([], ['2026-11-01', '2026-11-02', '2026-11-03'], 'thuis', (d) => d === '2026-11-02', T, () => `w${++n}`)
    expect(water.changes.map((c) => [c.after.startDate, c.after.endDate])).toEqual([
      ['2026-11-01', '2026-11-01'],
      ['2026-11-03', '2026-11-03'],
    ])
  })

  it('een trip over een thuisperiode maakt die korter; geld op die dagen gaat mee naar de trip', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05'], 'thuis')
    const home = s.list('periods.json.enc')[0]!
    await put(s, 'transactions.json.enc', tx('t1', '2027-03-04', { tripId: home.id }))
    await put(s, 'transactions.json.enc', tx('t2', '2027-03-01', { tripId: home.id }))
    const input: WeekInput = { name: 'Nepweek', type: 'skipper-charter', startDate: '2027-03-04', dayCount: 3, boat: '', boatModel: '', boatLengthFt: null, base: '', charter: '', area: '', participants: [], note: '' }
    const created = await inTx(s, startWeek, input, 'nl', '2027-01-01')
    expect(s.list('periods.json.enc').map((p) => [p.startDate, p.endDate])).toEqual([['2027-03-01', '2027-03-03']])
    expect(s.list('transactions.json.enc').find((x) => x.id === 't1')?.tripId).toBe(created.id)
    expect(s.list('transactions.json.enc').find((x) => x.id === 't2')?.tripId).toBe(home.id)
    // De agenda: thuis tot de trip, daarna op het water.
    const index = buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc'), [], s.get('periods.json.enc'))
    expect(dayInfo(index, '2027-03-03', '2027-01-01')).toMatchObject({ type: 'thuis', kind: 'thuis', source: 'periode' })
    expect(dayInfo(index, '2027-03-04', '2027-01-01')).toMatchObject({ type: 'werk', kind: 'werk', source: 'trip' })
  })

  it('ongedaan maken zet periodes en geld terug', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2027-04-01', '2027-04-02'], 'vrij')
    const undo = await landperiodeZetten(s, ['2027-04-03'], 'vrij')
    expect(s.list('periods.json.enc').map((p) => p.endDate)).toEqual(['2027-04-03'])
    await undo()
    expect(s.list('periods.json.enc').map((p) => p.endDate)).toEqual(['2027-04-02'])
  })
})

describe('migratie naar het periodemodel', () => {
  const input = {
    trips: [trip('w', { startDate: '2026-10-10', endDate: '2026-10-16', organisation: 'yacht-week' as const })],
    legs: [leg('l1', 'w', '2026-10-11')],
    calendar: [
      day('2026-10-05', 'thuis'),
      day('2026-10-06', 'thuis', { note: 'Nepnotitie', location: 'Nepstad' }),
      day('2026-10-07', 'thuis'),
      day('2026-10-08', 'reis', { travel: { from: 'Nepstad', to: 'Nephaven', flight: 'NP 1' } }),
      day('2026-10-09', 'reis', { travel: { from: 'Nephaven', to: 'Nepbaai' } }),
      // Rust binnen de trip: blijft staan (Nakijken), wordt geen periode.
      day('2026-10-12', 'rust'),
      day('2026-10-20', 'rust'),
      day('2026-10-22', 'onbeschikbaar', { reason: 'Nepreden' }),
    ],
    transactions: [
      tx('in-trip', '2026-10-12'),
      tx('thuis', '2026-10-05'),
      tx('vrij', '2026-10-20'),
      tx('loon-thuis', '2026-10-05', { kind: 'loon' }),
      tx('niets', '2026-10-30'),
      tx('al-gekoppeld', '2026-10-05', { tripId: 'w' }),
      tx('declaratie', '2026-10-05', { claimId: 'c1' }),
    ],
    stays: [],
  }

  it('agendadagen worden aaneengesloten periodes, geld komt aan de periode van zijn datum (eerst rood: zonder migratie geen periodes)', () => {
    const changes = migrationChanges(input, T)
    const stays = changes.filter((c) => c.path === 'periods.json.enc').map((c) => c.after as StayPeriod)
    expect(stays.map((p) => [p.id, p.kind, p.startDate, p.endDate])).toEqual([
      [stayId('thuis', '2026-10-05'), 'thuis', '2026-10-05', '2026-10-07'],
      [stayId('reis', '2026-10-08'), 'reis', '2026-10-08', '2026-10-09'],
      [stayId('vrij', '2026-10-20'), 'vrij', '2026-10-20', '2026-10-20'],
    ])
    expect(stays[1]!.travel).toEqual({ from: 'Nepstad', to: 'Nepbaai', by: 'vliegtuig' })
    // Dagen zonder eigen gegevens vervallen (tombstone met inhoud); met gegevens blijven ze staan.
    const days = changes.filter((c) => c.path === 'calendar.json.enc').map((c) => c.after as CalendarDay)
    expect(days.map((d) => d.date).sort()).toEqual(['2026-10-05', '2026-10-07', '2026-10-20'])
    expect(days.every((d) => d.deletedAt !== null && d.type)).toBe(true)
    const linked = new Map(changes.filter((c) => c.path === 'transactions.json.enc').map((c) => [c.after.id, (c.after as Transaction).tripId]))
    // Alleen uitgaven op een dag aan land; op een tripdatum en bij inkomsten niets vanzelf (dat staat in Nakijken).
    expect(Object.fromEntries(linked)).toEqual({ thuis: stayId('thuis', '2026-10-05'), vrij: stayId('vrij', '2026-10-20') })
  })

  it('twee apparaten maken hetzelfde; een tweede keer verandert niets', () => {
    const first = migrationChanges(input, T)
    const second = migrationChanges(input, '2026-10-02T10:00:00.000Z')
    expect(second.map((c) => c.after.id)).toEqual(first.map((c) => c.after.id))
    const stays = first.filter((c) => c.path === 'periods.json.enc').map((c) => c.after as StayPeriod)
    const again = migrationChanges({ ...input, stays }, T).filter((c) => c.path === 'periods.json.enc')
    expect(again).toEqual([])
  })

  it('draait pas na een geslaagde sync, één keer, en de agenda toont daarna hetzelfde als ervoor', async () => {
    const s = await store()
    await putMany(s, 'calendar.json.enc', input.calendar)
    await putMany(s, 'trips.json.enc', input.trips)
    await putMany(s, 'legs.json.enc', input.legs)
    await putMany(s, 'transactions.json.enc', input.transactions)
    const index = () => buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc'), [], s.get('periods.json.enc'))
    const types = (dates: string[]) => dates.map((d) => dayInfo(index(), d, '2026-10-25').type)
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-20', '2026-10-22']
    const before = types(dates)
    expect(await inTx(s, migratePeriods)).toBe(false)
    await s.sync()
    expect(await inTx(s, migratePeriods)).toBe(true)
    expect(types(dates)).toEqual(before)
    expect(s.list('periods.json.enc')).toHaveLength(3)
    expect(await inTx(s, migratePeriods)).toBe(false)
  })
})

describe('Nakijken', () => {
  it('dag buiten zijn trip (oorzaak van SV #1 met een dag op 28 oktober): naar de trip van die datum', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('sv1', { startDate: '2026-10-18', endDate: '2026-10-24', type: 'training-geven', organisation: 'sailing-virgins' }), trip('sv2', { startDate: '2026-10-26', endDate: '2026-10-31', type: 'training-geven', organisation: 'sailing-virgins' })])
    await putMany(s, 'legs.json.enc', [leg('in', 'sv1', '2026-10-19'), leg('uit', 'sv1', '2026-10-28')])
    const items = reviewItems(reviewInput(s))
    const outside = items.find((i) => i.kind === 'dag-buiten')
    expect(outside).toMatchObject({ leg: { id: 'uit' }, trip: { id: 'sv1' }, target: { id: 'sv2' } })
    if (outside?.kind !== 'dag-buiten') throw new Error('verwacht')
    const undo = await dagBuitenPeriodeOplossen(s, outside.leg, outside.trip, outside.target)
    expect(s.list('legs.json.enc').find((l) => l.id === 'uit')?.tripId).toBe('sv2')
    expect(reviewItems(reviewInput(s)).some((i) => i.kind === 'dag-buiten')).toBe(false)
    await undo()
    expect(s.list('legs.json.enc').find((l) => l.id === 'uit')?.tripId).toBe('sv1')
  })

  it('soort onzeker, werk zonder organisatie (voorstel uit de source), geld zonder periode, plaatsen die niet aansluiten', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('oud', { name: 'Nepboot mei 2024', startDate: '2024-05-01', endDate: '2024-05-03' }), trip('werk', { name: 'Nepcharter', type: 'skipper-charter', startDate: '2026-09-01', endDate: '2026-09-03' })])
    await putMany(s, 'legs.json.enc', [
      leg('a', 'werk', '2026-09-01', { fromPlace: 'Nephaven', toPlace: 'Nepstadje' }),
      leg('b', 'werk', '2026-09-02', { fromPlace: 'Nep Eiland', toPlace: 'Nepbaai' }),
    ])
    await put(s, 'places.json.enc', { id: 'p', name: 'Nepstadje', lat: 17.9, lon: -62.85, updatedAt: T, deletedAt: null })
    await putMany(s, 'transactions.json.enc', [tx('fooi', '2026-09-02', { kind: 'fooi', source: 'yacht-week', tripId: 'werk' }), tx('los', '2026-08-15')])
    const items = reviewItems(reviewInput(s))
    expect(items.find((i) => i.kind === 'soort')).toMatchObject({ trip: { id: 'oud' } })
    expect(items.find((i) => i.kind === 'organisatie')).toMatchObject({ trip: { id: 'werk' }, suggestion: 'yacht-week' })
    expect(items.find((i) => i.kind === 'geld-zonder-periode')).toMatchObject({ tx: { id: 'los' }, target: null })
    const join = items.find((i) => i.kind === 'aansluiting')
    expect(join).toMatchObject({ leg: { id: 'b' }, from: { name: 'Nep Eiland' }, into: { name: 'Nepstadje' } })
    // De eerste fix verandert alleen de van van die ene dag.
    if (join?.kind !== 'aansluiting') throw new Error('verwacht')
    await dagBeginAansluiten(s, join.leg, join.previous)
    expect(s.list('legs.json.enc').find((l) => l.id === 'b')?.fromPlace).toBe('Nepstadje')
    const soort = items.find((i) => i.kind === 'soort')!
    if (soort.kind !== 'soort') throw new Error('verwacht')
    await periodeSoortZetten(s, soort.trip, 'zelf-cruisen')
    expect(s.list('trips.json.enc').find((x) => x.id === 'oud')).toMatchObject({ kind: 'plezier', type: 'zelf-cruisen' })
    const geld = items.find((i) => i.kind === 'geld-zonder-periode')!
    if (geld.kind !== 'geld-zonder-periode') throw new Error('verwacht')
    await geldKoppelen(s, geld.tx, geld.target)
    const home = s.list('periods.json.enc')[0]!
    expect(home).toMatchObject({ kind: 'thuis', startDate: '2026-08-15', endDate: '2026-08-15' })
    expect(s.list('transactions.json.enc').find((x) => x.id === 'los')?.tripId).toBe(home.id)
    const left = reviewItems(reviewInput(s)).map((i) => i.kind)
    expect(left).not.toContain('soort')
    expect(left).not.toContain('geld-zonder-periode')
  })

  it('periode van een datum: water gaat voor land', () => {
    const periods = allPeriods([trip('w', { startDate: '2026-12-01', endDate: '2026-12-03' })], [], [stay('s', 'thuis', '2026-11-25', '2026-12-02')])
    expect(periodAt(periods, '2026-12-02')?.id).toBe('w')
    expect(periodAt(periods, '2026-11-30')?.id).toBe('s')
  })

  it('een agendadag binnen een trip staat in Nakijken; de trip gaat voor in de agenda', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('w', { type: 'skipper-charter', organisation: 'yacht-week', startDate: '2027-02-01', endDate: '2027-02-05' }))
    await inTx(s, setDay, '2027-02-03', 'rust')
    const index = buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc'))
    expect(dayInfo(index, '2027-02-03', '2027-01-01').type).toBe('werk')
    expect(reviewItems(reviewInput(s)).find((i) => i.kind === 'agendadag-in-trip')).toMatchObject({ day: { date: '2027-02-03' } })
  })

  it('een dag ver buiten zijn trip verlengt de trip niet met één tik (de datum is dan vast fout)', () => {
    const w = trip('w', { startDate: '2026-10-18', endDate: '2026-10-24' })
    expect(legOutsideCanExtend(leg('a', 'w', '2026-10-26'), w)).toBe(true)
    expect(legOutsideCanExtend(leg('a', 'w', '2026-11-26'), w)).toBe(false)
  })

  it('een dagtoestand binnen een periode aan land staat in Nakijken', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2027-05-01', '2027-05-02', '2027-05-03'], 'thuis')
    await put(s, 'calendar.json.enc', day('2027-05-02', 'onbeschikbaar', { reason: 'Nepreden' }))
    expect(reviewItems(reviewInput(s)).find((i) => i.kind === 'agendadag-in-periode')).toMatchObject({ day: { date: '2027-05-02' } })
  })
})

describe('reviewpunten periodes', () => {
  it('verlengen ongedaan maken zet ook de periode aan land en het geld terug', async () => {
    const { tripRange } = await import('../src/model/calendar')
    const { weekView } = await import('../src/model/weeks')
    const s = await store()
    await put(s, 'trips.json.enc', trip('w', { type: 'skipper-charter', startDate: '2027-06-01', endDate: '2027-06-05' }))
    await landperiodeZetten(s, ['2027-06-06', '2027-06-07', '2027-06-08', '2027-06-09', '2027-06-10'], 'thuis')
    const home = s.list('periods.json.enc')[0]!
    await put(s, 'transactions.json.enc', tx('t', '2027-06-06', { tripId: home.id }))
    const view = weekView(s.list('trips.json.enc')[0]!, [])
    const undo = await periodeDatumsWijzigen(s, { view, start: '2027-06-01', end: '2027-06-06' })
    expect(s.list('periods.json.enc')[0]).toMatchObject({ startDate: '2027-06-07' })
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe('w')
    await undo()
    expect(s.list('periods.json.enc')[0]).toMatchObject({ startDate: '2027-06-06', endDate: '2027-06-10' })
    expect(s.list('transactions.json.enc')[0]!.tripId).toBe(home.id)
    expect(tripRange(s.list('trips.json.enc')[0]!, [])).toEqual({ start: '2027-06-01', end: '2027-06-05' })
  })

  it('een inkomen gaat niet vanzelf naar een trip als die over de thuisperiode komt', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2027-07-01', '2027-07-02'], 'thuis')
    const home = s.list('periods.json.enc')[0]!
    await put(s, 'transactions.json.enc', tx('loon', '2027-07-02', { kind: 'loon', tripId: home.id }))
    await put(s, 'trips.json.enc', trip('w', { type: 'skipper-charter', startDate: '2027-07-02', endDate: '2027-07-04' }))
    await landperiodeZetten(s, ['2027-07-02'], null)
    expect(s.list('transactions.json.enc')[0]!.tripId).toBeUndefined()
  })

  it('overlappende periodes aan land: geld van de opgegane periode gaat mee', () => {
    const plan = planStayDays([stay('a', 'thuis', '2026-11-01', '2026-11-10'), stay('b', 'vrij', '2026-11-05', '2026-11-07')], ['2026-11-06'], 'reis', () => false, T, () => 'nieuw')
    expect(plan.previous.get('2026-11-06')).toEqual(new Set(['a', 'b']))
    expect(plan.changes.find((c) => c.after.id === 'b')?.after.deletedAt).not.toBeNull()
  })

  it('een opgeslagen soort die het type tegenspreekt (een oudere versie wijzigde het type): het type geldt', () => {
    expect(tripKind(trip('a', { kind: 'werk', type: 'zelf-cruisen' }), [])).toMatchObject({ kind: 'plezier', sure: true })
  })
})

