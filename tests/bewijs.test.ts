import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptObject, toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta } from '../src/crypto/keys'
import { errorReport } from '../src/errors'
import type { Trip } from '../src/model/types'
import { classify, evidenceLines } from '../src/storage/evidence'
import { AuthError, GithubClient, GithubError, IntegrityError } from '../src/storage/github'
import { openLogboekDb, putObject } from '../src/storage/idb'
import { gitBlobSha, integrityEvents } from '../src/storage/integrity'
import { Store } from '../src/storage/store'
import { NewerSchemaError } from '../src/model/schema'
import { encryptRecords, LocalInvalidError, sealForUpload } from '../src/storage/sync'
import { newerBuildStarted, noteStartedBuild, ownBuildForTests } from '../src/storage/versions'
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

  it('klopt het antwoord voor één databestand niet: dat bestand wordt niet geschreven, de andere wel', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    await phone.put('trips.json.enc', trip('t2'))
    await phone.put('places.json.enc', { id: 'p1', name: 'Nephaven', lat: 18.4, lon: -64.6, updatedAt: T, deletedAt: null })
    github.corruptOnly = 'trips.json.enc'
    github.corruptReads = 50
    github.corruptBlobs = true
    const tripsSha = github.files.get('trips.json.enc')!.sha
    const placesSha = github.files.get('places.json.enc')!.sha
    await phone.sync()
    expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'github', github: 'integrity' })
    expect(github.files.get('trips.json.enc')!.sha).toBe(tripsSha)
    expect(github.files.get('places.json.enc')!.sha).not.toBe(placesSha)
    // Daarna klopt GitHub weer: de volgende sync stuurt de wachtende trip.
    github.corruptReads = 0
    github.corruptBlobs = false
    await phone.sync()
    expect(phone.getStatus()).toEqual({ kind: 'synced' })
    expect(github.files.get('trips.json.enc')!.sha).not.toBe(tripsSha)
  })

  it('een (secundaire) limiet van GitHub is geen tokenfout', async () => {
    const answers = [
      new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 403 }),
      new Response('{}', { status: 403, headers: { 'retry-after': '60' } }),
      new Response('{}', { status: 429 }),
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ]
    for (const answer of answers) {
      const client = new GithubClient(TOKEN, () => Promise.resolve(answer))
      const error: unknown = await client.getFile('trips.json.enc').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(GithubError)
      expect(error).not.toBeInstanceOf(AuthError)
      expect((error as GithubError).code).toBe('rateLimit')
    }
    // Een gewone 403 blijft een tokenfout.
    const plain = new GithubClient(TOKEN, () => Promise.resolve(new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 })))
    await expect(plain.getFile('trips.json.enc')).rejects.toBeInstanceOf(AuthError)
  })

  it('een ongeldig record op dit apparaat is een fout hier, geen onleesbaar bestand op GitHub', async () => {
    await expect(sealForUpload(k1.masterKey, 'trips.json.enc', [{ name: 'zonder id' } as unknown as Trip])).rejects.toBeInstanceOf(LocalInvalidError)
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
  it('een bestand dat wel ontsleutelt maar één kapot record heeft: de goede records van een ander apparaat blijven', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    // Een ander apparaat schreef twee goede trips; één record mist zijn id (wel deze sleutel, dus wel te ontsleutelen).
    const file = { format: 'logboek-collection', schemaVersion: 1, records: [trip('elders-1'), trip('elders-2'), { name: 'kapot', updatedAt: T }] }
    github.write('trips.json.enc', toBase64(await encryptObject(k1.masterKey, 'trips.json.enc', utf8(JSON.stringify(file)))))
    await phone.sync()
    expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['trips.json.enc'] })
    expect(await phone.repairAll()).toEqual([{ path: 'trips.json.enc', ok: true }])
    expect(phone.getStatus()).toEqual({ kind: 'synced' })
    expect(phone.list('trips.json.enc').map((r) => r.id)).toEqual(['elders-1', 'elders-2', 't1'])
    const clean = await device()
    await clean.sync()
    expect(clean.list('trips.json.enc').map((r) => r.id)).toEqual(['elders-1', 'elders-2', 't1'])
  })

  it('meteen na het herstel schrijft een ander apparaat er weer iets onleesbaars overheen: niet hersteld, met dat apparaat', async () => {
    const phone = await device()
    await phone.put('trips.json.enc', trip('t1'))
    await phone.sync()
    const foreign = toBase64(await encryptRecords(k2.masterKey, 'trips.json.enc', []))
    const message = 'sync 2026-10-30T01:00:00.000Z v1.0.0+0ld0000 dabcdef12'
    github.write('trips.json.enc', foreign, message)
    await phone.sync()
    // Een nieuwe versie van dezelfde schrijver (nieuwe iv, dus een andere sha dan de vervangen versie).
    const foreignAgain = toBase64(await encryptRecords(k2.masterKey, 'trips.json.enc', []))
    let again = true
    github.afterPut = (path) => {
      if (path !== 'trips.json.enc' || !again) return
      again = false
      github.write(path, foreignAgain, message.replace('01:00', '01:01'))
    }
    const results = await phone.repairAll()
    github.afterPut = null
    expect(results).toEqual([{ path: 'trips.json.enc', ok: false, overwrittenBy: { device: 'abcdef12', version: '1.0.0+0ld0000' } }])
    expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['trips.json.enc'] })
  })
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
  it('een venster dat midden in een ronde hervat nadat een nieuwere versie startte: geen enkele schrijfactie meer', async () => {
    ownBuildForTests('1.0.0+oud0000', '2026-10-29T18:00:00-04:00')
    try {
      const phone = await device()
      await phone.put('trips.json.enc', trip('t1'))
      // Na de eerste schrijfactie start in een ander venster een nieuwere versie.
      github.afterPut = () => noteStartedBuild('1.0.0+nieuw00', '2026-10-30T10:00:00-04:00')
      await phone.sync()
      github.afterPut = null
      expect(github.requests.filter((r) => r.method === 'PUT')).toHaveLength(1)
      expect(phone.getStatus()).toMatchObject({ kind: 'error', code: 'update' })
      // Ook buiten de sync (herstel, wachtzin wijzigen, de eerste keer) gaat er niets meer weg.
      await expect(new GithubClient(TOKEN, github.fetch).putFile('trips.json.enc', new Uint8Array([1]), null)).rejects.toBeInstanceOf(NewerSchemaError)
    } finally {
      ownBuildForTests('', '')
    }
  })

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
