import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, parseMeta, serializeMeta, verifyMetaCheck, type Meta } from '../src/crypto/keys'
import { lastError } from '../src/errors'
import { COLLECTION_PATHS } from '../src/model/types'
import { Session } from '../src/session'
import { GithubClient } from '../src/storage/github'
import { getObject, getSessionKey, openLogboekDb, putObject } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import { Store } from '../src/storage/store'
import { loadToken, storeToken } from '../src/storage/token'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// Sleutel-invariant: de hoofdsleutel in het geheugen hoort altijd bij meta.json.enc. Nagebootst wat op Oliviers
// telefoon gebeurde: twee app-instanties (een oude versie die nog open stond en een nieuwe) delen één IndexedDB.
// De oude instantie houdt de sleutel van een eerder logboek in het geheugen terwijl de nieuwe een nieuw logboek
// aanmaakt. Alle gegevens zijn verzonnen.

const TOKEN = 'github_pat_SLEUTEL_0123456789abcdefghijklmnopqrstuvwxyz'
const OLD_PASSPHRASE = 'nep wachtzin van het oude logboek'
const NEW_PASSPHRASE = 'nep wachtzin van het nieuwe logboek'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
const NOW = '2026-10-26T11:56:00.000Z'

let github: FakeGithub
let counter = 0
const sessions: Session[] = []

beforeEach(() => {
  github = new FakeGithub()
  globalThis.fetch = ((input: string, init: RequestInit) => github.fetch(input, init)) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const s of sessions) s.lock()
  sessions.length = 0
})

function track(session: Session): Session {
  sessions.push(session)
  return session
}

function unlockedStore(session: Session): Store {
  const state = session.getState()
  if (state.phase !== 'unlocked') throw new Error(`niet ontgrendeld maar ${state.phase}`)
  return state.store
}

const tip = (id: string) => ({ id, date: '2026-10-26', kind: 'fooi' as const, amount: 20, currency: 'EUR' as const, source: 'yacht-week' as const, updatedAt: NOW, deletedAt: null })

async function remoteMeta(): Promise<Meta> {
  const file = await new GithubClient(TOKEN, github.fetch).getFile(META_PATH)
  return parseMeta(new TextDecoder().decode(file!.content))
}

/** Elk databestand op GitHub moet met `key` te ontsleutelen zijn. */
async function expectGithubReadableWith(key: CryptoKey) {
  const client = new GithubClient(TOKEN, github.fetch)
  for (const path of COLLECTION_PATHS) {
    const file = await client.getFile(path)
    if (file) await expect(decryptRecords(key, path, file.content), path).resolves.toBeDefined()
  }
}

/** Zonder BroadcastChannel (zoals een instantie die het bericht van een ander tabblad nooit krijgt). */
function withoutChannel<T>(run: () => T): T {
  const saved = globalThis.BroadcastChannel
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true, writable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: saved, configurable: true, writable: true })
  }
}

describe('twee instanties, één IndexedDB: een oude instantie met een andere hoofdsleutel', () => {
  it.each([
    ['met bericht tussen tabbladen', true],
    ['zonder bericht tussen tabbladen (alleen de sleutel-invariant)', false],
  ])('schrijft niets meer (lokaal, sessiesleutel of GitHub) zodra er een ander logboek staat; ontgrendelen met de wachtzin blijft werken (%s)', async (_label, channel) => {
    const name = `logboek-sleutel-${++counter}`
    const make = () => track(channel ? new Session(name) : withoutChannel(() => new Session(name)))
    // Twee tabbladen op een leeg apparaat. Tabblad A maakt het oude logboek en is ontgrendeld en in gebruik.
    const a = make()
    const b = make()
    await a.init()
    await b.init()
    const oldVault = await createVault(OLD_PASSPHRASE, wordlist)
    await a.finishNewVault(TOKEN, null, oldVault)
    await unlockedStore(a).sync()

    // logboek-data wordt leeg opnieuw aangemaakt; tabblad B maakt een nieuw logboek (zelfde IndexedDB).
    github.files.clear()
    const newVault = await createVault(NEW_PASSPHRASE, wordlist)
    await b.finishNewVault(TOKEN, null, newVault)
    await unlockedStore(b).sync()

    // Tabblad A leeft nog (bijvoorbeeld bevroren op de achtergrond) en wordt weer gebruikt.
    a.flushActivity()
    const stateA = a.getState()
    if (stateA.phase === 'unlocked') {
      await stateA.store.put('transactions.json.enc', tip('oud')).catch(() => undefined)
      await stateA.store.sync().catch(() => undefined)
    }
    await new Promise((r) => setTimeout(r, 50))

    // 1. Op GitHub staat niets onder de oude sleutel.
    await expectGithubReadableWith(newVault.masterKey)
    // 2. Lokaal staat niets onder de oude sleutel.
    const db = await openLogboekDb(name)
    for (const path of COLLECTION_PATHS) {
      const object = await getObject(db, path)
      if (object) await expect(decryptRecords(newVault.masterKey, path, object.blob), path).resolves.toBeDefined()
    }
    // 3. Een opgeslagen sessiesleutel hoort bij de meta.
    const record = await getSessionKey(db)
    if (record) expect(await verifyMetaCheck(await remoteMeta(), record.key)).toBe(true)
    // 4. Tabblad A werkt niet stil verder met de oude sleutel: vergrendeld (bericht) of het scherm "Sleutel past niet".
    // (Met bericht: 'setup' als A de meta las terwijl B nog bezig was.)
    expect(channel ? ['locked', 'setup'] : ['mismatch']).toContain(a.getState().phase)
    expect(b.getState().phase).toBe('unlocked')

    // 5. Na herladen werkt ontgrendelen met de wachtzin van het nieuwe logboek.
    const c = track(new Session(name))
    await c.init()
    if (c.getState().phase === 'locked') await c.unlockLocal({ passphrase: NEW_PASSPHRASE })
    expect(c.getState().phase).toBe('unlocked')
  }, 60_000)
})

describe('invariant bij openen', () => {
  it('een opgeslagen sessiesleutel die niet bij meta.json.enc hoort: niets schrijven, sleutel wissen, scherm "Sleutel past niet"', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = track(new Session(name))
    await a.init()
    const vault = await createVault(NEW_PASSPHRASE, wordlist)
    await a.finishNewVault(TOKEN, null, vault)
    await unlockedStore(a).sync()
    a.flushActivity()
    await new Promise((r) => setTimeout(r, 50))

    // Een sessiesleutel van een ander logboek komt in IndexedDB terecht (zoals door een andere instantie).
    const other = await createVault(OLD_PASSPHRASE, wordlist)
    const db = await openLogboekDb(name)
    const record = await getSessionKey(db)
    await db.put('session', { ...record!, key: other.masterKey })
    const before = github.requests.filter((r) => r.method === 'PUT').length

    const b = track(new Session(name))
    await b.init()
    expect(b.getState().phase).toBe('mismatch')
    expect(await getSessionKey(db)).toBeUndefined()
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(before)
  }, 60_000)
})

describe('herstelpad', () => {
  it('ontgrendelen lukt maar lokale data staat onder een andere sleutel: per bestand tonen, pas na een keuze opnieuw beginnen vanaf GitHub', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = track(new Session(name))
    await a.init()
    const vault = await createVault(NEW_PASSPHRASE, wordlist)
    await a.finishNewVault(TOKEN, null, vault)
    await unlockedStore(a).put('trips.json.enc', { id: 't1', name: 'Nepweek', updatedAt: NOW, deletedAt: null })
    await unlockedStore(a).sync()
    a.lock()

    // Lokale kopie van transactions.json.enc onder een andere sleutel (zoals de telefoon nu heeft).
    const other = await createVault(OLD_PASSPHRASE, wordlist)
    const db = await openLogboekDb(name)
    const blob = await encryptRecords(other.masterKey, 'transactions.json.enc', [tip('lokaal')])
    await putObject(db, { path: 'transactions.json.enc', blob, sha: 'oud' })
    const putsBefore = github.requests.filter((r) => r.method === 'PUT').length

    const b = track(new Session(name))
    await b.init()
    await b.unlockLocal({ passphrase: NEW_PASSPHRASE })
    const state = b.getState()
    expect(state.phase).toBe('recover')
    if (state.phase !== 'recover') return
    expect(state.report.unreadable).toEqual(['transactions.json.enc'])
    expect(state.report.tokenUnreadable).toBe(false)
    // Niets gewist en niets geschreven zolang Olivier niet kiest.
    expect((await getObject(db, 'transactions.json.enc'))!.blob).toEqual(blob)
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(putsBefore)

    await b.restartFromGithub()
    expect(b.getState().phase).toBe('unlocked')
    await unlockedStore(b).sync()
    expect(unlockedStore(b).list('trips.json.enc').map((t) => t.name)).toEqual(['Nepweek'])
    expect(unlockedStore(b).list('transactions.json.enc')).toEqual([])
    await expectGithubReadableWith(vault.masterKey)
  }, 60_000)
})

describe('invariant vóór schrijven naar GitHub', () => {
  async function unlocked(name: string) {
    const a = track(new Session(name))
    await a.init()
    const vault = await createVault(NEW_PASSPHRASE, wordlist)
    await a.finishNewVault(TOKEN, null, vault)
    await unlockedStore(a).sync()
    return a
  }

  it('meta.json.enc op GitHub hoort bij een andere sleutel: niets schrijven, sessiesleutel wissen, scherm "Sleutel past niet"', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = await unlocked(name)
    const store = unlockedStore(a)
    const other = await createVault(OLD_PASSPHRASE, wordlist)
    github.write(META_PATH, toBase64(utf8(serializeMeta(other.meta))))
    const before = github.requests.filter((r) => r.method === 'PUT').length
    await store.put('transactions.json.enc', tip('t1'))
    await store.sync()
    expect(a.getState().phase).toBe('mismatch')
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(before)
    await new Promise((r) => setTimeout(r, 20))
    expect(await getSessionKey(await openLogboekDb(name))).toBeUndefined()
    expect(lastError()?.error).toMatchObject({ name: 'KeyMismatchError' })
  }, 60_000)

  it('meta.json.enc ontbreekt op GitHub: niets schrijven, scherm "Sleutel past niet"', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = await unlocked(name)
    github.files.delete(META_PATH)
    const before = github.requests.filter((r) => r.method === 'PUT').length
    await unlockedStore(a).put('transactions.json.enc', tip('t1'))
    await unlockedStore(a).sync()
    expect(a.getState().phase).toBe('mismatch')
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(before)
  }, 60_000)

  it('een Store van een gestopte sessie schrijft ook lokaal niets meer', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = await unlocked(name)
    const store = unlockedStore(a)
    github.files.delete(META_PATH)
    await store.sync()
    expect(a.getState().phase).toBe('mismatch')
    const db = await openLogboekDb(name)
    const before = await getObject(db, 'transactions.json.enc')
    await expect(store.put('transactions.json.enc', tip('t2'))).rejects.toThrow()
    expect(await getObject(db, 'transactions.json.enc')).toEqual(before)
  }, 60_000)
})

describe('invariant in de Store (lokaal)', () => {
  it('een andere lokale meta (ander tabblad maakte een logboek): niets naar IndexedDB of GitHub, melding aan de sessie', async () => {
    const db = await openLogboekDb(`logboek-sleutel-${++counter}`)
    const ours = await createVault(NEW_PASSPHRASE, wordlist)
    const other = await createVault(OLD_PASSPHRASE, wordlist)
    github.write(META_PATH, toBase64(utf8(serializeMeta(ours.meta))))
    await Store.storeMeta(db, ours.meta, null)
    const store = await Store.open(db, ours.masterKey, new GithubClient(TOKEN, github.fetch), ours.meta.check!)
    const seen: string[] = []
    store.onKeyMismatch((e) => seen.push(e.where))
    await store.put('trips.json.enc', { id: 't1', name: 'Nepweek', updatedAt: NOW, deletedAt: null })
    await store.sync()
    const putsBefore = github.requests.filter((r) => r.method === 'PUT').length
    const local = await getObject(db, 'trips.json.enc')

    await Store.storeMeta(db, other.meta, null)
    await expect(store.put('trips.json.enc', { id: 't2', name: 'Nepweek 2', updatedAt: NOW, deletedAt: null })).rejects.toMatchObject({ name: 'KeyMismatchError' })
    await store.sync()
    expect(seen).toEqual(['local'])
    expect(store.getStatus()).toMatchObject({ kind: 'error', code: 'keyMismatch' })
    expect(await getObject(db, 'trips.json.enc')).toEqual(local)
    expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(putsBefore)
  }, 60_000)
})

describe('herstelpad met onleesbare token', () => {
  it('vraagt een token, wist pas na de keuze en gebruikt dan de nieuwe token', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = track(new Session(name))
    await a.init()
    const vault = await createVault(NEW_PASSPHRASE, wordlist)
    await a.finishNewVault(TOKEN, null, vault)
    await unlockedStore(a).sync()
    a.lock()
    const other = await createVault(OLD_PASSPHRASE, wordlist)
    const db = await openLogboekDb(name)
    // Token en outbox onder een andere sleutel.
    await storeToken(db, other.masterKey, 'github_pat_VREEMD_0123456789abcdefghijklmnopqrstuvwxyz', null)
    await saveOutbox(db, other.masterKey, { 'trips.json.enc': { x: NOW } })

    const b = track(new Session(name))
    await b.init()
    await b.unlockLocal({ passphrase: NEW_PASSPHRASE })
    const state = b.getState()
    expect(state.phase).toBe('recover')
    if (state.phase !== 'recover') return
    expect(state.report).toEqual({ unreadable: [], tokenUnreadable: true, outboxUnreadable: true })
    await expect(b.restartFromGithub()).rejects.toMatchObject({ key: 'error.tokenRequired' })
    expect(b.getState().phase).toBe('recover')
    await b.restartFromGithub(TOKEN)
    expect(b.getState().phase).toBe('unlocked')
    expect(await loadToken(db, vault.masterKey)).toEqual({ token: TOKEN, expiresAt: null })
  }, 60_000)

  it('herstelt niet als meta.json.enc op GitHub bij een andere sleutel hoort', async () => {
    const name = `logboek-sleutel-${++counter}`
    const a = track(new Session(name))
    await a.init()
    const vault = await createVault(NEW_PASSPHRASE, wordlist)
    await a.finishNewVault(TOKEN, null, vault)
    await unlockedStore(a).sync()
    a.lock()
    const other = await createVault(OLD_PASSPHRASE, wordlist)
    const db = await openLogboekDb(name)
    const blob = await encryptRecords(other.masterKey, 'transactions.json.enc', [tip('lokaal')])
    await putObject(db, { path: 'transactions.json.enc', blob, sha: 'oud' })
    github.write(META_PATH, toBase64(utf8(serializeMeta(other.meta))))

    const b = track(new Session(name))
    await b.init()
    await b.unlockLocal({ passphrase: NEW_PASSPHRASE })
    expect(b.getState().phase).toBe('recover')
    await expect(b.restartFromGithub()).rejects.toMatchObject({ name: 'KeyMismatchError' })
    expect(b.getState().phase).toBe('mismatch')
    expect((await getObject(db, 'transactions.json.enc'))!.blob).toEqual(blob)
  }, 60_000)
})
