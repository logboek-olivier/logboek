import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { placeLeg, splitLegs } from '../src/model/leg-trip'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import { activeWeek, weekFields } from '../src/model/weeks'
import type { Leg, Settings, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { landperiodeBewerken, landperiodeZetten } from '../src/domain/agenda'

// PR 1 van het periodemodel: een dag ligt altijd binnen de datums van zijn trip (de oorzaak van SV #1 met een dag op
// 28 oktober), de lopende trip, de periodepagina en periodes aan land bewerken. Alle gegevens verzonnen.

const T = '2026-10-01T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store() {
  const db = await openLogboekDb(`logboek-periodepagina-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_PERIODEPAGINA_0123456789abcdefghijk', new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Neptrip ${id}`, updatedAt: T, deletedAt: null, ...extra })
const leg = (id: string, tripId: string, date: string): Leg => ({ id, tripId, date, fromPlace: 'Nepbaai', fromCountry: '', toPlace: 'Nepdorp', toCountry: '', role: 'schipper', boat: '', nmInland: 0, nmSea: 5, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T, deletedAt: null })
const sv1 = trip('sv1', { startDate: '2026-10-18', endDate: '2026-10-24', type: 'training-geven' })
const sv2 = trip('sv2', { startDate: '2026-10-26', endDate: '2026-10-31', type: 'training-geven' })

describe('een dag hoort bij de trip van zijn datum', () => {
  it('SV #1 als lopende of meegegeven trip, dag op 28 oktober: de dag komt in SV #2 (eerst rood: kwam in SV #1)', () => {
    expect(placeLeg([sv1, sv2], [], 'sv1', '2026-10-28')).toEqual({ tripId: 'sv2', moved: true })
    expect(placeLeg([sv1, sv2], [], 'sv1', '2026-10-20')).toEqual({ tripId: 'sv1' })
  })

  it('vlak naast de gekozen trip wordt die langer; verder weg een nieuwe trip; een trip die zijn dagen volgt blijft', () => {
    expect(placeLeg([sv1], [], 'sv1', '2026-10-26')).toEqual({ tripId: 'sv1', extend: { start: '2026-10-18', end: '2026-10-26' } })
    expect(placeLeg([sv1], [], 'sv1', '2026-11-20')).toEqual({ tripId: null, moved: true })
    const follows = trip('dag', { startDate: '2026-11-01', endDate: '2026-11-01', datesFromDays: true })
    expect(placeLeg([follows], [leg('l', 'dag', '2026-11-01')], 'dag', '2026-11-09')).toEqual({ tripId: 'dag' })
    expect(placeLeg([sv1], [], null, '2026-10-19')).toEqual({ tripId: 'sv1' })
    expect(placeLeg([sv1], [], null, '2026-12-01')).toEqual({ tripId: null })
  })

  it('de lopende trip: een trip waarin vandaag valt gaat voor een eerder gestarte trip die voorbij is', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, activeWeekId: 'sv1', updatedAt: T, deletedAt: null }
    expect(activeWeek([sv1, sv2], settings, '2026-10-28')?.id).toBe('sv2')
    // Zonder trip op vandaag blijft de gestarte trip lopend (Deze trip vraagt dan om afronden).
    expect(activeWeek([sv1], settings, '2026-10-28')?.id).toBe('sv1')
  })

  it('de periodepagina toont alleen de dagen binnen de datums; de rest apart', () => {
    const { inside, outside } = splitLegs(sv1, [leg('a', 'sv1', '2026-10-19'), leg('b', 'sv1', '2026-10-28'), leg('c', 'sv2', '2026-10-27')])
    expect(inside.map((l) => l.id)).toEqual(['a'])
    expect(outside.map((l) => l.id)).toEqual(['b'])
  })

  it('opslaan in Trip bewerken legt de soort vast (geen Nakijken meer)', () => {
    const fields = weekFields({ name: 'Nep', type: 'zelf-cruisen', startDate: '2026-12-01', dayCount: 3, boat: '', boatModel: '', boatLengthFt: null, base: '', charter: '', area: '', participants: [], note: '' }, 'nl')
    expect(fields).toMatchObject({ kind: 'plezier', type: 'zelf-cruisen' })
  })
})

describe('periode aan land bewerken', () => {
  it('soort, datums, naam, notitie en reis; leegmaken mag; ongedaan maken zet alles terug', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2027-01-10', '2027-01-11', '2027-01-12'], 'thuis', { note: 'Nepnotitie' })
    const stay = s.list('periods.json.enc')[0]!
    const undo = await landperiodeBewerken(s, stay, { kind: 'reis', name: 'Nepreis', startDate: '2027-01-11', endDate: '2027-01-13', note: '', travel: { from: 'Nepstad', to: 'Nephaven', by: 'vliegtuig' } })
    // De periode staat nu op 11–13 januari; 10 januari hoort bij geen periode meer.
    const live = s.list('periods.json.enc')
    expect(live).toHaveLength(1)
    const trip = live[0]!
    expect(trip).toMatchObject({ startDate: '2027-01-11', endDate: '2027-01-13', name: 'Nepreis', travel: { from: 'Nepstad', to: 'Nephaven', by: 'vliegtuig' } })
    expect(trip.note).toBeUndefined()
    await undo()
    expect(s.list('periods.json.enc').map((p) => [p.kind, p.startDate, p.endDate, p.note])).toEqual([['thuis', '2027-01-10', '2027-01-12', 'Nepnotitie']])
  })
})
