import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyPlan, hasOverlap, parsePlanning, planImport, PlanningError } from '../src/import/planning'
import { availabilityRuns, buildIndex, dayInfo, planningRuns, seasonWeeks } from '../src/model/calendar'
import type { CalendarDay, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put } from './helpers/schrijf'
import { dagsoortenZetten } from '../src/domain/agenda'

// Planning importeren (CSV), periode markeren, seizoensoverzicht en delen. Alle gegevens verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
const TODAY = '2027-03-01'
const fixture = () => new Uint8Array(readFileSync(new URL('./fixtures/planning-nep.csv', import.meta.url)))
const csv = (text: string) => new TextEncoder().encode(text)
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store() {
  const db = await openLogboekDb(`logboek-planning-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_PLANNING_0123456789abcdefghijklmnopqrs', new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip>): Trip => ({ id, name: `Nep ${id}`, updatedAt: NOW, deletedAt: null, ...extra })

describe('planning lezen', () => {
  it('leest de nep-planning: werk, rust, reis, thuis en optie met type, organisatie, boot en gebied', () => {
    const rows = parsePlanning(fixture())
    expect(rows.map((r) => [r.row, r.start, r.end, r.kind])).toEqual([
      [2, '2027-03-06', '2027-03-13', 'werk'],
      [3, '2027-03-14', '2027-03-14', 'rust'],
      [4, '2027-03-15', '2027-03-21', 'werk'],
      [5, '2027-03-22', '2027-03-23', 'reis'],
      [6, '2027-03-24', '2027-03-30', 'thuis'],
      [7, '2027-04-03', '2027-04-10', 'optie'],
    ])
    expect(rows[0]).toMatchObject({ name: 'Nepweek Een', type: 'skipper-charter', organisation: 'yacht-week', boat: 'Nepboot Vijf', area: 'Nepgebied Noord' })
  })

  it('meldingen noemen rij en kolom, nooit de inhoud', () => {
    const bad = (text: string) => {
      try {
        parsePlanning(csv(text))
      } catch (error) {
        expect(error).toBeInstanceOf(PlanningError)
        return (error as Error).message
      }
      throw new Error('geen fout')
    }
    expect(bad('start;eind;soort\n2027-13-01;2027-03-02;werk\n')).toMatch(/Rij 2, kolom start/)
    expect(bad('start;eind;soort\n2027-03-02;2027-03-01;rust\n')).toMatch(/Rij 2/)
    expect(bad('start;eind;soort\n2027-03-02;2027-03-03;Geheimsoort\n')).not.toContain('Geheimsoort')
    expect(bad('start;eind;soort;type\n2027-03-02;2027-03-03;werk;Geheimtype\n')).toMatch(/Rij 2, kolom type/)
    expect(bad('naam;datum\nNep;2027-01-01\n')).toMatch(/kopregel/)
  })
})

describe('voorbeeld en importeren', () => {
  it('overlappingen met bestaande trips en eigen dagen; niets overschrijven zonder aanzetten', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('bestaand', { startDate: '2027-03-12', endDate: '2027-03-14' }))
    await dagsoortenZetten(s, ['2027-03-25'], 'reis')
    const rows = parsePlanning(fixture())
    const items = planImport(rows, buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc')))
    expect(items.map((i) => [i.row.row, i.creates, hasOverlap(i)])).toEqual([
      [2, 'trip', true],
      [3, 'days', true],
      [4, 'trip', false],
      [5, 'days', false],
      [6, 'days', true],
      [7, 'days', false],
    ])
    expect(items[0]!.overlapTrips).toEqual(['Nep bestaand'])

    const result = await inTx(s, applyPlan, items, new Set([6]), 'nl')
    // Rij 2 en 3 overlappen en zijn niet aangezet; rij 6 wel (thuis, ook over de eigen reisdag).
    expect(result).toEqual({ trips: 1, days: 2 + 7 + 8 })
    expect(s.list('trips.json.enc').map((t) => t.name).sort()).toEqual(['Nep bestaand', 'Nepcursus Twee'])
    const cursus = s.list('trips.json.enc').find((t) => t.name === 'Nepcursus Twee')!
    expect(cursus).toMatchObject({ startDate: '2027-03-15', endDate: '2027-03-21', type: 'training-geven', organisation: 'sailing-virgins', boat: 'Nepboot Zes', area: 'Nepgebied Zuid' })
    const own = new Map(s.list('calendar.json.enc').map((d) => [d.date, d.type]))
    expect(own.get('2027-03-14')).toBeUndefined()
    // Thuis wordt een periode (periodemodel); de eigen reisdag zonder gegevens gaat erin op.
    expect(own.get('2027-03-25')).toBeUndefined()
    const after = buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc'), [], s.get('periods.json.enc'))
    expect(dayInfo(after, '2027-03-25', '2027-01-01')).toMatchObject({ type: 'thuis', source: 'periode' })
    expect(own.get('2027-04-03')).toBe('optie')

    // Opnieuw importeren: alles staat er al of overlapt; zonder aanzetten verandert er niets.
    const again = planImport(rows, buildIndex(s.get('calendar.json.enc'), s.get('trips.json.enc'), s.get('legs.json.enc'), [], s.get('periods.json.enc')))
    expect(again.find((i) => i.row.row === 4)!.duplicate).toBe(true)
    expect(again.every(hasOverlap)).toBe(true)
    expect(await inTx(s, applyPlan, again, new Set(), 'nl')).toEqual({ trips: 0, days: 0 })
  })
})

describe('onbeschikbaar importeren', () => {
  it('soort onbeschikbaar (ook unavailable of bezet); de notitie wordt de reden', async () => {
    const rows = parsePlanning(csv('start;eind;soort;notitie\n2027-05-01;2027-05-02;onbeschikbaar;Nepreden\n2027-05-03;;Unavailable;\n2027-05-04;;bezet;\n'))
    expect(rows.map((r) => [r.start, r.end, r.kind])).toEqual([
      ['2027-05-01', '2027-05-02', 'onbeschikbaar'],
      ['2027-05-03', '2027-05-03', 'onbeschikbaar'],
      ['2027-05-04', '2027-05-04', 'onbeschikbaar'],
    ])
    const s = await store()
    const items = planImport(rows, buildIndex([], [], []))
    expect(await inTx(s, applyPlan, items, new Set(), 'nl')).toEqual({ trips: 0, days: 4 })
    const days = s.list('calendar.json.enc').sort((a, b) => a.date.localeCompare(b.date))
    expect(days.map((d) => [d.date, d.type, d.reason ?? null, d.note ?? null])).toEqual([
      ['2027-05-01', 'onbeschikbaar', 'Nepreden', null],
      ['2027-05-02', 'onbeschikbaar', 'Nepreden', null],
      ['2027-05-03', 'onbeschikbaar', null, null],
      ['2027-05-04', 'onbeschikbaar', null, null],
    ])
  })
})

describe('seizoensoverzicht en delen', () => {
  const trips = [trip('a', { name: 'Nepweek Een', startDate: '2027-03-06', endDate: '2027-03-13', type: 'skipper-charter', area: 'Nepgebied', boat: 'Nepboot' })]
  const own: CalendarDay[] = [
    { id: 'dag:2027-03-14', date: '2027-03-14', type: 'reis', travel: { from: 'Nepstad', to: 'Nephaven', flight: 'NP 1' }, note: 'Geheim', updatedAt: NOW, deletedAt: null },
    { id: 'dag:2027-03-17', date: '2027-03-17', type: 'optie', updatedAt: NOW, deletedAt: null },
  ]
  const index = buildIndex(own, trips, [])

  it('één regel per week met trips en gaten als "Beschikbaar: …"', () => {
    const weeks = seasonWeeks(index, '2027-03-08', '2027-03-21', TODAY)
    expect(weeks.map((w) => w.start)).toEqual(['2027-03-08', '2027-03-15'])
    expect(weeks[0]!.items.map((i) => (i.kind === 'trip' ? `trip:${i.view.trip.name}` : `${i.type}:${i.from}–${i.to}`))).toEqual(['trip:Nepweek Een', 'reis:2027-03-14–2027-03-14'])
    expect(weeks[1]!.items.map((i) => (i.kind === 'trip' ? 'trip' : `${i.type}:${i.from}–${i.to}`))).toEqual(['beschikbaar:2027-03-15–2027-03-16', 'optie:2027-03-17–2027-03-17', 'beschikbaar:2027-03-18–2027-03-21'])
  })

  it('onbeschikbaar is bezet in de beschikbaarheid, zonder reden; in de volledige planning alleen de dagsoort', () => {
    const idx = buildIndex([...own, { id: 'dag:2027-03-16', date: '2027-03-16', type: 'onbeschikbaar', reason: 'Geheime reden', updatedAt: NOW, deletedAt: null }], trips, [])
    expect(availabilityRuns(idx, '2027-03-15', '2027-03-17', TODAY)).toEqual([
      { from: '2027-03-15', to: '2027-03-15', value: 'beschikbaar' },
      { from: '2027-03-16', to: '2027-03-16', value: 'bezet' },
      { from: '2027-03-17', to: '2027-03-17', value: 'optie' },
    ])
    expect(planningRuns(idx, '2027-03-16', '2027-03-16', TODAY)).toEqual([{ from: '2027-03-16', to: '2027-03-16', value: { type: 'onbeschikbaar' } }])
    const season = seasonWeeks(idx, '2027-03-15', '2027-03-21', TODAY)
    expect(JSON.stringify(season)).toContain('"onbeschikbaar"')
    for (const shared of [availabilityRuns(idx, '2027-03-01', '2027-03-31', TODAY), planningRuns(idx, '2027-03-01', '2027-03-31', TODAY), season]) expect(JSON.stringify(shared)).not.toContain('Geheime')
  })

  it('alleen beschikbaarheid: beschikbaar, bezet en optie, zonder namen', () => {
    const runs = availabilityRuns(index, '2027-03-12', '2027-03-18', TODAY)
    expect(runs).toEqual([
      { from: '2027-03-12', to: '2027-03-14', value: 'bezet' },
      { from: '2027-03-15', to: '2027-03-16', value: 'beschikbaar' },
      { from: '2027-03-17', to: '2027-03-17', value: 'optie' },
      { from: '2027-03-18', to: '2027-03-18', value: 'beschikbaar' },
    ])
    expect(JSON.stringify(runs)).not.toMatch(/Nep|Geheim/)
  })

  it('volledige planning: trip met type en gebied, reis van–naar; geen boot, vlucht of notitie', () => {
    const runs = planningRuns(index, '2027-03-12', '2027-03-14', TODAY)
    expect(runs).toEqual([
      { from: '2027-03-12', to: '2027-03-13', value: { type: 'werk', trip: { id: 'a', name: 'Nepweek Een', tripType: 'skipper-charter', area: 'Nepgebied' } } },
      { from: '2027-03-14', to: '2027-03-14', value: { type: 'reis', travel: { from: 'Nepstad', to: 'Nephaven' } } },
    ])
    expect(JSON.stringify(runs)).not.toMatch(/Nepboot|NP 1|Geheim/)
  })
})
