import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildIndex, dayInfo, extendOptions, incomePerWorkday, monthIncome, setDay } from '../src/model/calendar'
import { startWeek, type WeekInput } from '../src/model/weeks'
import type { Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx } from './helpers/schrijf'
import { periodeDatumsWijzigen } from '../src/domain/agenda'
import { periodeBewerken } from '../src/domain/trips'

// Koppelingen tussen trips en de agenda: een trip maken, verlengen of verplaatsen werkt de agenda bij, en andersom
// (werk naast een trip verlengt hem, een andere dagsoort op de eerste of laatste dag maakt hem korter). Geld per
// werkdag. Alle gegevens verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store() {
  const db = await openLogboekDb(`logboek-trip-agenda-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_TRIPAGENDA_0123456789abcdefghijklmno', new FakeGithub().fetch))
}

const input = (startDate: string, dayCount: number, extra: Partial<WeekInput> = {}): WeekInput => ({
  name: 'Nepweek',
  type: 'skipper-charter',
  startDate,
  dayCount,
  boat: 'Nepboot',
  boatModel: '',
  boatLengthFt: null,
  base: '',
  charter: '',
  area: '',
  participants: [],
  note: '',
  ...extra,
})

const own = (s: Store) => new Map(s.list('calendar.json.enc').map((d) => [d.date, d]))
const index = (s: Store) => buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc'))
const type = (s: Store, date: string) => dayInfo(index(s), date, '2027-01-01').type

describe('trip → agenda', () => {
  it('een trip maken of verplaatsen verandert de eigen agendadagen niet; de agenda toont de trip op zijn dagen', async () => {
    const s = await store()
    await inTx(s, setDay, '2027-03-05', 'beschikbaar')
    await inTx(s, setDay, '2027-03-06', 'optie')
    await inTx(s, setDay, '2027-03-12', 'rust')
    const trip = await inTx(s, startWeek, input('2027-03-06', 3), 'nl', '2027-01-01')
    expect([...own(s).keys()].sort()).toEqual(['2027-03-05', '2027-03-06', '2027-03-12'])
    for (const d of ['2027-03-06', '2027-03-07', '2027-03-08']) expect(type(s, d)).toBe('werk')
    await periodeBewerken(s, trip, input('2027-03-09', 4), 'nl')
    expect([...own(s).keys()].sort()).toEqual(['2027-03-05', '2027-03-06', '2027-03-12'])
    expect(type(s, '2027-03-06')).toBe('optie')
    for (const d of ['2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12']) expect(type(s, d)).toBe('werk')
  })

})

describe('agenda → trip', () => {
  const base = (s: Store) => s.list('trips.json.enc')[0]!

  it('werk vlak na of vóór een trip biedt verlengen; ongedaan maken zet alles terug', async () => {
    const s = await store()
    await inTx(s, startWeek, input('2027-03-06', 8), 'nl', '2027-01-01') // 6–13 maart
    await inTx(s, setDay, '2027-03-14', 'rust')
    await inTx(s, setDay, '2027-03-15', 'werk')
    const options = extendOptions(index(s), '2027-03-15', '2027-03-15')
    expect(options.map((o) => [o.start, o.end])).toEqual([['2027-03-06', '2027-03-15']])
    expect(extendOptions(index(s), '2027-03-20', '2027-03-20')).toEqual([])
    expect(extendOptions(index(s), '2027-03-03', '2027-03-04').map((o) => [o.start, o.end])).toEqual([['2027-03-03', '2027-03-13']])

    const undo = await periodeDatumsWijzigen(s, options[0]!)
    expect(base(s)).toMatchObject({ startDate: '2027-03-06', endDate: '2027-03-15' })
    // De eigen agendadagen blijven staan; de agenda toont de trip op zijn dagen.
    expect(own(s).get('2027-03-14')?.type).toBe('rust')
    expect(type(s, '2027-03-14')).toBe('werk')

    await undo()
    expect(base(s)).toMatchObject({ startDate: '2027-03-06', endDate: '2027-03-13' })
    expect(own(s).get('2027-03-14')?.type).toBe('rust')
    expect(own(s).get('2027-03-15')?.type).toBe('werk')
  })

})

describe('geld per werkdag', () => {
  const tx = (id: string, date: string, kind: Transaction['kind'], amount: number): Transaction => ({ id, date, kind, amount, currency: 'EUR', source: 'yacht-week', updatedAt: NOW, deletedAt: null })

  it('verdiend per maand gedeeld door de werkdagen tot en met vandaag; terugbetalingen tellen niet', () => {
    const trips: Trip[] = [{ id: 'a', name: 'Nepweek', startDate: '2027-03-06', endDate: '2027-03-13', updatedAt: NOW, deletedAt: null }]
    const idx = buildIndex([], trips, [])
    const txs = [tx('1', '2027-03-07', 'fooi', 300), tx('2', '2027-03-13', 'loon', 500), tx('3', '2027-03-13', 'terugbetaling', 100), tx('4', '2027-03-13', 'kosten', 50)]
    expect(monthIncome(idx, txs, '2027-03', '2027-03-31')).toEqual({ month: '2027-03', workdays: 8, eur: 800, perWorkday: 100 })
    // Halverwege de trip: alleen de werkdagen tot en met vandaag.
    expect(monthIncome(idx, txs, '2027-03', '2027-03-09')).toMatchObject({ workdays: 4, perWorkday: 200 })
    expect(monthIncome(idx, [], '2027-02', '2027-03-31')).toEqual({ month: '2027-02', workdays: 0, eur: 0, perWorkday: null })
    const table = incomePerWorkday(idx, txs, '2027-04-15', 3)
    expect(table.map((m) => m.month)).toEqual(['2027-04', '2027-03', '2027-02'])
  })
})
