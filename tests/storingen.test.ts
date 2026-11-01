import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta, unlock, parseMeta, type Meta } from '../src/crypto/keys'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from '../src/model/types'
import { Session } from '../src/session'
import { openLogboekDb, putObject, type Db } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import { RETRY_PENDING_MS, type Store } from '../src/storage/store'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'
import { put } from './helpers/schrijf'

// Storingstests: na elke reeks moet een schoon apparaat met alleen de wachtzin alles op GitHub kunnen lezen, en de app
// moet open zijn (geen herstelscherm). Alle gegevens zijn verzonnen.
// - twee versies (twee vensters) tegelijk open;
// - een update (nieuw venster) midden in herstellen;
// - verbinding weg midden in een sync;
// - de app sluiten tijdens het schrijven;
// - herstel twee keer achter elkaar.

const TOKEN = 'github_pat_STORING_0123456789abcdefghijklmnopqrstuvwxyz'
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

/** Telefoon met een logboek onder K1; `localUnreadable`: dit lokale bestand staat onder een vreemde sleutel. */
async function phone(localUnreadable?: CollectionPath): Promise<{ name: string; db: Db }> {
  const name = `logboek-storing-${++counter}`
  const db = await openLogboekDb(name)
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: github.files.get(META_PATH)!.sha })
  for (const path of COLLECTION_PATHS) {
    const records: SyncRecord[] = path === 'trips.json.enc' ? [week] : []
    const sha = github.write(path, toBase64(await encryptRecords(k1.masterKey, path, records)))
    const key = path === localUnreadable ? k2.masterKey : k1.masterKey
    await putObject(db, { path, blob: await encryptRecords(key, path, records), sha })
  }
  await saveOutbox(db, k1.masterKey, {})
  await storeToken(db, k1.masterKey, TOKEN, null)
  return { name, db }
}

async function open(name: string): Promise<Session> {
  const s = new Session(name)
  sessions.push(s)
  await s.init()
  if (s.getState().phase === 'locked') await s.unlockLocal({ passphrase: PASSPHRASE })
  return s
}

function store(session: Session): Store {
  const state = session.getState()
  if (state.phase !== 'unlocked') throw new Error(`niet ontgrendeld maar ${state.phase}`)
  return state.store
}

const day = (id: string, updatedAt: string) => ({
  id,
  tripId: 'w1',
  date: '2026-10-20',
  fromPlace: 'Nephaven',
  fromCountry: 'NL',
  toPlace: 'Nepdorp',
  toCountry: 'NL',
  role: 'schipper' as const,
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 12,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual' as const,
  updatedAt,
  deletedAt: null,
})

/**
 * Een schoon apparaat: alleen meta.json.enc en de wachtzin. Elk bestand op GitHub moet met die sleutel te ontsleutelen
 * zijn, en koppelen moet in één keer een gesynct logboek geven.
 */
async function cleanDeviceReadsAll(): Promise<void> {
  const meta = parseMeta(new TextDecoder().decode(Uint8Array.from(Buffer.from(github.files.get(META_PATH)!.content, 'base64'))))
  const key = await unlock(meta, { passphrase: PASSPHRASE })
  for (const path of COLLECTION_PATHS) {
    const file = github.files.get(path)
    if (file) await expect(decryptRecords(key, path, Uint8Array.from(Buffer.from(file.content, 'base64'))), path).resolves.toBeDefined()
  }
  const clean = new Session(`logboek-storing-schoon-${++counter}`)
  sessions.push(clean)
  await clean.init()
  await clean.link(TOKEN, null, { passphrase: PASSPHRASE })
  await store(clean).sync()
  expect(store(clean).getStatus()).toEqual({ kind: 'synced' })
}

describe('Storingstests', () => {
  it('twee vensters tegelijk open schrijven en synchroniseren: niets verloren, alles leesbaar', async () => {
    const { name } = await phone()
    const a = await open(name)
    const b = await open(name)
    await Promise.all([put(store(a), 'legs.json.enc', day('a1', '2026-10-27T12:00:00.000Z')), put(store(b), 'legs.json.enc', day('b1', '2026-10-27T12:00:01.000Z'))])
    await Promise.all([store(a).sync(), store(b).sync()])
    await store(a).sync()
    await store(b).sync()
    expect(a.getState().phase).toBe('unlocked')
    expect(b.getState().phase).toBe('unlocked')
    const ids = (await decryptRecords(k1.masterKey, 'legs.json.enc', Uint8Array.from(Buffer.from(github.files.get('legs.json.enc')!.content, 'base64')))).map((r) => r.id)
    expect(ids.sort()).toEqual(['a1', 'b1'])
    await cleanDeviceReadsAll()
  }, 60_000)

  it('een update (nieuw venster) midden in herstellen: het nieuwe venster herstelt gewoon, geen lus', async () => {
    const { name } = await phone('legs.json.enc')
    const first = new Session(name)
    sessions.push(first)
    await first.init()
    await first.unlockLocal({ passphrase: PASSPHRASE })
    expect(first.getState()).toMatchObject({ phase: 'repair' })
    // Herstellen loopt; vlak voor het schrijven naar GitHub neemt een nieuwe versie het venster over.
    let release: () => void = () => undefined
    github.gate = new Promise((resolve) => (release = resolve))
    const abandoned = first.repair({}).catch(() => undefined)
    first.lock()
    github.gate = null
    release()
    await abandoned
    const second = await open(name)
    // Het nieuwe venster toont het herstelscherm uit het verslag; wachtzin plus één tik herstelt.
    const state = second.getState()
    if (state.phase === 'repair') await second.repair(state.needsSecret ? { secret: { passphrase: PASSPHRASE } } : {})
    if (second.getState().phase === 'repair') await second.repair({})
    expect(second.getState().phase).toBe('unlocked')
    await store(second).sync()
    expect(store(second).getStatus()).toEqual({ kind: 'synced' })
    await cleanDeviceReadsAll()
  }, 60_000)

  it('verbinding weg midden in een sync: daarna gewoon verder, niets half geschreven', async () => {
    const { name } = await phone()
    const s = await open(name)
    await store(s).sync()
    await put(store(s), 'legs.json.enc', day('d1', '2026-10-27T12:00:00.000Z'))
    await put(store(s), 'trips.json.enc', { ...week, name: 'Nepweek hernoemd', updatedAt: '2026-10-27T12:00:00.000Z' })
    let puts = 0
    github.beforePut = () => {
      if (++puts === 1) github.offline = true
    }
    await store(s).sync()
    expect(store(s).getStatus()).toMatchObject({ kind: 'offline' })
    github.beforePut = null
    github.offline = false
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    expect(s.getState().phase).toBe('unlocked')
    await cleanDeviceReadsAll()
  }, 60_000)

  it('de app sluiten tijdens het schrijven: bij openen leesbaar en alles komt alsnog op GitHub', async () => {
    const { name } = await phone()
    const s = await open(name)
    await store(s).sync()
    let release: () => void = () => undefined
    github.gate = new Promise((resolve) => (release = resolve))
    const writing = put(store(s), 'legs.json.enc', day('d1', '2026-10-27T12:00:00.000Z'))
    const syncing = store(s).sync()
    // Sluiten: het geheugen wordt gewist terwijl schrijven en sync nog lopen.
    s.lock()
    github.gate = null
    release()
    await writing.catch(() => undefined)
    await syncing.catch(() => undefined)
    const again = await open(name)
    expect(again.getState().phase).toBe('unlocked')
    await store(again).sync()
    expect(store(again).getStatus()).toEqual({ kind: 'synced' })
    await cleanDeviceReadsAll()
  }, 60_000)

  it('herstel twee keer achter elkaar: de tweede keer verandert niets en de app blijft open', async () => {
    const { name } = await phone('legs.json.enc')
    const s = await open(name)
    expect(s.getState()).toMatchObject({ phase: 'repair' })
    await s.repair({})
    expect(s.getState().phase).toBe('unlocked')
    s.lock()
    const again = await open(name)
    // Geen tweede herstelscherm: het eerste herstel bleef staan.
    expect(again.getState().phase).toBe('unlocked')
    await store(again).sync()
    expect(store(again).getStatus()).toEqual({ kind: 'synced' })
    await cleanDeviceReadsAll()
  }, 60_000)

  it('opslaan precies terwijl een syncronde hetzelfde bestand lokaal wegschrijft: niets verloren, niets blijft wachten', async () => {
    // Gevonden in CI ("1 wijziging wacht" bleef staan): de ronde zette na het wegschrijven de verzameling in het geheugen
    // gelijk aan zijn eigen kopie, zodat een opslag van net daarvoor uit het geheugen viel, niet op het apparaat kwam en
    // voor altijd in de outbox bleef wachten. Met de geschiedenis (elke opdracht schrijft history.json.enc) gebeurde dat vaak.
    const { name } = await phone()
    const s = await open(name)
    const st = store(s)
    await st.sync()
    await put(st, 'legs.json.enc', day('d1', new Date().toISOString()))
    // Het lokale deel van de ronde voor dagen schrijft weg (één bestand, geen lijst zoals bij een gewone opslag): precies
    // dan een tweede opslag in dat bestand.
    const internal = st as unknown as { putGuarded: (objects: unknown, outbox: unknown) => Promise<void> }
    const original = internal.putGuarded.bind(st)
    let during: Promise<void> | null = null
    internal.putGuarded = async (objects, outbox) => {
      if (!Array.isArray(objects) && (objects as { path: string }).path === 'legs.json.enc' && !during) during = put(st, 'legs.json.enc', day('d2', new Date(Date.now() + 1).toISOString()))
      return original(objects, outbox)
    }
    await st.sync()
    await during
    internal.putGuarded = original
    expect(st.list('legs.json.enc').map((l) => l.id).sort()).toEqual(['d1', 'd2'])
    await st.sync()
    expect(st.pendingCount()).toBe(0)
    expect(st.getStatus()).toEqual({ kind: 'synced' })
    // Op het apparaat (opnieuw openen) en op GitHub.
    s.lock()
    const again = await open(name)
    expect(store(again).list('legs.json.enc').map((l) => l.id).sort()).toEqual(['d1', 'd2'])
    const remote = await decryptRecords(k1.masterKey, 'legs.json.enc', Uint8Array.from(Buffer.from(github.files.get('legs.json.enc')!.content, 'base64')))
    expect(remote.filter((r) => r.deletedAt === null).map((r) => r.id).sort()).toEqual(['d1', 'd2'])
  }, 60_000)
})

/** Wacht tot de sync kort na een opslag (0,8 s) zonder verbinding is mislukt. */
async function settleOffline(st: Store): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500))
  await vi.waitFor(() => expect(st.getStatus().kind).toBe('offline'), { timeout: 10_000 })
}

describe('vangnet: wat wacht, gaat vanzelf alsnog', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as { document?: unknown }).document
  })

  it('zolang er een wijziging wacht en er verbinding is: elke 30 seconden opnieuw synchroniseren', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { name } = await phone()
    const st = store(await open(name))
    await st.sync()
    github.offline = true
    await put(st, 'legs.json.enc', day('v1', new Date().toISOString()))
    // De sync kort na het opslaan mislukt zonder verbinding; daarna komt de verbinding terug zonder dat Olivier iets doet.
    await settleOffline(st)
    github.offline = false
    await new Promise((r) => setTimeout(r, 1500))
    expect(st.pendingCount()).toBe(1)
    // Zonder handeling van Olivier: na 30 seconden.
    vi.advanceTimersByTime(RETRY_PENDING_MS)
    await vi.waitFor(() => expect(st.getStatus()).toEqual({ kind: 'synced' }), { timeout: 10_000 })
    expect(st.pendingCount()).toBe(0)
  }, 60_000)

  it('bij terugkomen in de app: direct opnieuw synchroniseren als er iets wacht', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
    const { name } = await phone()
    const st = store(await open(name))
    await st.sync()
    github.offline = true
    await put(st, 'legs.json.enc', day('v2', new Date().toISOString()))
    await settleOffline(st)
    github.offline = false
    await new Promise((r) => setTimeout(r, 1500))
    expect(st.pendingCount()).toBe(1)
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(st.getStatus()).toEqual({ kind: 'synced' }), { timeout: 10_000 })
    expect(st.pendingCount()).toBe(0)
  }, 60_000)
})
