import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptObject, toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta } from '../src/crypto/keys'
import { errorReport } from '../src/errors'
import type { Trip } from '../src/model/types'
import { classify, evidenceLines } from '../src/storage/evidence'
import { GithubClient, IntegrityError } from '../src/storage/github'
import { openLogboekDb, putObject } from '../src/storage/idb'
import { gitBlobSha, integrityEvents } from '../src/storage/integrity'
import { Store } from '../src/storage/store'
import { encryptRecords } from '../src/storage/sync'
import { newerBuildStarted, noteStartedBuild } from '../src/storage/versions'
import { FakeGithub, gitSha } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// Onleesbare bestanden: het bewijs uit de echte omgeving (wie schreef wat, met welke versie, en wat de app ermee kan),
// de controle van elk antwoord op zijn git-sha, "Alles herstellen" met teruglezen via de blob-sha, en één schrijver over
// versies heen. Alle gegevens verzonnen.

const TOKEN = 'github_pat_BEWIJS_0123456789abcdefghijklmnopqrstuvwxyz'
const T = '2026-10-29T10:00:00.000Z'
const wordlist = parseWordlistForTests()
let k1: Awaited<ReturnType<typeof createVault>>
let k2: Awaited<ReturnType<typeof createVault>>
let github: FakeGithub
let counter = 0

class MemoryStorage {
  private readonly items = new Map<string, string>()
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
}

beforeAll(async () => {
  k1 = await createVault('nep wachtzin van het bewijs', wordlist)
  k2 = await createVault('nep wachtzin van een ander logboek', wordlist)
}, 30_000)

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  github = new FakeGithub()
  github.realShas = true
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

async function device(): Promise<Store> {
  const db = await openLogboekDb(`logboek-bewijs-${++counter}`)
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: github.files.get(META_PATH)!.sha })
  const store = await Store.open(db, k1.masterKey, new GithubClient(TOKEN, github.fetch), k1.meta.check ?? null)
  return store
}

const trip = (id: string): Trip => ({ id, name: 'Neptrip', updatedAt: T, deletedAt: null })

describe('elk antwoord tegen zijn git-sha', () => {
  it('git-blob-sha zoals GitHub hem berekent', async () => {
    expect(await gitBlobSha(utf8('nep\n'))).toBe(gitSha(Buffer.from('nep\n').toString('base64')))
  })

  it('een beschadigd antwoord van de contents-API: opnieuw via de blob-API, gemeld, geen onleesbaar bestand', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    expect(phone.getStatus()).toEqual({ kind: 'synced' })
    github.corruptReads = 3
    await phone.sync()
    expect(phone.getStatus()).toEqual({ kind: 'synced' })
    expect(github.requests.some((r) => r.url.includes('/git/blobs/'))).toBe(true)
    expect(phone.storageLog().integrity?.some((e) => e.phase === 'lezen' && e.repaired)).toBe(true)
  })

  it('klopt ook de blob-API niet, dan stopt de sync en wordt er niets geschreven', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    await phone.put('trips.json.enc', trip('t2'))
    github.corruptReads = 50
    github.corruptBlobs = true
    const puts = github.requests.filter((r) => r.method === 'PUT').length
    await phone.sync()
    expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'github', github: 'integrity' })
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(puts)
  })

  it('GitHub bewaarde iets anders dan verstuurd: gemeld als integriteit, nooit als gelukt', async () => {
    const client = new GithubClient(TOKEN, github.fetch)
    github.storeDifferently = true
    await expect(client.putFile('trips.json.enc', await encryptRecords(k1.masterKey, 'trips.json.enc', [trip('t1')]), null)).rejects.toBeInstanceOf(IntegrityError)
    expect(integrityEvents().some((e) => e.phase === 'schrijven' && e.path === 'trips.json.enc')).toBe(true)
  })

  it('elk verzoek naar GitHub buiten de browsercache (no-store)', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    await phone.check(false, -1)
    expect(github.requests.length).toBeGreaterThan(5)
    expect(github.requests.every((r) => r.cache === 'no-store')).toBe(true)
  })
})

describe('bewijs per onleesbaar bestand', () => {
  it('soort uitkomst: leesbaar, leeg, ander formaat, andere sleutel, onder de verkeerde naam, ongeldig', async () => {
    const good = await encryptRecords(k1.masterKey, 'settings.json.enc', [])
    expect(await classify(k1.masterKey, 'settings.json.enc', good)).toBe('leesbaar')
    expect(await classify(k1.masterKey, 'settings.json.enc', new Uint8Array(0))).toBe('leeg')
    expect(await classify(k1.masterKey, 'settings.json.enc', utf8('{"format":"logboek-collection"}'))).toBe('formaat')
    expect(await classify(k1.masterKey, 'settings.json.enc', await encryptRecords(k2.masterKey, 'settings.json.enc', []))).toBe('sleutel')
    expect(await classify(k1.masterKey, 'settings.json.enc', await encryptRecords(k1.masterKey, 'places.json.enc', []))).toBe('ander-pad:places.json.enc')
    expect(await classify(k1.masterKey, 'settings.json.enc', await encryptObject(k1.masterKey, 'settings.json.enc', utf8('{"nep":1}')))).toBe('ongeldig:soort')
    expect(await classify(k1.masterKey, 'settings.json.enc', await encryptObject(k1.masterKey, 'settings.json.enc', utf8('{"format":"logboek-collection","schemaVersion":1,"records":[{"id":"x"}]}')))).toBe('ongeldig:record')
  })

  it('na een sync met een onleesbaar bestand: de versie nu en de commits, met apparaat en versie uit het commitbericht', async () => {
    const phone = await device()
    await phone.put('settings.json.enc', { id: 'settings', updatedAt: T, deletedAt: null } as never)
    await phone.sync()
    // Een tweede schrijver met een andere sleutel (apparaat abcdef12, oudere versie) zet er een onleesbare versie neer.
    github.write('settings.json.enc', toBase64(await encryptRecords(k2.masterKey, 'settings.json.enc', [])), 'sync 2026-10-29T23:44:00.000Z v1.0.0+0ld0000 dabcdef12')
    await phone.sync()
    expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['settings.json.enc'] })
    await expect.poll(() => phone.storageLog().evidence?.length ?? 0).toBe(1)
    const evidence = phone.storageLog().evidence![0]!
    expect(evidence.path).toBe('settings.json.enc')
    expect(evidence.current).toMatchObject({ verdict: 'sleutel', firstByte: 1 })
    expect(evidence.commits[0]).toMatchObject({ device: 'abcdef12', version: '1.0.0+0ld0000', verdict: 'sleutel' })
    expect(evidence.commits[1]).toMatchObject({ verdict: 'leesbaar' })
    expect(evidence.commits[1]!.blob).toMatch(/^[0-9a-f]{12}$/)
    // In de foutdetails: het bewijs, zonder inhoud.
    const report = errorReport(new Error('nep'), 'Opslag', T)
    expect(report).toContain('Bewijs settings.json.enc')
    expect(report).toContain('dabcdef12')
    expect(report).toContain('Onleesbaar nu: settings.json.enc (DecryptError/sleutel)')
    const lines = evidenceLines([evidence], 'dit').join('\n')
    expect(lines).not.toMatch(/Nep|settings"/)
  })
})

describe('Alles herstellen', () => {
  it('de leesbare kopie terug, een leeg bestand waar dit apparaat niets heeft; teruggelezen via de blob-sha', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    // Twee bestanden onleesbaar op GitHub: trips (dit apparaat heeft een kopie) en students (geen records hier).
    github.write('trips.json.enc', toBase64(await encryptRecords(k2.masterKey, 'trips.json.enc', [])), 'sync 2026-10-29T23:44:00.000Z v1.0.0+0ld0000 dabcdef12')
    github.write('students.json.enc', toBase64(await encryptRecords(k2.masterKey, 'students.json.enc', [])), 'sync 2026-10-29T23:44:00.000Z v1.0.0+0ld0000 dabcdef12')
    await phone.sync()
    expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable' })
    const results = await phone.repairAll()
    expect(results.map((r) => [r.path, r.ok]).sort()).toEqual([
      ['students.json.enc', true],
      ['trips.json.enc', true],
    ])
    expect(phone.getStatus()).toEqual({ kind: 'synced' })
    // Teruggelezen via de blob-sha van wat net geschreven is.
    const tripsSha = github.files.get('trips.json.enc')!.sha
    expect(github.requests.some((r) => r.url.endsWith(`/git/blobs/${tripsSha}`))).toBe(true)
    // Het bewijs van vóór het overschrijven staat er nog.
    expect(phone.storageLog().evidence?.map((e) => e.path).sort()).toEqual(['students.json.enc', 'trips.json.enc'])
    // Een schoon apparaat leest alles.
    const clean = await device()
    await clean.sync()
    expect(clean.getStatus()).toEqual({ kind: 'synced' })
    expect(clean.list('trips.json.enc').map((r) => r.id)).toEqual(['t1'])
  })

  it('niets onleesbaar: niets geschreven', async () => {
    const phone = await device()
    await phone.sync()
    const puts = github.requests.filter((r) => r.method === 'PUT').length
    expect(await phone.repairAll()).toEqual([])
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(puts)
  })
})

describe('één schrijver over versies heen', () => {
  it('na een nieuwere gestarte build schrijft een ouder venster niet; dezelfde of een oudere build telt niet', () => {
    noteStartedBuild('1.0.0+nieuw00', '2026-10-30T10:00:00-04:00')
    expect(newerBuildStarted('1.0.0+oud0000', '2026-10-29T18:00:00-04:00')).toBe(true)
    expect(newerBuildStarted('1.0.0+nieuw00', '2026-10-30T10:00:00-04:00')).toBe(false)
    expect(newerBuildStarted('1.0.0+later00', '2026-10-31T10:00:00-04:00')).toBe(false)
    // Zonder bouwdatum (tests, dev): geen bewaking.
    expect(newerBuildStarted('dev+dev', '')).toBe(false)
    // Een pagina die start, is altijd de geldende: ook een oudere uitgerolde versie sluit zichzelf niet buiten.
    noteStartedBuild('1.0.0+oud0000', '2026-10-29T18:00:00-04:00')
    expect(newerBuildStarted('1.0.0+oud0000', '2026-10-29T18:00:00-04:00')).toBe(false)
  })
})
