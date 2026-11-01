import 'fake-indexeddb/auto'
import { COLLECTION_PATHS } from '../src/model/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { encryptObject, fromBase64, toBase64, utf8 } from '../src/crypto/encrypt'
import { NewerSchemaError, SCHEMA_VERSION } from '../src/model/schema'
import { createVault, parseWordlistForTests } from './helpers/vault'
import {
  AuthError,
  ConflictError,
  GithubClient,
  GithubError,
  NetworkError,
  parseExpirationHeader,
  type FetchLike,
} from '../src/storage/github'
import { openDB } from 'idb'
import { getObject, getSessionKey, openLogboekDb, putLocal, type Db } from '../src/storage/idb'
import { clearSynced, markPending, pendingCount } from '../src/storage/outbox'
import { Store } from '../src/storage/store'
import { decodeRecords, encodeRecords, encryptRecords, mergeRecords, SyncFailedError, syncCollection } from '../src/storage/sync'
import { loadToken, storeToken } from '../src/storage/token'
import type { Trip } from '../src/model/types'
import { FakeGithub } from './helpers/fake-github'
import { put, remove } from './helpers/schrijf'

// Twee apparaten delen één hoofdsleutel en één nagebootste logboek-data. Alle data hieronder is verzonnen.

const MARKER = 'GEHEIME-PLAATSNAAM-ZWAMMERDAM'
const TOKEN = 'github_pat_TESTTOKEN_0123456789abcdefghijklmnopqrstuvwxyz'
const decoder = new TextDecoder()

let dbCounter = 0
let masterKey: CryptoKey

async function device(github: FakeGithub): Promise<{ db: Db; store: Store }> {
  const db = await openLogboekDb(`logboek-test-${++dbCounter}`)
  const store = await Store.open(db, masterKey, new GithubClient(TOKEN, github.fetch))
  return { db, store }
}

function trip(id: string, name: string, updatedAt = new Date().toISOString()): Trip {
  return { id, name, updatedAt, deletedAt: null }
}

/** Alle bytes die het apparaat verlieten of in IndexedDB staan, als tekst, inclusief base64-inhoud ontcijferd. */
function wireText(github: FakeGithub): string {
  const parts: string[] = []
  for (const r of github.requests) {
    parts.push(r.url)
    if (r.body) {
      parts.push(r.body)
      const parsed = JSON.parse(r.body) as { content?: string }
      if (parsed.content) parts.push(latin1(fromBase64(parsed.content)))
    }
  }
  for (const f of github.files.values()) parts.push(latin1(fromBase64(f.content)))
  return parts.join('\n')
}

async function idbText(db: Db): Promise<string> {
  const parts: string[] = []
  for (const o of await db.getAll('objects')) parts.push(o.path, o.sha ?? '', latin1(o.blob))
  for (const l of await db.getAll('local')) parts.push(l.name, latin1(l.blob))
  return parts.join('\n')
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

beforeEach(async () => {
  masterKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
})

describe('GithubClient', () => {
  it('ziet een repo zonder commits (409) en een repo met alleen een README als leeg en kan er een logboek in beginnen', async () => {
    // Zonder commits: GET contents geeft 409 "Git Repository is empty." tot de eerste PUT.
    const empty = new FakeGithub()
    empty.emptyRepo = true
    const client = new GithubClient(TOKEN, empty.fetch)
    expect((await client.checkAccess()).expiresAt).toBeNull()
    expect(await client.getFile('meta.json.enc')).toBeNull()
    expect(empty.statuses.at(-1)).toBe(409)
    const sha = await client.putFile('meta.json.enc', utf8('{}'), null)
    expect(sha).toBe('sha-1')
    expect(await client.getFile('meta.json.enc')).not.toBeNull()
    // Daarna werkt de gewone sync: eerste schrijf zonder SHA, tweede met.
    const a = await device(empty)
    await put(a.store, 'trips.json.enc', trip('t1', 'eerste'))
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
    // meta plus elk databestand
    expect(empty.files.size).toBe(1 + COLLECTION_PATHS.length)

    // Alleen een README: meta ontbreekt (404), nieuw logboek mag.
    const readme = new FakeGithub()
    readme.write('README.md', toBase64(utf8('# logboek-data')))
    const client2 = new GithubClient(TOKEN, readme.fetch)
    expect(await client2.getFile('meta.json.enc')).toBeNull()
    expect(readme.statuses.at(-1)).toBe(404)
    await client2.putFile('meta.json.enc', utf8('{}'), null)
    expect(readme.files.has('README.md')).toBe(true)
    expect(readme.files.has('meta.json.enc')).toBe(true)
  })

  it('geeft de vervaldatum van de token door als GitHub de header meestuurt', async () => {
    const github = new FakeGithub()
    github.forceHeaders = { 'github-authentication-token-expiration': '2026-11-24 12:00:00 UTC' }
    const client = new GithubClient(TOKEN, github.fetch)
    expect(await client.checkAccess()).toEqual({ expiresAt: '2026-11-24' })
    expect(client.tokenExpiresAt).toBe('2026-11-24')
  })

  it('leest, schrijft op SHA-voorwaarde en meldt een conflict', async () => {
    const github = new FakeGithub()
    const client = new GithubClient(TOKEN, github.fetch)
    expect(await client.getFile('trips.json.enc')).toBeNull()
    const sha1 = await client.putFile('trips.json.enc', utf8('a'), null)
    const file = await client.getFile('trips.json.enc')
    expect(file?.sha).toBe(sha1)
    expect(decoder.decode(file?.content)).toBe('a')
    await expect(client.putFile('trips.json.enc', utf8('b'), 'verkeerde-sha')).rejects.toBeInstanceOf(ConflictError)
    await expect(client.putFile('trips.json.enc', utf8('b'), null)).rejects.toBeInstanceOf(ConflictError)
    const sha2 = await client.putFile('trips.json.enc', utf8('b'), sha1)
    expect(sha2).not.toBe(sha1)
    for (const r of github.requests) expect(r.url.startsWith('https://api.github.com/')).toBe(true)
    const put = github.requests.find((r) => r.method === 'PUT')
    expect(JSON.parse(put?.body ?? '{}').message).toMatch(/^sync \d{4}-\d{2}-\d{2}T/)
  })

  it('vertaalt 401/403 naar AuthError en een mislukte fetch naar NetworkError', async () => {
    const github = new FakeGithub()
    github.forceStatus = 401
    await expect(new GithubClient(TOKEN, github.fetch).getFile('x')).rejects.toBeInstanceOf(AuthError)
    github.forceStatus = 403
    await expect(new GithubClient(TOKEN, github.fetch).checkAccess()).rejects.toBeInstanceOf(AuthError)
    // 403 door een uitgeputte rate limit is geen tokenfout.
    github.forceHeaders = { 'x-ratelimit-remaining': '0' }
    const limited = new GithubClient(TOKEN, github.fetch).getFile('x')
    await expect(limited).rejects.toBeInstanceOf(GithubError)
    await expect(limited).rejects.not.toBeInstanceOf(AuthError)
    await expect(limited).rejects.toThrow('GitHub-limiet bereikt')
    github.forceHeaders = {}
    github.forceStatus = null
    github.offline = true
    await expect(new GithubClient(TOKEN, github.fetch).getFile('x')).rejects.toBeInstanceOf(NetworkError)
  })

  it('vertaalt een onleesbaar 200-antwoord naar GithubError', async () => {
    const broken: FetchLike = async () => new Response('<html>', { status: 200 })
    await expect(new GithubClient(TOKEN, broken).getFile('x')).rejects.toBeInstanceOf(GithubError)
    const badBase64: FetchLike = async () => new Response(JSON.stringify({ sha: 's', content: '!!niet-base64!!' }), { status: 200 })
    await expect(new GithubClient(TOKEN, badBase64).getFile('x')).rejects.toBeInstanceOf(GithubError)
  })

  it('haalt grote bestanden via de blob-API', async () => {
    const github = new FakeGithub()
    const sha = github.write('groot.bin', toBase64(utf8('groot')))
    // De contents-API geeft boven 1 MB geen inhoud; de blob-API wel.
    github.blobs.set(sha, toBase64(utf8('groot')))
    github.files.set('groot.bin', { sha, content: '' })
    const client = new GithubClient(TOKEN, github.fetch)
    expect(decoder.decode((await client.getFile('groot.bin'))?.content)).toBe('groot')
  })
})

describe('samenvoegen en outbox', () => {
  it('laat de laatste updatedAt winnen en houdt tombstones', () => {
    const a = trip('1', 'oud', '2026-01-01T00:00:00.000Z')
    const b = { ...trip('1', 'nieuw', '2026-01-02T00:00:00.000Z'), deletedAt: '2026-01-02T00:00:00.000Z' }
    const c = trip('2', 'alleen lokaal', '2026-01-01T00:00:00.000Z')
    expect(mergeRecords([a, c], [b])).toEqual([b, c])
    expect(mergeRecords([b], [a, c])).toEqual([b, c])
    const tie = trip('1', 'remote', '2026-01-01T00:00:00.000Z')
    expect(mergeRecords([a], [tie])).toEqual([tie])
  })

  it('telt wachtende wijzigingen en ruimt alleen gesyncte op', () => {
    let outbox = markPending({}, 'trips.json.enc', 'a', '2026-01-01T00:00:00.000Z')
    outbox = markPending(outbox, 'trips.json.enc', 'b', '2026-01-01T00:00:00.000Z')
    outbox = markPending(outbox, 'legs.json.enc', 'c', '2026-01-01T00:00:00.000Z')
    expect(pendingCount(outbox)).toBe(3)
    const snapshot = { ...outbox['trips.json.enc'] }
    outbox = markPending(outbox, 'trips.json.enc', 'b', '2026-01-02T00:00:00.000Z')
    outbox = clearSynced(outbox, 'trips.json.enc', snapshot)
    expect(outbox).toEqual({ 'trips.json.enc': { b: '2026-01-02T00:00:00.000Z' }, 'legs.json.enc': { c: '2026-01-01T00:00:00.000Z' } })
  })
})

describe('sync tussen twee apparaten', () => {
  it('brengt een wijziging van apparaat A naar B en terug', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    const b = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', `Tocht ${MARKER}`))
    expect(a.store.getStatus()).toEqual({ kind: 'pending', count: 1 })
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })

    await b.store.sync()
    expect(b.store.list('trips.json.enc').map((t) => t.name)).toEqual([`Tocht ${MARKER}`])

    const changed = { ...b.store.list('trips.json.enc')[0]!, name: 'Hernoemd', updatedAt: new Date(Date.now() + 1000).toISOString() }
    await put(b.store, 'trips.json.enc', changed)
    await b.store.sync()
    await a.store.sync()
    expect(a.store.list('trips.json.enc').map((t) => t.name)).toEqual(['Hernoemd'])

    // Herladen uit IndexedDB geeft dezelfde data.
    const again = await Store.open(a.db, masterKey, new GithubClient(TOKEN, github.fetch))
    expect(again.list('trips.json.enc').map((t) => t.name)).toEqual(['Hernoemd'])
  })

  it('probeert opnieuw na een conflict en voegt beide wijzigingen samen', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('a', 'van A'))
    // Een ander apparaat schrijft precies tussen A's GET en A's PUT; alleen de eerste keer.
    let interrupted = false
    github.beforePut = (path) => {
      if (interrupted) return
      interrupted = true
      github.write(path, toBase64(otherDeviceFile))
    }
    const otherDeviceFile = await encryptRecords(masterKey, 'trips.json.enc', [trip('b', 'van B')])
    const client = new GithubClient(TOKEN, github.fetch)
    const result = await syncCollection(client, masterKey, 'trips.json.enc', a.store.get('trips.json.enc'))
    expect(result.pushed).toBe(true)
    expect(result.records.map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(github.requests.filter((r) => r.method === 'PUT')).toHaveLength(2)
    expect(github.requests.filter((r) => r.method === 'GET')).toHaveLength(2)
    // De tweede poging gebruikte de nieuwe SHA.
    const lastPut = JSON.parse(github.requests.at(-1)?.body ?? '{}') as { sha?: string }
    expect(lastPut.sha).toBe('sha-1')
  })

  it('doet maximaal drie pogingen bij blijvend conflict', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('a', 'van A'))
    const other = toBase64(await encryptRecords(masterKey, 'trips.json.enc', [trip('z', 'iemand anders')]))
    github.write('trips.json.enc', other)
    github.beforePut = (path) => {
      github.write(path, other)
    }
    const puts = () => github.requests.filter((r) => r.method === 'PUT').length
    await expect(
      syncCollection(new GithubClient(TOKEN, github.fetch), masterKey, 'trips.json.enc', a.store.get('trips.json.enc')),
    ).rejects.toBeInstanceOf(SyncFailedError)
    expect(puts()).toBe(3)
  })

  it('lost een echt conflict in de Store op met een nieuwe poging', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    const b = await device(github)
    await put(a.store, 'trips.json.enc', trip('a', 'van A'))
    await put(b.store, 'trips.json.enc', trip('b', 'van B'))
    await b.store.sync()
    // Bij A's eerste PUT verloopt de SHA (iemand schreef dezelfde inhoud opnieuw); A krijgt 409 en begint opnieuw.
    let once = true
    github.beforePut = (path) => {
      if (!once || path !== 'trips.json.enc') return
      once = false
      github.write(path, github.files.get(path)?.content ?? '')
    }
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
    expect(a.store.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['a', 'b'])
    await b.store.sync()
    expect(b.store.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['a', 'b'])
    // Precies één 409, gevolgd door een geslaagde nieuwe poging.
    expect(github.statuses.filter((s) => s === 409)).toHaveLength(1)
    expect(github.requests.filter((r) => r.method === 'PUT' && r.url.endsWith('trips.json.enc'))).toHaveLength(3)
  })

  it('doet na een sync nog een ronde als er ondertussen iets is gewijzigd of opnieuw om sync is gevraagd', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'eerste'))
    let release = () => {}
    github.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = a.store.sync()
    // Tijdens de lopende sync: een wijziging en een tweede sync-verzoek.
    await put(a.store, 'trips.json.enc', trip('t2', 'tijdens sync'))
    const second = a.store.sync()
    expect(second).toBe(first)
    github.gate = null
    release()
    await first
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
    expect(a.store.pendingCount()).toBe(0)
    const b = await device(github)
    await b.store.sync()
    expect(b.store.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('synct de andere bestanden als één bestand onleesbaar is en meldt de fout', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    github.write('trips.json.enc', toBase64(utf8('geen geldige ciphertext maar wel base64')))
    await put(a.store, 'legs.json.enc', {
      id: 'l1',
      tripId: 't',
      date: '2026-01-01',
      fromPlace: 'A',
      fromCountry: 'X',
      toPlace: 'B',
      toCountry: 'X',
      role: 'schipper',
      boat: 'Nep',
      nmInland: 0,
      nmSea: 1,
      nmTidal: 0,
      nightHours: 0,
      dateEstimated: false,
      source: 'manual',
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    })
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'error', code: 'unreadable', count: 0, paths: ['trips.json.enc'] })
    expect(github.files.has('legs.json.enc')).toBe(true)
    const b = await device(github)
    await b.store.sync()
    expect(b.store.list('legs.json.enc')).toHaveLength(1)
  })

  it('maakt een lopende opslag af als er intussen vergrendeld wordt, en schrijft daarna niets meer', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'x'))
    const pending = put(a.store, 'trips.json.enc', trip('t2', 'y'))
    a.store.lock()
    await pending
    // Na vergrendelen komt er niets meer bij.
    await expect(put(a.store, 'trips.json.enc', trip('t3', 'z'))).rejects.toThrow()
    const again = await Store.open(a.db, masterKey, new GithubClient(TOKEN, github.fetch))
    // t2 was al opgeslagen toen er vergrendeld werd: die opslag wordt afgemaakt, met de outbox in dezelfde transactie.
    expect(again.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['t1', 't2'])
    expect(again.pendingCount()).toBe(2)
  })

  it('verwijdert met een tombstone die op het andere apparaat aankomt', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    const b = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'Weg'))
    await a.store.sync()
    await b.store.sync()
    expect(b.store.list('trips.json.enc')).toHaveLength(1)
    await remove(a.store, 'trips.json.enc', 't1')
    await a.store.sync()
    await b.store.sync()
    expect(b.store.list('trips.json.enc')).toHaveLength(0)
    expect(b.store.get('trips.json.enc')[0]?.deletedAt).not.toBeNull()
    // Nog eens verwijderen verandert niets.
    await remove(b.store, 'trips.json.enc', 't1')
    expect(b.store.pendingCount()).toBe(0)
  })

  it('bewaart wijzigingen offline in de outbox en synct ze later', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    github.offline = true
    await put(a.store, 'trips.json.enc', trip('t1', 'Offline een'))
    await put(a.store, 'trips.json.enc', trip('t2', 'Offline twee'))
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'offline', count: 2 })
    expect(github.files.size).toBe(0)

    // Herstart van de app (nieuwe Store uit IndexedDB) houdt de outbox.
    const restarted = await Store.open(a.db, masterKey, new GithubClient(TOKEN, github.fetch))
    expect(restarted.getStatus()).toEqual({ kind: 'pending', count: 2 })

    github.offline = false
    await restarted.sync()
    expect(restarted.getStatus()).toEqual({ kind: 'synced' })
    const b = await device(github)
    await b.store.sync()
    expect(b.store.list('trips.json.enc').map((t) => t.name).sort()).toEqual(['Offline een', 'Offline twee'])
  })

  it('meldt een verlopen of ingetrokken token (401) zonder te crashen en houdt de outbox', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'x'))
    github.forceStatus = 401
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'error', code: 'token', count: 1 })
    expect(a.store.pendingCount()).toBe(1)
    // Na een nieuwe token (hier: GitHub antwoordt weer gewoon) gaat de wijziging alsnog mee.
    github.forceStatus = null
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'synced' })
    expect(github.files.has('trips.json.enc')).toBe(true)
  })

  it('schrijft niets naar GitHub als een bestand een hogere schemaVersion heeft en vraagt om een update', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'lokaal'))
    await put(a.store, 'legs.json.enc', {
      id: 'l1',
      tripId: 't1',
      date: '2026-01-01',
      fromPlace: 'A',
      fromCountry: 'X',
      toPlace: 'B',
      toCountry: 'X',
      role: 'schipper',
      boat: 'Nep',
      nmInland: 0,
      nmSea: 1,
      nmTidal: 0,
      nightHours: 0,
      dateEstimated: false,
      source: 'manual',
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    })
    // Een nieuwere app schreef transactions.json.enc met schemaVersion 2 (het laatste bestand in de volgorde).
    const newer = JSON.stringify({ format: 'logboek-collection', schemaVersion: SCHEMA_VERSION + 1, records: [] })
    github.write('transactions.json.enc', toBase64(await encryptObject(masterKey, 'transactions.json.enc', utf8(newer))))
    await a.store.sync()
    expect(a.store.getStatus()).toEqual({ kind: 'error', code: 'update', count: 2 })
    // Geen enkele PUT, ook niet voor de bestanden die vóór het nieuwere bestand aan de beurt waren.
    expect(github.requests.filter((r) => r.method === 'PUT')).toHaveLength(0)
    // Ook een volgende sync schrijft niets en houdt de melding.
    await a.store.sync()
    expect(github.requests.filter((r) => r.method === 'PUT')).toHaveLength(0)
    expect(a.store.getStatus()).toEqual({ kind: 'error', code: 'update', count: 2 })
    // Lokaal blijft alles bewaard voor na de update.
    const again = await Store.open(a.db, masterKey, new GithubClient(TOKEN, github.fetch))
    expect(again.pendingCount()).toBe(2)
  })

  it('schrijft schemaVersion in elk bestand en leest de vorige vorm (version: 1) nog', () => {
    const encoded = JSON.parse(new TextDecoder().decode(encodeRecords([trip('a', 'x')]))) as Record<string, unknown>
    expect(encoded.schemaVersion).toBe(SCHEMA_VERSION)
    const legacy = utf8(JSON.stringify({ format: 'logboek-collection', version: 1, records: [trip('a', 'x')] }))
    expect(decodeRecords('trips.json.enc', legacy)).toHaveLength(1)
    const newer = utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 2, records: [] }))
    expect(() => decodeRecords('trips.json.enc', newer)).toThrow(NewerSchemaError)
    const broken = utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 0, records: [] }))
    expect(() => decodeRecords('trips.json.enc', broken)).toThrow('ongeldig')
  })

  it('stuurt nooit onversleutelde inhoud en bewaart niets leesbaar in IndexedDB', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await storeToken(a.db, masterKey, TOKEN, '2027-01-01')
    await put(a.store, 'trips.json.enc', trip('t1', `Tocht ${MARKER}`))
    await a.store.sync()
    const b = await device(github)
    await b.store.sync()
    expect(b.store.list('trips.json.enc')[0]?.name).toContain(MARKER)

    // Alleen lange markers: willekeurige ciphertext kan korte tekenreeksen toevallig bevatten.
    const wire = wireText(github)
    expect(wire).not.toContain(MARKER)
    expect(wire).not.toContain('logboek-collection')
    expect(wire).not.toContain('"deletedAt"')
    // De token gaat alleen als Authorization-header mee, nooit in URL of body.
    expect(wire).not.toContain(TOKEN)

    const local = await idbText(a.db)
    expect(local).not.toContain(MARKER)
    expect(local).not.toContain(TOKEN)
    expect(local).not.toContain('logboek-collection')
    expect(local).not.toContain('"deletedAt"')
  })

  it('wist het geheugen bij vergrendelen', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    await put(a.store, 'trips.json.enc', trip('t1', 'x'))
    a.store.lock()
    expect(() => a.store.get('trips.json.enc')).toThrow('Vergrendeld')
    await expect(put(a.store, 'trips.json.enc', trip('t2', 'y'))).rejects.toThrow('Vergrendeld')
  })
})

describe('token en meta lokaal', () => {
  it('bewaart de token versleuteld onder de hoofdsleutel', async () => {
    const db = await openLogboekDb(`logboek-test-${++dbCounter}`)
    expect(await loadToken(db, masterKey)).toBeNull()
    await storeToken(db, masterKey, TOKEN, '2027-01-01')
    expect(await loadToken(db, masterKey)).toEqual({ token: TOKEN, expiresAt: '2027-01-01' })
    await storeToken(db, masterKey, TOKEN, null)
    expect(await loadToken(db, masterKey)).toEqual({ token: TOKEN, expiresAt: null })
    const other = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt'])
    await expect(loadToken(db, other)).rejects.toThrow()
    expect(await idbText(db)).not.toContain(TOKEN)
    expect(await idbText(db)).not.toContain('2027')
  })

  it('leest de oudere tokenopslag (alleen de token als tekst)', async () => {
    const db = await openLogboekDb(`logboek-test-${++dbCounter}`)
    await putLocal(db, 'token', await encryptObject(masterKey, 'local/token', utf8(TOKEN)))
    expect(await loadToken(db, masterKey)).toEqual({ token: TOKEN, expiresAt: null })
  })

  it('leest de vervaldatum uit de GitHub-header', () => {
    expect(parseExpirationHeader('2026-11-24 12:00:00 UTC')).toBe('2026-11-24')
    expect(parseExpirationHeader('2026-11-24T12:00:00Z')).toBe('2026-11-24')
    expect(parseExpirationHeader(null)).toBeNull()
    expect(parseExpirationHeader('nooit')).toBeNull()
  })

  it('bewaart meta.json.enc lokaal voor ontgrendelen zonder verbinding', async () => {
    const db = await openLogboekDb(`logboek-test-${++dbCounter}`)
    expect(await Store.loadMeta(db)).toBeNull()
    const vault = await createVault('testwachtzin', parseWordlistForTests())
    await Store.storeMeta(db, vault.meta, 'sha-x')
    expect(await Store.loadMeta(db)).toEqual(vault.meta)
  })

  it('database van de vorige versie (1) gaat over naar versie 2 zonder dataverlies', async () => {
    const name = `logboek-test-${++dbCounter}`
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('objects', { keyPath: 'path' })
        db.createObjectStore('local', { keyPath: 'name' })
      },
    })
    await v1.put('objects', { path: 'trips.json.enc', blob: new Uint8Array([1, 2, 3]), sha: 'sha-oud' })
    await v1.put('local', { name: 'outbox', blob: new Uint8Array([4]) })
    v1.close()
    const db = await openLogboekDb(name)
    expect(await getObject(db, 'trips.json.enc')).toEqual({ path: 'trips.json.enc', blob: new Uint8Array([1, 2, 3]), sha: 'sha-oud' })
    expect(await getSessionKey(db)).toBeUndefined()
  })
})
