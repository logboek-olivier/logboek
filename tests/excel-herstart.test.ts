import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { mijlenImporteren } from '../src/domain/importeren'
import { terugzetten } from '../src/domain/prullenbak'
import { planImport } from '../src/import/apply'
import { GAP_WARNING_DAYS, parseMileageCsv } from '../src/import/mileage-csv'
import { boatList } from '../src/model/boats'
import { active } from '../src/model/derive'
import { trashItems } from '../src/model/trash'
import type { Leg, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { goldenCsv, goldenDate, goldenTrips } from './helpers/gouden-dataset'
import { put, putMany } from './helpers/schrijf'
import { relations } from './helpers/relaties'

// Excel opnieuw importeren als schone herstart (CLAUDE.md, uitgangspunt 1; src/import/apply.ts): een blok is een trip
// met de eerste en laatste dag van het blok; alleen wat uit een import kwam, wordt vervangen (naar de prullenbak); wat
// Olivier in de app maakte, blijft. Alles verzonnen (de gouden dataset).

const TOKEN = 'github_pat_HERSTART_0123456789abcdefghijklmnopqrstuvwxy'
const T = '2026-10-01T10:00:00.000Z'
let counter = 0

async function store(): Promise<Store> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return Store.open(await openLogboekDb(`logboek-herstart-${++counter}`), key, new GithubClient(TOKEN, new FakeGithub().fetch))
}

/** Trips en dagen zonder tijden en id's van dagen, om twee imports te vergelijken. */
function snapshot(s: Store): string {
  const trips = active(s.get('trips.json.enc')).map((t) => ({ ...t, updatedAt: '' }))
  const legs = active(s.get('legs.json.enc')).map((l) => ({ ...l, updatedAt: '' }))
  return JSON.stringify([trips.sort((a, b) => a.id.localeCompare(b.id)), legs.sort((a, b) => a.id.localeCompare(b.id))])
}

/** De CSV zonder de blokken met deze namen (een tocht die uit de Excel ging). */
function without(csv: string, names: readonly string[]): string {
  const blocks = csv.split('\r\n\r\n')
  return blocks.filter((b) => !names.some((n) => b.split('\r\n')[0]!.endsWith(`;${n}`))).join('\r\n\r\n')
}

describe('Excel opnieuw importeren als schone herstart', () => {
  it('elke trip is precies zo lang als zijn blok: begin en eind zijn de eerste en laatste dag', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = active(s.get('trips.json.enc'))
    expect(trips).toHaveLength(goldenTrips().length)
    for (const golden of goldenTrips()) {
      const trip = trips.find((t) => t.name === golden.name && t.startDate === goldenDate(golden, 0))
      expect(trip, golden.name).toBeTruthy()
      expect(trip!.endDate, golden.name).toBe(goldenDate(golden, golden.days.length - 1))
      expect(trip!.datesFromDays).toBeUndefined()
    }
  })

  it('twee keer importeren geeft precies hetzelfde, en de tweede keer schrijft niets', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const first = snapshot(s)
    const plan = planImport(s, parseMileageCsv(goldenCsv()))
    expect({ trips: plan.trips.length, legs: plan.legs.length, removedTrips: plan.removedTrips.length, removedLegs: plan.removedLegs.length }).toEqual({ trips: 0, legs: 0, removedTrips: 0, removedLegs: 0 })
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    expect(snapshot(s)).toBe(first)
  })

  it('alleen geïmporteerde trips en dagen gaan naar de prullenbak; wat in de app gemaakt is, blijft onaangeroerd; terugzetten zet alles terug', async () => {
    const s = await store()
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    // Zelf gemaakt in de app: een trip met een gelogde dag, en een gelogde dag in een geïmporteerde trip.
    const own: Trip = { id: 'eigen', name: 'Nep eigen trip', startDate: '2026-06-01', endDate: '2026-06-03', updatedAt: T, deletedAt: null }
    const imported = active(s.get('trips.json.enc')).find((t) => t.name === 'Nep overtocht 2')!
    const ownLeg = (id: string, tripId: string, date: string): Leg => ({ id, tripId, date, fromPlace: 'Nephaven', fromCountry: 'NL', toPlace: 'Nepbaai', toCountry: 'NL', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 5, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: T, deletedAt: null })
    await put(s, 'trips.json.enc', own)
    await putMany(s, 'legs.json.enc', [ownLeg('eigen-1', 'eigen', '2026-06-01'), ownLeg('eigen-2', imported.id, imported.startDate!)])
    const before = relations(s)
    const ownBefore = JSON.stringify([s.get('trips.json.enc').find((t) => t.id === 'eigen'), s.get('legs.json.enc').filter((l) => l.source === 'manual')])

    // Twee tochten gingen uit de Excel: één gewone, en de trip met een zelf gelogde dag (die blijft, zonder zijn
    // geïmporteerde dagen).
    const input = parseMileageCsv(without(goldenCsv(), ['Amorgos trainingsweek 2', 'Nep overtocht 2']))
    const plan = planImport(s, input)
    expect(plan.removedTrips.map((t) => t.name)).toEqual(['Amorgos trainingsweek 2'])
    expect(plan.keptTrips.map((t) => t.name)).toEqual(['Nep overtocht 2'])
    expect(plan.manualLegs).toBe(2)
    await mijlenImporteren(s, input)
    expect(active(s.get('trips.json.enc')).some((t) => t.name === 'Amorgos trainingsweek 2')).toBe(false)
    expect(active(s.get('legs.json.enc')).filter((l) => l.tripId === imported.id).map((l) => l.id)).toEqual(['eigen-2'])
    expect(JSON.stringify([s.get('trips.json.enc').find((t) => t.id === 'eigen'), s.get('legs.json.enc').filter((l) => l.source === 'manual')])).toBe(ownBefore)

    // In de prullenbak: één regel voor de import; terugzetten zet het logboek terug zoals vóór de import.
    const item = trashItems(s).find((i) => i.kind === 'import')!
    expect(item.title).toContain('Amorgos trainingsweek 2')
    await terugzetten(s, item.key)
    expect(relations(s)).toEqual(before)
  })

  it('een oude import met te lange trips (dagen ver uit elkaar): na de verbeterde Excel heeft elke trip het begin en eind van zijn blok', async () => {
    const s = await store()
    // Zoals Oliviers oude logboek: elke dag van één tocht 31 dagen na de vorige (een fout in de Excel), en trips zonder
    // eigen datums, dus maanden lang in de agenda.
    const bad = parseMileageCsv(goldenCsv())
    const victim = bad.trips.find((t) => t.name === 'Nep overtocht')!
    let n = 0
    const shifted = bad.legs.map((l) => (l.tripId === victim.id ? { ...l, date: shiftDays(victim.startDate!, 31 * n++) } : l))
    const undated = bad.trips.map((t) => {
      const copy: Trip = { ...t }
      delete copy.startDate
      delete copy.endDate
      return copy
    })
    await putMany(s, 'trips.json.enc', undated)
    await putMany(s, 'legs.json.enc', shifted)
    const golden = goldenTrips().find((t) => t.name === 'Nep overtocht')!
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trip = active(s.get('trips.json.enc')).find((t) => t.id === victim.id)!
    expect(trip).toMatchObject({ startDate: goldenDate(golden, 0), endDate: goldenDate(golden, golden.days.length - 1) })
    expect(active(s.get('legs.json.enc')).filter((l) => l.tripId === victim.id).every((l) => l.date <= trip.endDate!)).toBe(true)
    expect(active(s.get('trips.json.enc'))).toHaveLength(goldenTrips().length)
  })

  it('het voorbeeld waarschuwt voor een datum die niet bestaat en dagen ver uit elkaar; de import verandert ze niet', () => {
    const header = 'Datum;Van (plaats);Van (land);Naar (plaats);Naar (land);Rol;Schip;Schipper/trainer;Co-schipper (flot.leider);Wind (bft);Binnenwater;Zee;Zee (getijnavigatie);Totaal;Nacht-uren;Bijzonderheden'
    const row = (date: string, notes = '') => `${date};Nephaven;NL;Nepbaai;NL;Schipper;Nepboot;;;;;10;;10;0;${notes}`
    const result = parseMileageCsv([header, row('30-3-2025', 'Nep lange tocht'), row('31-4-2025'), row('31-5-2025')].join('\r\n'))
    expect(result.warnings).toContain('Rij 3: dag bestaat niet in die maand; laatste dag van de maand genomen (geschat)')
    expect(result.warnings.filter((w) => w.includes('Klopt de datum'))).toHaveLength(2)
    expect(result.trips[0]).toMatchObject({ startDate: '2025-03-30', endDate: '2025-05-31' })
    expect(GAP_WARNING_DAYS).toBe(7)
  })

  it('boten en plaatsen op naam hergebruikt: geen tweede boot of plaats door hoofdletters of spaties', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', { id: 'eigen', name: 'Nep eigen', startDate: '2022-01-01', endDate: '2022-01-02', boat: 'NEPBOOT A', boatModel: 'Nepmodel 30', boatLengthFt: 33, boatKind: 'eenromp', updatedAt: T, deletedAt: null })
    await put(s, 'places.json.enc', { id: 'p1', name: 'Nep Haven', lat: 52, lon: 5, updatedAt: T, deletedAt: null })
    await mijlenImporteren(s, parseMileageCsv(goldenCsv()))
    const trips = active(s.get('trips.json.enc'))
    const a = trips.filter((t) => t.boat?.toLowerCase() === 'nepboot a')
    expect(a.length).toBeGreaterThan(1)
    expect(new Set(a.map((t) => t.boat))).toEqual(new Set(['NEPBOOT A']))
    expect(a.filter((t) => t.id !== 'eigen' && t.boatModel === 'Nepmodel 30').every((t) => t.boatLengthFt === 33)).toBe(true)
    const legs = active(s.get('legs.json.enc'))
    expect(legs.some((l) => l.fromPlace === 'Nephaven' || l.toPlace === 'Nephaven')).toBe(false)
    expect(legs.some((l) => l.toPlace === 'Nep Haven')).toBe(true)
    // Eén regel per boot in Meer → Boten.
    const keys = boatList(trips, legs).map((b) => b.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
