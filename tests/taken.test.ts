import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { taakMarkeren } from '../src/domain/berichten'
import { cleanMessageDefaults, effectiveTemplates, fillTemplate, messageKinds, messageValues } from '../src/model/messages'
import { SCHEMA_VERSION, WRITER_VERSION } from '../src/model/schema'
import { LATE_DAYS, openTasksBetween, todayTasks, weekTasksOf, type TaskData } from '../src/model/tasks'
import type { Claim, Transaction, Trip, WeekPlan } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { decodeRecords } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'

// Vandaag doen (src/model/tasks.ts): de weektaken van een werktrip op een vaste dag, te laat tot ze gedaan zijn
// (hoogstens twee weken), vanzelf gedaan als de actie gedaan is, en per organisatie uit te zetten. Alles verzonnen.

const T = '2026-11-01T10:00:00.000Z'
const TOKEN = 'github_pat_TAKEN_0123456789abcdefghijklmnopqrstuvwxyz0123'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
async function device() {
  return Store.open(await openLogboekDb(`logboek-taken-${++counter}`), masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

// Een lesweek van zondag 22 tot en met zaterdag 28 november 2026.
const TRIP: Trip = {
  id: 'nep-les',
  name: 'SV #4 · Nepgebied',
  kind: 'werk',
  type: 'training-geven',
  organisation: 'sailing-virgins',
  startDate: '2026-11-22',
  endDate: '2026-11-28',
  updatedAt: T,
  deletedAt: null,
}
const data = (patch: Partial<TaskData> = {}): TaskData => ({ trips: [TRIP], legs: [], plans: [], transactions: [], claims: [], settings: {}, ...patch })
const kinds = (tasks: { kind: string }[]) => tasks.map((x) => x.kind)

describe('weektaken', () => {
  it('elke taak op zijn dag: introductie de woensdag ervoor, lesplanning de zaterdag ervoor, declaraties de dag na het einde', () => {
    const tasks = weekTasksOf(TRIP, data())
    expect(tasks.map((x) => [x.kind, x.date])).toEqual([
      ['introductie', '2026-11-18'],
      ['boodschappen', '2026-11-20'],
      ['lesplanning', '2026-11-21'],
      ['safety', '2026-11-22'],
      ['afsluiting', '2026-11-28'],
      ['fooi', '2026-11-28'],
      ['afronden', '2026-11-29'],
      ['declaraties', '2026-11-29'],
    ])
    expect(tasks.every((x) => x.done === null)).toBe(true)
  })

  it('lesplanning alleen bij les geven; geen taken bij plezier of zonder datums', () => {
    const charter = { ...TRIP, type: 'skipper-charter' as const }
    expect(kinds(weekTasksOf(charter, data()))).not.toContain('lesplanning')
    expect(weekTasksOf({ ...TRIP, kind: 'plezier', type: 'zelf-cruisen', organisation: undefined }, data())).toEqual([])
    expect(weekTasksOf({ ...TRIP, endDate: undefined }, data())).toEqual([])
    expect(weekTasksOf({ ...TRIP, deletedAt: T }, data())).toEqual([])
  })

  it('de introductie volgt de dagen vooraf van de organisatie', () => {
    const tasks = weekTasksOf(TRIP, data({ settings: { messageDefaults: { 'sailing-virgins': { introDaysBefore: 7 } } } }))
    expect(tasks.find((x) => x.kind === 'introductie')!.date).toBe('2026-11-15')
  })

  it('per organisatie uit te zetten', () => {
    const settings = { messageDefaults: { 'sailing-virgins': { tasksOff: ['boodschappen', 'fooi'] } } }
    expect(kinds(weekTasksOf(TRIP, data({ settings })))).toEqual(['introductie', 'lesplanning', 'safety', 'afsluiting', 'afronden', 'declaraties'])
    expect(cleanMessageDefaults({ tasksOff: ['fooi', 'fooi', ''] })).toEqual({ tasksOff: ['fooi'] })
  })
})

describe('Vandaag doen', () => {
  it('op zijn dag, daarna te laat, en na twee weken niet meer', () => {
    expect(todayTasks(data(), '2026-11-17')).toEqual([])
    expect(kinds(todayTasks(data(), '2026-11-18'))).toEqual(['introductie'])
    expect(kinds(todayTasks(data(), '2026-11-21'))).toEqual(['introductie', 'boodschappen', 'lesplanning'])
    expect(kinds(todayTasks(data(), '2026-11-29'))).toEqual(['introductie', 'boodschappen', 'lesplanning', 'safety', 'afsluiting', 'fooi', 'afronden', 'declaraties'])
    expect(kinds(todayTasks(data(), `2026-12-${String(2 + 0).padStart(2, '0')}`))).toContain('introductie')
    expect(LATE_DAYS).toBe(14)
    expect(kinds(todayTasks(data(), '2026-12-03'))).not.toContain('introductie')
    expect(kinds(openTasksBetween(data(), '2026-11-21', '2026-11-21'))).toEqual(['lesplanning'])
  })

  it('vanzelf gedaan: bericht verstuurd, planning bij de trip, fooi bij de trip, trip afgerond, declaraties ingediend', () => {
    const plan: WeekPlan = { id: 'pl', title: 'Nepplan', startDate: '2026-11-22', dayCount: 7, tripId: TRIP.id, groups: [], days: [], updatedAt: T, deletedAt: null }
    const tip: Transaction = { id: 'tx', date: '2026-11-28', kind: 'fooi', amount: 50, currency: 'USD', source: 'sailing-virgins', tripId: TRIP.id, updatedAt: T, deletedAt: null }
    const claim: Claim = { id: 'c', date: '2026-11-23', tripId: TRIP.id, status: 'ingediend', updatedAt: T, deletedAt: null }
    const trip: Trip = { ...TRIP, closedAt: '2026-11-29', messages: { introductie: { status: 'verstuurd', date: '2026-11-18' }, boodschappen: { status: 'niet-nodig', date: '2026-11-19' } } }
    const all = data({ trips: [trip], plans: [plan], transactions: [tip], claims: [claim] })
    expect(kinds(todayTasks(all, '2026-11-30'))).toEqual(['safety', 'afsluiting'])
    expect(weekTasksOf(trip, all).find((x) => x.kind === 'introductie')).toMatchObject({ done: 'verstuurd', doneDate: '2026-11-18' })
    expect(weekTasksOf(trip, all).find((x) => x.kind === 'fooi')!.done).toBe('vanzelf')
    // Een open declaratie: nog niet gedaan. Zonder declaraties: alleen met een tik.
    expect(kinds(todayTasks(data({ claims: [{ ...claim, status: 'open' }] }), '2026-11-30'))).toContain('declaraties')
    expect(kinds(todayTasks(data(), '2026-11-30'))).toContain('declaraties')
  })

  it('afvinken via een opdracht: een taak in trip.tasks, een bericht in trip.messages, met ongedaan maken', async () => {
    const s = await device()
    await put(s, 'trips.json.enc', TRIP)
    const trip = () => s.list('trips.json.enc').find((x) => x.id === TRIP.id)!
    const undo = await taakMarkeren(s, TRIP.id, 'safety', 'gedaan', '2026-11-22')
    expect(trip().tasks).toEqual({ safety: { status: 'gedaan', date: '2026-11-22' } })
    await undo()
    expect(trip().tasks?.safety).toBeUndefined()
    await taakMarkeren(s, TRIP.id, 'safety', 'gedaan', '2026-11-22')
    await taakMarkeren(s, TRIP.id, 'boodschappen', 'gedaan', '2026-11-20')
    expect(trip().messages).toEqual({ boodschappen: { status: 'verstuurd', date: '2026-11-20' } })
    await taakMarkeren(s, TRIP.id, 'declaraties', 'niet-nodig', '2026-11-29')
    expect(trip().tasks?.declaraties).toEqual({ status: 'niet-nodig', date: '2026-11-29' })
    expect(trip().tasks?.safety).toEqual({ status: 'gedaan', date: '2026-11-22' })
  })
})

describe('boodschappenlijst', () => {
  it('een vaste soort bericht met een meegeleverde lijst die zonder namen deelbaar is', () => {
    const templates = effectiveTemplates([])
    expect(messageKinds(templates).map((k) => k.kind)).toEqual(['introductie', 'boodschappen', 'afsluiting'])
    const list = templates.find((x) => x.id === 'seed-boodschappen-en')!
    const filled = fillTemplate(list, messageValues({ ...TRIP, participants: [] }, { legs: [], places: [], settings: {} }, 'en'))
    expect(filled.missing).toEqual([])
    expect(filled.text).toContain('We shop together on Sunday.')
  })
})

describe('schemaversie 10', () => {
  it('leest trips en instellingen van versie 9 ongewijzigd in (zonder taken)', () => {
    const v9 = (records: readonly unknown[]) => new TextEncoder().encode(JSON.stringify({ format: 'logboek-collection', schemaVersion: 9, minWriterVersion: 15, records }))
    expect(decodeRecords('trips.json.enc', v9([TRIP]))).toEqual([TRIP])
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(10)
    expect(WRITER_VERSION).toBeGreaterThanOrEqual(16)
  })
})
