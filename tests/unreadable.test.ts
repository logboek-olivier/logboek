import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta, type Meta } from '../src/crypto/keys'
import { errorReport, lastError } from '../src/errors'
import type { Trip, WeekPlan } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb, type Db } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { encryptRecords } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'
import { put } from './helpers/schrijf'

// Scenario uit de foutdetails (DecryptError bij sync): een apparaat met een andere hoofdsleutel (bijvoorbeeld nog
// gekoppeld aan een eerder, opnieuw aangemaakt logboek-data) schrijft een bestand dat de andere apparaten niet
// kunnen ontsleutelen. Alle data is verzonnen.

const TOKEN = 'github_pat_UNREADABLE_0123456789abcdefghijklmnopqrstuvwxyz'
let counter = 0
let ours: { meta: Meta; masterKey: CryptoKey }
let theirs: { meta: Meta; masterKey: CryptoKey }

beforeAll(async () => {
  const words = parseWordlistForTests()
  ours = await createVault('nep wachtzin een', words)
  theirs = await createVault('nep wachtzin twee', words)
}, 30_000)

async function device(github: FakeGithub, vault = ours, withMeta = true): Promise<{ db: Db; store: Store }> {
  const db = await openLogboekDb(`logboek-unreadable-${++counter}`)
  if (withMeta) await Store.storeMeta(db, vault.meta, null)
  return { db, store: await Store.open(db, vault.masterKey, new GithubClient(TOKEN, github.fetch)) }
}

function trip(id: string, name: string): Trip {
  return { id, name, updatedAt: new Date().toISOString(), deletedAt: null }
}

function plan(id: string): WeekPlan {
  return { id, title: 'Nepweek', startDate: '2026-10-26', dayCount: 1, groups: [], days: [{ date: '2026-10-26', blocks: [] }], updatedAt: new Date().toISOString(), deletedAt: null }
}

function puts(github: FakeGithub): string[] {
  return github.requests.filter((r) => r.method === 'PUT').map((r) => r.url)
}

async function pollute(github: FakeGithub, path: 'plans.json.enc'): Promise<string> {
  // Zelfde formaat en pad, maar versleuteld onder de andere hoofdsleutel.
  return github.write(path, toBase64(await encryptRecords(theirs.masterKey, path, [plan('vreemd')])))
}

describe('onleesbaar bestand op GitHub', () => {
  it('synct de andere bestanden, noemt het pad in status en foutdetails, en biedt herstel met de lokale kopie', async () => {
    const github = new FakeGithub()
    github.write(META_PATH, toBase64(utf8(serializeMeta(ours.meta))))
    const a = await device(github)
    await put(a.store, 'plans.json.enc', plan('p1'))
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })

    const pollutedSha = await pollute(github, 'plans.json.enc')
    await put(a.store, 'trips.json.enc', trip('t1', 'Nephaven'))
    await a.store.sync()

    expect(a.store.getStatus()).toEqual({ kind: 'error', code: 'unreadable', count: 0, paths: ['plans.json.enc'] })
    // De andere bestanden zijn gewoon gesynct.
    const b = await device(github)
    await b.store.sync()
    expect(b.store.list('trips.json.enc').map((t) => t.id)).toEqual(['t1'])
    // Foutdetails: alleen het pad en de soort fout, geen inhoud.
    const report = errorReport(lastError()!.error, 'Training', '2026-10-26T10:00:00.000Z')
    expect(report).toContain('Foutcode: UnreadableFileError')
    expect(report).toContain('plans.json.enc')
    expect(report).toContain('DecryptError')
    expect(report).not.toContain('Nephaven')
    expect(report).not.toContain('Nepweek')
    // Niets automatisch overschreven.
    expect(github.files.get('plans.json.enc')!.sha).toBe(pollutedSha)

    // Herstel alleen op verzoek: A heeft een leesbare kopie, B (vers apparaat zonder plannen) niet.
    expect(await a.store.repairable()).toEqual(['plans.json.enc'])
    expect(await b.store.repairable()).toEqual([])
    await a.store.repair('plans.json.enc')
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
    const c = await device(github)
    await c.store.sync()
    expect(c.store.getStatus()).toEqual({ kind: 'synced' })
    expect(c.store.list('plans.json.enc').map((p) => p.id)).toEqual(['p1'])
  })

  it('zonder lokale kopie: niets wissen en niets schrijven voor dat bestand', async () => {
    const github = new FakeGithub()
    github.write(META_PATH, toBase64(utf8(serializeMeta(ours.meta))))
    const sha = await pollute(github, 'plans.json.enc')
    const fresh = await device(github)
    await fresh.store.sync()
    expect(fresh.store.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['plans.json.enc'] })
    expect(await fresh.store.repairable()).toEqual([])
    await fresh.store.repair('plans.json.enc')
    expect(github.files.get('plans.json.enc')!.sha).toBe(sha)
    expect(puts(github).some((u) => u.includes('plans.json.enc'))).toBe(false)
  })
})

describe('herstellen is voorzichtig', () => {
  it('overschrijft niet als een ander apparaat het bestand ondertussen al herstelde', async () => {
    const github = new FakeGithub()
    github.write(META_PATH, toBase64(utf8(serializeMeta(ours.meta))))
    const a = await device(github)
    await put(a.store, 'plans.json.enc', plan('p1'))
    await a.store.sync()
    const b = await device(github)
    await b.store.sync()
    await put(b.store, 'plans.json.enc', plan('p2'))
    await pollute(github, 'plans.json.enc')
    await a.store.sync()
    await b.store.sync()
    expect(await a.store.repairable()).toEqual(['plans.json.enc'])
    await b.store.repair('plans.json.enc')
    const repairedSha = github.files.get('plans.json.enc')!.sha
    // A tikt later op de (nog zichtbare) knop: het bestand is weer leesbaar, dus A schrijft zijn oudere kopie niet.
    await a.store.repair('plans.json.enc')
    const c = await device(github)
    await c.store.sync()
    expect(c.store.list('plans.json.enc').map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(github.files.get('plans.json.enc')!.sha).toBe(repairedSha)
  })

  it('een bestand dat wel ontsleutelt maar ongeldig is: nooit vanzelf overschreven, wel met één tik (geen doodlopende melding)', async () => {
    const github = new FakeGithub()
    github.write(META_PATH, toBase64(utf8(serializeMeta(ours.meta))))
    const a = await device(github)
    await put(a.store, 'plans.json.enc', plan('p1'))
    await a.store.sync()
    const { encryptObject } = await import('../src/crypto/encrypt')
    const sha = github.write('plans.json.enc', toBase64(await encryptObject(ours.masterKey, 'plans.json.enc', utf8('{"geen":"logboek"}'))))
    await a.store.sync()
    expect(a.store.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['plans.json.enc'] })
    expect(github.files.get('plans.json.enc')!.sha).toBe(sha)
    expect(await a.store.repairable()).toEqual(['plans.json.enc'])
    await a.store.repair('plans.json.enc')
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
  })

  it('geen herstel zonder bevestigde meta (geen meta-controle mogelijk)', async () => {
    const github = new FakeGithub()
    const a = await device(github, ours, false)
    await put(a.store, 'plans.json.enc', plan('p1'))
    await put(a.store, 'trips.json.enc', trip('t1', 'Echt'))
    await a.store.sync()
    await pollute(github, 'plans.json.enc')
    await a.store.sync()
    expect(a.store.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable' })
    expect(await a.store.repairable()).toEqual([])
  })
})

describe('apparaat met een andere hoofdsleutel', () => {
  it('schrijft niets als meta.json.enc op GitHub ontbreekt terwijl dit apparaat een logboek heeft (repo opnieuw aangemaakt)', async () => {
    const github = new FakeGithub()
    const stale = await device(github)
    await put(stale.store, 'trips.json.enc', trip('t1', 'Oud'))
    await stale.store.sync()
    expect(stale.store.getStatus()).toEqual({ kind: 'error', code: 'noMeta', count: 1 })
    expect(puts(github)).toEqual([])
  })

  it('schrijft niets naar GitHub als meta.json.enc bij een andere sleutel hoort', async () => {
    const github = new FakeGithub()
    github.write(META_PATH, toBase64(utf8(serializeMeta(ours.meta))))
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'Echt'))
    await a.store.sync()
    const before = puts(github).length
    const planSha = github.files.get('plans.json.enc')!.sha

    // Het oude apparaat (andere sleutel, eigen lokale meta) heeft een nieuwe planning en synct.
    const stale = await device(github, theirs)
    await put(stale.store, 'plans.json.enc', plan('oud'))
    await stale.store.sync()
    expect(stale.store.getStatus()).toEqual({ kind: 'error', code: 'otherKey', count: 1 })
    expect(puts(github).length).toBe(before)
    expect(github.files.get('plans.json.enc')!.sha).toBe(planSha)
    expect(await stale.store.repairable()).toEqual([])
  })

  it('zonder meta: geen enkel bestand leesbaar en meerdere niet te ontsleutelen telt ook als andere sleutel', async () => {
    const github = new FakeGithub()
    const a = await device(github, ours, false)
    await put(a.store, 'trips.json.enc', trip('t1', 'Echt'))
    await put(a.store, 'plans.json.enc', plan('p1'))
    await a.store.sync()
    const stale = await device(github, theirs, false)
    await put(stale.store, 'students.json.enc', { id: 's1', firstName: 'Nep', curriculumId: 'c', level: 'beginner', progress: {}, archivedAt: null, updatedAt: new Date().toISOString(), deletedAt: null })
    const before = puts(github).length
    await stale.store.sync()
    expect(stale.store.getStatus()).toMatchObject({ kind: 'error', code: 'otherKey' })
    expect(puts(github).length).toBe(before)
  })

  it('een gewijzigde wachtzin op een ander apparaat (zelfde sleutel, andere meta) blokkeert niets', async () => {
    const github = new FakeGithub()
    const { changePassphrase } = await import('../src/crypto/keys')
    const changed = await changePassphrase(ours.meta, { passphrase: 'nep wachtzin een' }, 'nep wachtzin drie')
    github.write(META_PATH, toBase64(utf8(serializeMeta(changed))))
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'Echt'))
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
  }, 30_000)
})
