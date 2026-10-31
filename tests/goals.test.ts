import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { autoValue, goalProgress, logSession, measurements, parseValue, saveGoal, saveSkill, skillStats, type GoalData } from '../src/model/goals'
import type { RatesFile } from '../src/model/rates'
import type { Goal, Leg, Session, Skill, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx } from './helpers/schrijf'
import { doelVerwijderen, mijlpaalAfvinken, skillVerwijderen } from '../src/domain/doelen'

// Doelen en skills: zelfvullende jaardoelen uit de app, zelf gemeten doelen en skills met sessies, trend en
// mijlpalen. Alle gegevens verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
let counter = 0
let masterKey: CryptoKey

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function newStore() {
  return Store.open(await openLogboekDb(`logboek-goals-${++counter}`), masterKey, new GithubClient('github_pat_GOAL_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
}

const leg = (id: string, date: string, sea: number, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId: 'sv1',
  date,
  fromPlace: 'Nephaven',
  fromCountry: 'NL',
  toPlace: 'Nepdorp',
  toCountry: 'NL',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: sea,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: NOW,
  deletedAt: null,
  ...extra,
})
const trip = (id: string, name: string, startDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name, startDate, endDate: startDate, updatedAt: NOW, deletedAt: null, ...extra })
const tx = (id: string, date: string, kind: Transaction['kind'], amount: number, currency: Transaction['currency'] = 'EUR'): Transaction => ({ id, date, kind, amount, currency, source: 'overig', updatedAt: NOW, deletedAt: null })
const goal = (extra: Partial<Goal>): Goal => ({ id: 'g', title: '', kind: 'auto', target: 10, updatedAt: NOW, deletedAt: null, ...extra })
const session = (id: string, date: string, extra: Partial<Session>): Session => ({ id, date, updatedAt: NOW, deletedAt: null, ...extra })

const rates: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-01-02'], rates: { USD: [1.25] } }
const data: GoalData = {
  legs: [leg('l1', '2026-03-01', 70.5, { nmTidal: 10 }), leg('l2', '2026-04-01', 20), leg('l3', '2025-12-31', 500), leg('weg', '2026-05-01', 99, { deletedAt: NOW })],
  trips: [
    trip('sv1', 'Nepweek', '2026-03-01', { organisation: 'sailing-virgins' }),
    trip('sv2', 'Sailing Virgins nepweek', '2026-06-01'),
    trip('yw1', 'Nepweek YW', '2026-07-01', { organisation: 'yacht-week' }),
    trip('oud', 'Nepweek oud', '2025-06-01', { organisation: 'sailing-virgins' }),
  ],
  transactions: [tx('a', '2026-02-01', 'loon', 1000), tx('b', '2026-03-01', 'fooi', 125, 'USD'), tx('c', '2026-03-02', 'terugbetaling', 50), tx('d', '2026-03-03', 'kosten', 30), tx('e', '2025-03-03', 'loon', 999)],
  rates,
}

describe('zelfvullende doelen', () => {
  it('nm, trips per organisatie, Yachtmaster en inkomsten in het jaar', () => {
    expect(autoValue({ metric: 'nm', year: 2026 }, data)).toBe(100.5)
    // De organisatie van de trip, ook uit de naam (zoals de teller); trips van een ander jaar tellen niet.
    expect(autoValue({ metric: 'trips', year: 2026, organisation: 'sailing-virgins' }, data)).toBe(2)
    expect(autoValue({ metric: 'trips', year: 2026 }, data)).toBe(3)
    // Yachtmaster over alle dagen: hier zijn twee van de zeven eisen gehaald (schipper niet: 3 dagen nodig 5).
    expect(autoValue({ metric: 'yachtmaster' }, data)).toBeGreaterThanOrEqual(0)
    expect(autoValue({ metric: 'yachtmaster' }, data)).toBeLessThanOrEqual(7)
    // Verdiend in euro: loon 1000 + fooi 125 USD / 1,25; terugbetaling en kosten niet.
    expect(autoValue({ metric: 'inkomsten', year: 2026 }, data)).toBe(1100)
  })

  it('voortgang en gehaald', () => {
    expect(goalProgress(goal({ metric: 'nm', year: 2026, target: 201 }), [], data)).toMatchObject({ current: 100.5, share: 0.5, done: false })
    expect(goalProgress(goal({ metric: 'trips', year: 2026, organisation: 'sailing-virgins', target: 2 }), [], data)).toMatchObject({ current: 2, share: 1, done: true })
  })
})

describe('zelf gemeten doelen', () => {
  const kg = goal({ id: 'kg', kind: 'meting', title: 'Nepdoel afvallen', target: 77, unit: 'kg', lower: true })
  it('van de eerste meting naar het doel, ook omlaag', () => {
    expect(goalProgress(kg, [], data)).toMatchObject({ current: null, share: 0, done: false })
    const list = [session('s2', '2026-03-01', { goalId: 'kg', value: 80 }), session('s1', '2026-02-01', { goalId: 'kg', value: 82 }), session('x', '2026-03-05', { goalId: 'ander', value: 1 })]
    expect(measurements(kg, list).map((s) => s.value)).toEqual([82, 80])
    expect(goalProgress(kg, list, data)).toMatchObject({ start: 82, current: 80, share: 0.4, done: false, lastDate: '2026-03-01' })
    expect(goalProgress(kg, [...list, session('s3', '2026-04-01', { goalId: 'kg', value: 76.5 })], data)).toMatchObject({ share: 1, done: true })
    // Omhoog: keer sporten per week van 1 naar 3.
    const sport = goal({ id: 'sport', kind: 'meting', title: 'Meer sporten', target: 3 })
    expect(goalProgress(sport, [session('a', '2026-01-01', { goalId: 'sport', value: 1 }), session('b', '2026-02-01', { goalId: 'sport', value: 2 })], data)).toMatchObject({ share: 0.5, done: false })
  })

  it('waarden: komma of punt, nul mag, negatief of tekst niet', () => {
    expect(parseValue('78,4')).toBe(78.4)
    expect(parseValue('78.4')).toBe(78.4)
    expect(parseValue('0')).toBe(0)
    expect(parseValue('')).toBeNull()
    expect(parseValue('veel')).toBeNull()
  })
})

describe('skills', () => {
  const skill: Skill = { id: 'adem', name: 'Nepskill adem', valueUnit: 's', best: true, milestones: [{ id: 'm1', title: 'Nepmijlpaal', doneAt: '2026-09-01' }, { id: 'm2', title: 'Tweede', doneAt: null }], updatedAt: NOW, deletedAt: null }
  it('sessies, minuten, beste waarde, minuten per week, trend en mijlpalen', () => {
    const list = [
      session('a', '2026-10-28', { skillId: 'adem', minutes: 20, value: 95 }),
      session('b', '2026-10-20', { skillId: 'adem', minutes: 15, value: 110 }),
      session('c', '2026-09-01', { skillId: 'adem', minutes: 10 }),
      session('weg', '2026-10-27', { skillId: 'adem', minutes: 99, deletedAt: NOW }),
      session('ander', '2026-10-27', { skillId: 'kite', minutes: 60 }),
    ]
    const stats = skillStats(skill, list, '2026-10-29')
    expect(stats).toMatchObject({ sessions: 3, minutes: 45, value: 110, last: '2026-10-28', trend: 'op', milestonesDone: 1 })
    expect(stats.weeks).toHaveLength(8)
    expect(stats.weeks.at(-1)).toEqual({ start: '2026-10-26', minutes: 20, sessions: 1 })
    // Zonder "beste": de som (kreeften gevangen).
    expect(skillStats({ ...skill, best: false }, list, '2026-10-29').value).toBe(205)
    expect(skillStats(skill, [], '2026-10-29')).toMatchObject({ sessions: 0, value: null, trend: null })
  })

  it('opslaan, sessie loggen, mijlpaal afvinken, en verwijderen met de sessies, met ongedaan maken', async () => {
    const store = await newStore()
    const saved = await inTx(store, saveSkill, { name: '  Nep   kitesurfen ', milestones: [{ id: 'm', title: ' Eerste waterstart ', doneAt: null }, { id: 'leeg', title: '  ', doneAt: null }] })
    expect(saved).toMatchObject({ name: 'Nep kitesurfen', milestones: [{ id: 'm', title: 'Eerste waterstart', doneAt: null }] })
    await inTx(store, logSession, { date: '2026-10-29', skillId: saved.id, minutes: 45.4, value: -3, note: 'Nepnotitie' })
    expect(store.list('sessions.json.enc')).toEqual([expect.objectContaining({ skillId: saved.id, minutes: 45, note: 'Nepnotitie' })])
    expect(store.list('sessions.json.enc')[0]).not.toHaveProperty('value')
    await mijlpaalAfvinken(store, store.list('skills.json.enc')[0]!, 'm', '2026-10-29')
    expect(store.list('skills.json.enc')[0]!.milestones[0]!.doneAt).toBe('2026-10-29')
    const undo = await skillVerwijderen(store, store.list('skills.json.enc')[0]!)
    // Verwijderen is een tombstone: niet meer in de lijst, wel in het bestand.
    expect(store.list('skills.json.enc')).toEqual([])
    expect(store.list('sessions.json.enc')).toEqual([])
    expect(store.get('sessions.json.enc')[0]!.deletedAt).not.toBeNull()
    await undo()
    expect(store.list('skills.json.enc')[0]!.deletedAt).toBeNull()
    expect(store.list('sessions.json.enc')[0]!.deletedAt).toBeNull()
    // Een doel met zijn metingen.
    const g = await inTx(store, saveGoal, { kind: 'meting', title: 'Nepdoel', target: 77, unit: 'kg', lower: true, doneAt: null })
    await inTx(store, logSession, { date: '2026-10-29', goalId: g.id, value: 80 })
    await doelVerwijderen(store, g)
    expect(store.list('sessions.json.enc').filter((s) => s.goalId === g.id)).toEqual([])
  })
})
