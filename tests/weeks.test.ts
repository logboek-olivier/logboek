import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyImport } from '../src/import/apply'
import type { ImportResult } from '../src/import/mileage-csv'
import { tripForDate } from '../src/model/derive'
import { currentSettings } from '../src/model/settings'
import type { Leg, Trip } from '../src/model/types'
import {
  activeWeek,
  cleanParticipants,
  closeWeek,
  dayCountOf,
  defaultWeekName,
  isoWeek,
  needsClosing,
  roleForType,
  startWeek,
  suggestType,
  updateWeek,
  weekView,
  type WeekInput,
  boatProfile,
  feetToMetres,
  missingDays,
  upcomingTrips,
} from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

const TOKEN = 'github_pat_WEEKS_0123456789abcdefghijklmnopqrstuvwxyz'
const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device(github = new FakeGithub()) {
  const db = await openLogboekDb(`logboek-weeks-${++counter}`)
  return { github, store: await Store.open(db, masterKey, new GithubClient(TOKEN, github.fetch)) }
}

function leg(id: string, tripId: string, date: string, nm = 10, source: Leg['source'] = 'import'): Leg {
  return {
    id, tripId, date, fromPlace: 'Nepstad', fromCountry: 'NL', toPlace: 'Nephaven', toCountry: 'NL', role: 'schipper', boat: 'Nepboot',
    nmInland: 0, nmSea: nm, nmTidal: 0, nightHours: 0, dateEstimated: false, source, updatedAt: NOW, deletedAt: null,
  }
}

/** Zo zag een tocht eruit vóór weken: alleen een naam. */
function oldTrip(id: string, name: string): Trip {
  return { id, name, updatedAt: NOW, deletedAt: null }
}

const input: WeekInput = {
  name: '',
  type: 'training-geven',
  startDate: '2026-10-26',
  dayCount: 7,
  boat: ' Nepboot ',
  boatModel: 'Nepmodel 40',
  boatLengthFt: 40,
  boatKind: 'catamaran',
  base: 'Nepbasis',
  charter: '',
  area: 'Nepgebied',
  organisation: 'sailing-virgins',
  participants: [{ firstName: ' Nepanna ', level: 'beginner', curriculumId: 'seed-asa-101' }, { firstName: '  ' }, { firstName: 'Nepbram' }],
  note: '',
}

describe('weken afleiden', () => {
  it('ISO-weeknummer en standaardnaam', () => {
    expect(isoWeek('2026-10-26')).toBe(44)
    expect(isoWeek('2026-01-01')).toBe(1)
    expect(isoWeek('2021-01-01')).toBe(53)
    expect(isoWeek('2024-12-30')).toBe(1)
    expect(defaultWeekName('2026-10-26', 'nl', 'Nepbasis')).toBe('Nepbasis okt 2026')
    expect(defaultWeekName('2026-10-26', 'en', 'Nepbasis')).toBe('Nepbasis Oct 2026')
    expect(defaultWeekName('2026-06-01', 'nl')).toBe('Trip jun 2026')
  })

  it('type als voorstel uit de naam; rol volgt uit het type', () => {
    expect(suggestType('Yacht week 7')).toBe('skipper-charter')
    expect(suggestType('YACHT WEEK Kroatië')).toBe('skipper-charter')
    expect(suggestType('RYA Offshore exam')).toBe('zelf-trainen')
    expect(suggestType('Nepboot oktober 2026')).toBe('overig')
    expect(roleForType('training-geven')).toBe('instructeur')
    expect(roleForType('skipper-charter')).toBe('schipper')
    expect(roleForType('zelf-cruisen')).toBe('schipper')
    expect(roleForType('delivery')).toBe('schipper')
    expect(roleForType('zelf-trainen')).toBe('trainee')
    expect(roleForType('overig')).toBeNull()
  })

  it('een oude tocht (alleen naam) krijgt type en datums uit de dagen, zonder iets op te slaan', () => {
    const trip = oldTrip('t1', 'Yacht week 7')
    const view = weekView(trip, [leg('a', 't1', '2025-07-07'), leg('b', 't1', '2025-07-05', 20), leg('c', 'ander', '2025-07-06')])
    expect(view).toMatchObject({ type: 'skipper-charter', typeSuggested: true, startDate: '2025-07-05', endDate: '2025-07-07', boat: 'Nepboot', days: 2, nm: 30 })
    expect(trip).toEqual(oldTrip('t1', 'Yacht week 7'))
    expect(dayCountOf(view)).toBe(3)
  })

  it('opgeslagen weekdatums gaan voor bij het koppelen van fooi aan een week', () => {
    const week: Trip = { ...oldTrip('w', 'Week 44'), type: 'training-geven', startDate: '2026-10-26', endDate: '2026-11-01' }
    expect(tripForDate([week], [], '2026-10-30')?.id).toBe('w')
    expect(tripForDate([week], [], '2026-11-02')).toBeNull()
    expect(tripForDate([oldTrip('t1', 'Oud')], [leg('a', 't1', '2025-07-07')], '2025-07-07')?.id).toBe('t1')
  })

  it('deelnemers: alleen voornaam, niveau en cursus; lege regels vallen weg', () => {
    const list = cleanParticipants([...input.participants, { firstName: 'Nep', email: 'x@y.z' } as never])
    expect(list.map((p) => p.firstName)).toEqual(['Nepanna', 'Nepbram', 'Nep'])
    for (const p of list) expect(Object.keys(p).every((k) => ['id', 'firstName', 'level', 'curriculumId'].includes(k))).toBe(true)
  })
})

describe('week starten, bewerken en afronden', () => {
  it('starten maakt de week actief; einde = start + 6; afronden met review maakt hem weer leeg, met ongedaan maken', async () => {
    const { store, github } = await device()
    const trip = await startWeek(store, input, 'nl', '2026-10-28')
    expect(trip).toMatchObject({ name: 'Nepbasis okt 2026', boatModel: 'Nepmodel 40', boatLengthFt: 40, boatKind: 'catamaran', base: 'Nepbasis', type: 'training-geven', startDate: '2026-10-26', endDate: '2026-11-01', boat: 'Nepboot', area: 'Nepgebied', organisation: 'sailing-virgins' })
    expect(trip.participants).toHaveLength(2)
    expect(activeWeek(store.get('trips.json.enc'), currentSettings(store.get('settings.json.enc')))?.id).toBe(trip.id)
    expect(needsClosing(weekView(trip, []), '2026-11-01')).toBe(false)
    expect(needsClosing(weekView(trip, []), '2026-11-02')).toBe(true)

    await updateWeek(store, trip, { ...input, name: 'Nepweek', dayCount: 5, boat: '' }, 'nl')
    const updated = store.list('trips.json.enc').find((t) => t.id === trip.id)!
    expect(updated).toMatchObject({ name: 'Nepweek', endDate: '2026-10-30' })
    expect(updated.boat).toBeUndefined()

    const undo = await closeWeek(store, updated, { score: 9.4, quotes: ['Best skipper ever', ' ', 'Great week'] }, '2026-11-02', currentSettings(store.get('settings.json.enc')))
    const closed = store.list('trips.json.enc').find((t) => t.id === trip.id)!
    expect(closed).toMatchObject({ closedAt: '2026-11-02', review: { score: 9.4, quotes: ['Best skipper ever', 'Great week'] } })
    expect(activeWeek(store.get('trips.json.enc'), currentSettings(store.get('settings.json.enc')))).toBeNull()
    await undo()
    expect(store.list('trips.json.enc').find((t) => t.id === trip.id)!.closedAt).toBeUndefined()
    expect(activeWeek(store.get('trips.json.enc'), currentSettings(store.get('settings.json.enc')))?.id).toBe(trip.id)

    await store.sync()
    const wire = github.requests.map((r) => r.body ?? '').join('\n')
    for (const secret of ['Nepanna', 'Nepgebied', 'Best skipper ever']) expect(wire).not.toContain(secret)
  })
})

describe('achterwaarts compatibel', () => {
  it('oude tochten en instellingen zonder weekvelden blijven werken; een nieuwe import behoudt weekgegevens', async () => {
    const { store } = await device()
    // Data zoals de huidige versie die schrijft: tocht met alleen een naam, geïmporteerde dagen, instellingen zonder activeWeekId.
    await store.putMany('trips.json.enc', [oldTrip('t1', 'Yacht week 7'), oldTrip('t2', 'Nepboot mei 2025')])
    await store.putMany('legs.json.enc', [leg('a', 't1', '2025-07-05'), leg('b', 't1', '2025-07-06'), leg('c', 't2', '2025-05-01'), leg('m', 't2', '2025-05-02', 5, 'manual')])
    expect(activeWeek(store.get('trips.json.enc'), currentSettings(store.get('settings.json.enc')))).toBeNull()
    expect(weekView(store.list('trips.json.enc')[0]!, store.get('legs.json.enc')).type).toBe('skipper-charter')

    // Een net gestarte week zonder dagen overleeft een import ook.
    const fresh = await startWeek(store, input, 'nl')

    // Olivier legt de week vast met deelnemers en review.
    const t1 = store.list('trips.json.enc').find((t) => t.id === 't1')!
    await store.put('trips.json.enc', { ...t1, type: 'skipper-charter', participants: [{ id: 'p1', firstName: 'Nepcees' }], review: { score: 9, quotes: [] } })

    // Opnieuw importeren: zelfde tocht (naam + eerste dag) krijgt het bestaande id; nieuwe tochten een nieuw id.
    const reimport: ImportResult = {
      trips: [oldTrip('nieuw-1', 'Yacht week 7'), oldTrip('nieuw-2', 'Andere nepweek')],
      legs: [leg('x', 'nieuw-1', '2025-07-05'), leg('y', 'nieuw-1', '2025-07-07'), leg('z', 'nieuw-2', '2025-08-01')],
      summary: { nm: 0, days: 0, trips: 0, nightHours: 0, nmByRole: { schipper: 0, 'co-schipper': 0, bemanningslid: 0, trainee: 0, instructeur: 0 }, nmByWater: { inland: 0, sea: 0, tidal: 0 } },
      warnings: [],
      kind: 'csv',
    }
    await applyImport(store, reimport)
    const trips = store.list('trips.json.enc')
    const kept = trips.find((t) => t.id === 't1')!
    expect(kept.participants?.[0]?.firstName).toBe('Nepcees')
    expect(store.list('legs.json.enc').filter((l) => l.tripId === 't1').map((l) => l.id).sort()).toEqual(['x', 'y'])
    expect(trips.some((t) => t.name === 'Andere nepweek')).toBe(true)
    // t2 houdt zijn handmatige dag en blijft bestaan.
    expect(trips.some((t) => t.id === 't2')).toBe(true)
    expect(trips.some((t) => t.id === fresh.id)).toBe(true)
  })
})

describe('trips van elke lengte, eerdere en komende trips, bootgegevens', () => {
  it('een eerdere of komende trip maakt de lopende trip niet anders; een trip waarin vandaag valt is vanzelf lopend', async () => {
    const { store } = await device()
    const past = await startWeek(store, { ...input, startDate: '2026-09-01', dayCount: 10 }, 'nl', '2026-10-28')
    const future = await startWeek(store, { ...input, startDate: '2026-12-01', dayCount: 21 }, 'nl', '2026-10-28')
    const settings = currentSettings(store.get('settings.json.enc'))
    expect(settings.activeWeekId ?? null).toBeNull()
    expect(future.endDate).toBe('2026-12-21')
    const trips = store.get('trips.json.enc')
    expect(activeWeek(trips, settings, '2026-10-28')).toBeNull()
    expect(activeWeek(trips, settings, '2026-12-05')?.id).toBe(future.id)
    expect(activeWeek(trips, settings, '2026-09-03')?.id).toBe(past.id)
    expect(upcomingTrips(trips, '2026-10-28').map((t) => t.id)).toEqual([future.id])
  })

  it('bootgegevens: een bekende boot vult de rest in', () => {
    const full: Trip = { ...oldTrip('a', 'Nep'), boat: 'Nepboot', boatModel: 'Nepmodel 40', boatLengthFt: 40, boatKind: 'catamaran', base: 'Nepbasis', charter: 'Nepcharter', startDate: '2026-01-01' }
    expect(boatProfile([full], ' nepboot ')).toEqual({ boatModel: 'Nepmodel 40', boatLengthFt: 40, boatKind: 'catamaran', base: 'Nepbasis', charter: 'Nepcharter' })
    expect(boatProfile([full], 'Andere boot')).toBeNull()
    expect(feetToMetres(42)).toBe(12.8)
  })

  it('vergeten dagen binnen de trip, tot en met vandaag', () => {
    const trip: Trip = { ...oldTrip('w', 'Nep'), startDate: '2026-10-20', endDate: '2026-10-25' }
    const view = weekView(trip, [leg('a', 'w', '2026-10-20'), leg('b', 'w', '2026-10-22')])
    expect(missingDays(view, '2026-10-23')).toEqual(['2026-10-21', '2026-10-23'])
    expect(missingDays(view, '2026-11-01')).toEqual(['2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25'])
  })
})
