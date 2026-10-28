import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta, type Meta } from '../src/crypto/keys'
import { SEED_CHECKLISTS } from '../src/model/seed-checklists'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from '../src/model/types'
import { Session } from '../src/session'
import { openLogboekDb, putObject, type Db } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import type { Store } from '../src/storage/store'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// De lus van 28 oktober 2026, nagebouwd met verzonnen gegevens: checklists.json.enc is op GitHub niet te ontsleutelen,
// de telefoon heeft een leesbare kopie ("Er gaat niets verloren"). Herstellen schreef de kopie naar GitHub, maar GitHub
// gaf vlak daarna nog de oude, onleesbare versie terug (lezen direct na schrijven). De sync zag het bestand dan weer als
// onleesbaar en stuurde de hele app terug naar "Logboek herstellen": een lus.

const TOKEN = 'github_pat_LUS_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin van het logboek'
const NOW = '2026-10-27T11:56:00.000Z'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
let k1: { meta: Meta; masterKey: CryptoKey }
let k2: { meta: Meta; masterKey: CryptoKey }
let github: FakeGithub
let counter = 0
const sessions: Session[] = []

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
  clear(): void {
    this.items.clear()
  }
}

beforeAll(async () => {
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
  }
  k1 = await createVault(PASSPHRASE, wordlist)
  k2 = await createVault('nep wachtzin van een ander logboek', wordlist)
}, 30_000)

beforeEach(() => {
  github = new FakeGithub()
  globalThis.fetch = ((input: string, init?: RequestInit) => github.fetch(input, init ?? {})) as typeof fetch
  globalThis.localStorage?.clear()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const s of sessions) s.lock()
  sessions.length = 0
})

const week = { id: 'w1', name: 'Nepweek', updatedAt: NOW, deletedAt: null }
const editedList = { ...SEED_CHECKLISTS[0]!, title: { nl: 'Nep briefing', en: 'Fake briefing' }, updatedAt: NOW, deletedAt: null }

/** Telefoon: alles leesbaar onder K1, behalve `unreadable` op GitHub (onder een vreemde sleutel). */
async function phone(unreadable: CollectionPath): Promise<{ name: string; db: Db }> {
  const name = `logboek-lus-${++counter}`
  const db = await openLogboekDb(name)
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: github.files.get(META_PATH)!.sha })
  for (const path of COLLECTION_PATHS) {
    const records: SyncRecord[] = path === 'trips.json.enc' ? [week] : path === 'checklists.json.enc' ? [editedList] : []
    const key = path === unreadable ? k2.masterKey : k1.masterKey
    const sha = github.write(path, toBase64(await encryptRecords(key, path, records)))
    await putObject(db, { path, blob: await encryptRecords(k1.masterKey, path, records), sha })
  }
  await saveOutbox(db, k1.masterKey, {})
  await storeToken(db, k1.masterKey, TOKEN, null)
  return { name, db }
}

function store(session: Session): Store {
  const state = session.getState()
  if (state.phase !== 'unlocked') throw new Error(`niet ontgrendeld maar ${state.phase}`)
  return state.store
}

async function remote(path: CollectionPath): Promise<SyncRecord[]> {
  return decryptRecords(k1.masterKey, path, Uint8Array.from(Buffer.from(github.files.get(path)!.content, 'base64')))
}

/** Een schoon tweede apparaat koppelt met de wachtzin: alles moet leesbaar zijn. */
async function cleanDeviceReadsAll(): Promise<void> {
  const second = new Session(`logboek-lus-schoon-${++counter}`)
  sessions.push(second)
  await second.init()
  await second.link(TOKEN, null, { passphrase: PASSPHRASE })
  const s = store(second)
  await s.sync()
  expect(s.getStatus()).toEqual({ kind: 'synced' })
  for (const path of COLLECTION_PATHS) if (github.files.has(path)) await expect(remote(path), path).resolves.toBeDefined()
}

describe('Herstel raakt nooit in een lus', () => {
  it('checklists onleesbaar op GitHub en GitHub toont na het schrijven nog even de oude versie: de app blijft open', async () => {
    const { name } = await phone('checklists.json.enc')
    github.staleReadsAfterPut = 3
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    // Een onleesbaar bestand op GitHub blokkeert nooit de hele app.
    await store(s).sync()
    await store(s).sync()
    await store(s).sync()
    expect(s.getState().phase).toBe('unlocked')
    // Checklists zijn een seedbestand: de leesbare kopie gaat vanzelf naar GitHub, één keer.
    const puts = github.requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/checklists.json.enc'))
    expect(puts.length).toBeGreaterThanOrEqual(1)
    expect(await remote('checklists.json.enc')).toEqual([editedList])
    expect(store(s).list('trips.json.enc').map((t) => t.name)).toEqual(['Nepweek'])
    github.staleReadsAfterPut = 0
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    expect(store(s).list('checklists.json.enc')).toEqual([editedList])
    await cleanDeviceReadsAll()
  }, 60_000)

  it('ook bij verversen tijdens de oude versie op GitHub: na opnieuw ontgrendelen geen herstelscherm', async () => {
    const { name } = await phone('checklists.json.enc')
    github.staleReadsAfterPut = 5
    const first = new Session(name)
    sessions.push(first)
    await first.init()
    await first.unlockLocal({ passphrase: PASSPHRASE })
    await store(first).sync()
    first.lock()
    const again = new Session(name)
    sessions.push(again)
    await again.init()
    expect(again.getState().phase).toBe('locked')
    await again.unlockLocal({ passphrase: PASSPHRASE })
    await store(again).sync()
    expect(again.getState().phase).toBe('unlocked')
  }, 60_000)

  it('een onleesbaar studentenbestand blokkeert alleen studenten; de rest van de app werkt', async () => {
    const { name } = await phone('students.json.enc')
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await store(s).sync()
    expect(s.getState().phase).toBe('unlocked')
    expect(store(s).getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['students.json.enc'] })
    // Geen seedbestand: niets automatisch, Olivier kiest met één tik.
    expect(github.requests.some((r) => r.method === 'PUT' && r.url.endsWith('/students.json.enc'))).toBe(false)
    await vi.waitFor(async () => expect(await store(s).repairOptions()).toEqual([{ path: 'students.json.enc', action: 'repair' }]))
    await store(s).repair('students.json.enc')
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    await cleanDeviceReadsAll()
  }, 60_000)

  it('faalt herstel voor hetzelfde bestand twee keer, dan stopt het en is er één knop: leegmaken en opnieuw beginnen', async () => {
    const { name } = await phone('students.json.enc')
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await store(s).sync()
    // Een vreemde schrijver zet na elk herstel weer een onleesbare versie neer.
    const sabotage = async () => github.write('students.json.enc', toBase64(await encryptRecords(k2.masterKey, 'students.json.enc', [])))
    await store(s).repair('students.json.enc')
    await sabotage()
    await store(s).sync()
    await store(s).repair('students.json.enc')
    await sabotage()
    await store(s).sync()
    expect(await store(s).repairOptions()).toEqual([{ path: 'students.json.enc', action: 'reset' }])
    const before = github.requests.filter((r) => r.method === 'PUT').length
    await store(s).repair('students.json.enc')
    // Geen derde poging met dezelfde kopie.
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(before)
    await store(s).resetFile('students.json.enc')
    expect(await remote('students.json.enc')).toEqual([])
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    expect(s.getState().phase).toBe('unlocked')
    await cleanDeviceReadsAll()
  }, 60_000)
})

describe('GitHub-verzoeken', () => {
  it('komen nooit uit de browsercache (GitHub stuurt max-age=60 mee)', async () => {
    const { GithubClient } = await import('../src/storage/github')
    const seen: RequestInit[] = []
    const client = new GithubClient(TOKEN, async (url, init) => {
      seen.push(init)
      return github.fetch(url, init)
    })
    github.write('trips.json.enc', toBase64(utf8('x'.repeat(40))))
    await client.getFile('trips.json.enc')
    await client.putFile('trips.json.enc', utf8('y'.repeat(40)), github.files.get('trips.json.enc')!.sha)
    expect(seen.map((i) => i.cache)).toEqual(['no-store', 'no-store'])
  })
})
