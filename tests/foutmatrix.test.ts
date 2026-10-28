import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptObject, toBase64, utf8, type Bytes } from '../src/crypto/encrypt'
import { META_PATH, parseMeta, serializeMeta, unlock, type Meta } from '../src/crypto/keys'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from '../src/model/types'
import { Session } from '../src/session'
import { getObject, openLogboekDb, putLocal, putObject, type Db } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import type { Store } from '../src/storage/store'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'
import { UPGRADE_SAMPLES } from './upgrade/upgrade-samples'

// Foutmatrix: voor elk databestand elk soort defect, op GitHub, op dit apparaat of allebei. Na elke combinatie:
// - de app is open (het herstelscherm over de hele app alleen bij een lokaal bestand onder een andere sleutel, en
//   dan lost één tik het op), en blijft open bij volgende syncs: nooit een lus;
// - de andere onderdelen werken (de trip staat er nog);
// - er is een uitweg met hoogstens één tik per bestand (herstellen of leegmaken), behalve bij een nieuwere versie:
//   dan "Werk de app bij" zonder iets te schrijven;
// - daarna kan een schoon apparaat met de wachtzin koppelen en is elk bestand op GitHub te lezen.
// Plus: onleesbare outbox of token op het apparaat. Alles verzonnen.

const TOKEN = 'github_pat_MATRIX_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin van het logboek'
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

type Fault = 'andere sleutel' | 'afgekapt' | 'ongeldig' | 'nieuwere versie' | 'nieuwer objectformaat'
type Where = 'GitHub' | 'apparaat' | 'beide'

const samples = (path: CollectionPath) => (UPGRADE_SAMPLES[path] ?? []) as unknown as SyncRecord[]

/**
 * Een defecte versie van `path`, zoals die op GitHub of in IndexedDB kan staan. Elke versie bevat de echte
 * voorbeeldrecords, zodat de test ziet of herstellen ze bewaart (en niet alles leegmaakt).
 */
async function broken(fault: Fault, path: CollectionPath): Promise<Bytes> {
  const records = samples(path)
  switch (fault) {
    case 'andere sleutel':
      return encryptRecords(k2.masterKey, path, records)
    case 'afgekapt':
      return (await encryptRecords(k1.masterKey, path, records)).slice(0, 10)
    case 'ongeldig':
      // Geldige records plus één record zonder id: het bestand als geheel is ongeldig.
      return encryptObject(k1.masterKey, path, utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 1, records: [...records, { kapot: true }] })))
    case 'nieuwere versie':
      return encryptObject(k1.masterKey, path, utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 99, records })))
    case 'nieuwer objectformaat': {
      const blob = await encryptRecords(k1.masterKey, path, records)
      blob[0] = 2
      return blob
    }
  }
}
const TRIP_ID = (UPGRADE_SAMPLES['trips.json.enc']![0] as { id: string }).id

async function phone(): Promise<{ name: string; db: Db }> {
  const name = `logboek-matrix-${++counter}`
  const db = await openLogboekDb(name)
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: github.files.get(META_PATH)!.sha })
  for (const path of COLLECTION_PATHS) {
    const sha = github.write(path, toBase64(await encryptRecords(k1.masterKey, path, samples(path))))
    await putObject(db, { path, blob: await encryptRecords(k1.masterKey, path, samples(path)), sha })
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

/** Openen met de wachtzin; het herstelscherm mag hoogstens één keer en lost één tik op. */
async function openApp(name: string, allowRepair: boolean): Promise<Session> {
  const s = new Session(name)
  sessions.push(s)
  await s.init()
  if (s.getState().phase === 'locked') await s.unlockLocal({ passphrase: PASSPHRASE })
  let state = s.getState()
  if (state.phase === 'repair') {
    expect(allowRepair, 'herstelscherm over de hele app').toBe(true)
    await s.repair(state.needsSecret ? { secret: { passphrase: PASSPHRASE } } : {})
    state = s.getState()
    if (state.phase === 'repair') await s.repair({})
  }
  expect(s.getState().phase).toBe('unlocked')
  return s
}

async function cleanDevice(): Promise<Session> {
  const clean = new Session(`logboek-matrix-schoon-${++counter}`)
  sessions.push(clean)
  await clean.init()
  await clean.link(TOKEN, null, { passphrase: PASSPHRASE })
  expect(clean.getState().phase).toBe('unlocked')
  await store(clean).sync()
  return clean
}

async function remoteKey(): Promise<CryptoKey> {
  const meta = parseMeta(new TextDecoder().decode(Uint8Array.from(Buffer.from(github.files.get(META_PATH)!.content, 'base64'))))
  return unlock(meta, { passphrase: PASSPHRASE })
}

const SEED = new Set<CollectionPath>(['curricula.json.enc', 'checklists.json.enc'])

function putsTo(path: string): number {
  return github.requests.filter((r) => r.method === 'PUT' && r.url.endsWith(`/contents/${path}`)).length
}

/** Elk voorbeeldrecord staat nog op GitHub, behalve in `except` (daar was niets leesbaars meer). */
async function expectSamplesOnGithub(except: CollectionPath[] = []): Promise<void> {
  const key = await remoteKey()
  for (const p of COLLECTION_PATHS) {
    if (except.includes(p)) continue
    const records = await decryptRecords(key, p, Uint8Array.from(Buffer.from(github.files.get(p)!.content, 'base64')))
    expect(records.map((r) => r.id), p).toEqual(expect.arrayContaining(samples(p).map((r) => r.id)))
  }
}

const FAULTS: Fault[] = ['andere sleutel', 'afgekapt', 'ongeldig', 'nieuwere versie', 'nieuwer objectformaat']
const WHERE: Where[] = ['GitHub', 'apparaat', 'beide']

describe('Foutmatrix: één defect bestand blokkeert alleen zijn eigen onderdeel', () => {
  for (const path of COLLECTION_PATHS) {
    for (const fault of FAULTS) {
      for (const where of WHERE) {
        it(`${path} · ${fault} · ${where}`, async () => {
          const { name, db } = await phone()
          const bad = await broken(fault, path)
          if (where !== 'apparaat') github.write(path, toBase64(bad))
          if (where !== 'GitHub') await putObject(db, { path, blob: bad, sha: 'lokaal' })
          const newer = fault === 'nieuwere versie' || fault === 'nieuwer objectformaat'
          // Alleen een lokaal bestand onder een andere sleutel (of afgekapt) is een sleutelprobleem: herstelscherm.
          const keyProblem = where !== 'GitHub' && (fault === 'andere sleutel' || fault === 'afgekapt')
          const s = await openApp(name, keyProblem)
          for (let i = 0; i < 3; i++) {
            await store(s).sync()
            expect(s.getState().phase, `sync ${i + 1}`).toBe('unlocked')
          }
          // De andere onderdelen werken.
          if (path !== 'trips.json.enc') expect(store(s).list('trips.json.enc').map((t) => t.id)).toContain(TRIP_ID)
          // Vóór de tik niets naar GitHub voor dit bestand; alleen echt onleesbare cursussen en checklists vanzelf (en
          // het herstelscherm, waar openApp al tikte).
          const auto = SEED.has(path) && (fault === 'andere sleutel' || fault === 'afgekapt') && where !== 'apparaat'
          if (!auto && !(keyProblem && where === 'beide')) expect(putsTo(path), 'PUT vóór de tik').toBe(0)
          if (fault === 'ongeldig' && where === 'apparaat') expect(store(s).setAside()).toEqual([path])
          // Uitweg: hoogstens één tik per bestand.
          for (const option of await store(s).repairOptions()) {
            if (option.action === 'repair') await store(s).repair(option.path)
            else await store(s).resetFile(option.path)
          }
          await store(s).sync()
          const status = store(s).getStatus()
          if (newer) expect(status).toMatchObject({ kind: 'error', code: 'update' })
          else expect(status, JSON.stringify(status)).toEqual({ kind: 'synced' })
          // Een lokaal bestand van een nieuwere app blijft byte voor byte staan; een ongeldig lokaal bestand staat apart.
          if (newer && where !== 'GitHub') expect([...(await getObject(db, path))!.blob]).toEqual([...bad])
          if (fault === 'ongeldig' && where !== 'GitHub') {
            const aside = (await db.getAll('objects')).filter((o) => o.path.startsWith(`apart/${path}/`))
            expect(aside.map((o) => [...o.blob])).toEqual([[...bad]])
          }
          // Een schoon apparaat koppelt; elk bestand op GitHub is te lezen (behalve een nieuwere versie, die blijft), en
          // elk voorbeeldrecord staat er nog. Alleen wat op beide plekken kapot was, is echt verloren.
          const clean = await cleanDevice()
          if (!newer) expect(store(clean).getStatus()).toEqual({ kind: 'synced' })
          const key = await remoteKey()
          for (const p of COLLECTION_PATHS) {
            if (newer && p === path && where !== 'apparaat') continue
            const file = github.files.get(p)!
            const records = await decryptRecords(key, p, Uint8Array.from(Buffer.from(file.content, 'base64')))
            if (p === path && where === 'beide') continue
            expect(records.map((r) => r.id), p).toEqual(expect.arrayContaining(samples(p).map((r) => r.id)))
          }
        }, 60_000)
      }
    }
  }
})

describe('Foutmatrix: outbox en token op het apparaat', () => {
  for (const fault of ['andere sleutel', 'ongeldig'] as const) {
    it(`outbox · ${fault}`, async () => {
      const { name, db } = await phone()
      const blob = fault === 'andere sleutel' ? await encryptObject(k2.masterKey, 'local/outbox', utf8('{}')) : await encryptObject(k1.masterKey, 'local/outbox', utf8('{kapot'))
      await putLocal(db, 'outbox', blob)
      const s = await openApp(name, fault === 'andere sleutel')
      await store(s).sync()
      expect(store(s).getStatus()).toEqual({ kind: 'synced' })
      await cleanDevice()
      await expectSamplesOnGithub()
    }, 60_000)

    it(`token · ${fault}`, async () => {
      const { name, db } = await phone()
      const blob = fault === 'andere sleutel' ? await encryptObject(k2.masterKey, 'local/token', utf8('{}')) : await encryptObject(k1.masterKey, 'local/token', utf8('{kapot'))
      await putLocal(db, 'token', blob)
      const s = new Session(name)
      sessions.push(s)
      await s.init()
      await s.unlockLocal({ passphrase: PASSPHRASE })
      // Alleen een token kan Olivier zelf geven: het scherm vraagt erom, één keer.
      expect(s.getState()).toMatchObject({ phase: 'repair', report: { tokenNeeded: true } })
      await s.repair({ token: TOKEN })
      if (s.getState().phase === 'repair') await s.repair({})
      expect(s.getState().phase).toBe('unlocked')
      await store(s).sync()
      expect(store(s).getStatus()).toEqual({ kind: 'synced' })
      await cleanDevice()
      await expectSamplesOnGithub()
    }, 60_000)
  }
})

describe('Foutmatrix: combinaties met het herstelscherm', () => {
  const combos: { title: string; local: [CollectionPath, Fault][]; remote: [CollectionPath, Fault][] }[] = [
    { title: 'lokaal dagen andere sleutel + op GitHub planning ongeldig', local: [['legs.json.enc', 'andere sleutel']], remote: [['plans.json.enc', 'ongeldig']] },
    { title: 'lokaal dagen andere sleutel + op GitHub studenten nieuwere versie', local: [['legs.json.enc', 'andere sleutel']], remote: [['students.json.enc', 'nieuwere versie']] },
    { title: 'lokaal dagen andere sleutel + lokaal trips ongeldig', local: [['legs.json.enc', 'andere sleutel'], ['trips.json.enc', 'ongeldig']], remote: [] },
    { title: 'lokaal dagen andere sleutel + op GitHub checklists andere sleutel', local: [['legs.json.enc', 'andere sleutel']], remote: [['checklists.json.enc', 'andere sleutel']] },
  ]
  for (const combo of combos) {
    it(combo.title, async () => {
      const { name, db } = await phone()
      for (const [path, fault] of combo.local) await putObject(db, { path, blob: await broken(fault, path), sha: 'lokaal' })
      for (const [path, fault] of combo.remote) github.write(path, toBase64(await broken(fault, path)))
      const s = await openApp(name, true)
      for (let i = 0; i < 3; i++) {
        await store(s).sync()
        expect(s.getState().phase).toBe('unlocked')
      }
      for (const option of await store(s).repairOptions()) {
        if (option.action === 'repair') await store(s).repair(option.path)
        else await store(s).resetFile(option.path)
      }
      await store(s).sync()
      const newer = combo.remote.some(([, f]) => f === 'nieuwere versie')
      if (newer) expect(store(s).getStatus()).toMatchObject({ code: 'update' })
      else expect(store(s).getStatus()).toEqual({ kind: 'synced' })
      await cleanDevice()
      // Wat op GitHub leesbaar was, of op het apparaat, is er nog; alleen een nieuwere versie op GitHub blijft staan.
      await expectSamplesOnGithub(combo.remote.filter(([, f]) => f === 'nieuwere versie').map(([p]) => p))
    }, 60_000)
  }
})

describe('Foutmatrix: meta.json.enc en het netwerk', () => {
  it('meta.json.enc op GitHub ontbreekt (repo leeg gemaakt): niets geschreven; met de wachtzin zet dit apparaat alles terug', async () => {
    const { name } = await phone()
    github.files.clear()
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toEqual({ phase: 'mismatch', where: 'remote', metaRestorable: true })
    expect(github.requests.some((r) => r.method === 'PUT')).toBe(false)
    await expect(s.restoreRemoteMeta({ passphrase: 'verkeerde nep wachtzin' })).rejects.toMatchObject({ name: 'WrongSecretError' })
    expect(github.requests.some((r) => r.method === 'PUT')).toBe(false)
    await s.restoreRemoteMeta({ passphrase: PASSPHRASE })
    expect(s.getState().phase).toBe('unlocked')
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    const clean = await cleanDevice()
    expect(store(clean).list('trips.json.enc').map((t) => t.id)).toContain(TRIP_ID)
  }, 60_000)

  it('meta.json.enc op GitHub van een ander logboek: scherm "Sleutel past niet", niets geschreven', async () => {
    const { name } = await phone()
    github.write(META_PATH, toBase64(utf8(serializeMeta(k2.meta))))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toEqual({ phase: 'mismatch', where: 'remote' })
    expect(github.requests.some((r) => r.method === 'PUT')).toBe(false)
  }, 60_000)

  it('meta.json.enc op GitHub onleesbaar (kapotte JSON): de app zet de eigen meta terug na één tik, geen doodlopend scherm', async () => {
    const { name } = await phone()
    const broken = github.write(META_PATH, toBase64(utf8('{"kapot')))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    // Nooit iets schrijven zonder tik.
    expect(github.files.get(META_PATH)!.sha).toBe(broken)
    const state = s.getState()
    expect(state).toMatchObject({ phase: 'mismatch', where: 'remote', metaRestorable: true })
    await s.restoreRemoteMeta({ passphrase: PASSPHRASE })
    expect(s.getState().phase).toBe('unlocked')
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    await cleanDevice()
  }, 60_000)

  it('meta.json.enc op dit apparaat kapot: koppelen haalt alles terug van GitHub', async () => {
    const { name, db } = await phone()
    await putObject(db, { path: META_PATH, blob: utf8('{"kapot'), sha: 'lokaal' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    expect(s.getState().phase).toBe('setup')
    await s.link(TOKEN, null, { passphrase: PASSPHRASE })
    expect(s.getState().phase).toBe('unlocked')
    await store(s).sync()
    expect(store(s).list('trips.json.enc').map((t) => t.id)).toContain(TRIP_ID)
  }, 60_000)

  it('geen verbinding bij ontgrendelen: app open met de lokale kopie, daarna gewoon synchroniseren', async () => {
    const { name } = await phone()
    github.offline = true
    const s = await openApp(name, false)
    await store(s).sync()
    expect(store(s).getStatus()).toMatchObject({ kind: 'offline' })
    expect(store(s).list('trips.json.enc').map((t) => t.id)).toContain(TRIP_ID)
    github.offline = false
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
  }, 60_000)

  for (const status of [401, 403, 500, 502] as const) {
    it(`GitHub antwoordt ${status}: app open, melding, daarna gewoon verder`, async () => {
      const { name } = await phone()
      github.forceStatus = status
      const s = await openApp(name, false)
      await store(s).sync()
      expect(s.getState().phase).toBe('unlocked')
      expect(store(s).getStatus()).toMatchObject({ kind: 'error' })
      github.forceStatus = null
      await store(s).sync()
      expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    }, 60_000)
  }
})

describe('Foutmatrix: randgevallen uit de review', () => {
  it('een record zonder deletedAt maakt het bestand niet ongeldig: alle trips blijven staan', async () => {
    const { name, db } = await phone()
    const trip = { ...(samples('trips.json.enc')[0] as unknown as Record<string, unknown>) }
    delete trip.deletedAt
    const blob = await encryptObject(k1.masterKey, 'trips.json.enc', utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 1, records: [trip] })))
    github.write('trips.json.enc', toBase64(blob))
    await putObject(db, { path: 'trips.json.enc', blob, sha: 'lokaal' })
    const s = await openApp(name, false)
    expect(store(s).list('trips.json.enc').map((t) => t.id)).toEqual([TRIP_ID])
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
  }, 60_000)

  it('een lokaal bestand van een nieuwere app: alleen kijken tot bijwerken, nooit iets half of stil verloren', async () => {
    const { name, db } = await phone()
    await putObject(db, { path: 'legs.json.enc', blob: await broken('nieuwere versie', 'legs.json.enc'), sha: 'lokaal' })
    const s = await openApp(name, false)
    expect(store(s).getStatus()).toMatchObject({ kind: 'error', code: 'update', paths: ['legs.json.enc'] })
    await expect(store(s).put('legs.json.enc', { ...(samples('legs.json.enc')[0] as unknown as Record<string, unknown>), id: 'nieuw' } as never)).rejects.toMatchObject({ name: 'NewerSchemaError' })
    // Tot bijwerken nergens wijzigen (ook niet in andere bestanden), zodat niets half wordt opgeslagen; kijken kan wel.
    await expect(store(s).put('reminders.json.enc', { ...(samples('reminders.json.enc')[0] as unknown as Record<string, unknown>), id: 'nieuwe-termijn' } as never)).rejects.toMatchObject({ name: 'NewerSchemaError' })
    expect(store(s).list('reminders.json.enc').map((r) => r.id)).not.toContain('nieuwe-termijn')
    expect(store(s).list('trips.json.enc').map((t) => t.id)).toContain(TRIP_ID)
  }, 60_000)

  it('terugzetten weigert als er databestanden van een ander logboek op GitHub staan (opnieuw aangemaakte repo)', async () => {
    const { name } = await phone()
    github.files.clear()
    // Een ander logboek zonder meta: al zijn databestanden onder een andere sleutel.
    for (const path of COLLECTION_PATHS) github.write(path, toBase64(await encryptRecords(k2.masterKey, path, [])))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toMatchObject({ phase: 'mismatch', metaRestorable: true })
    await expect(s.restoreRemoteMeta({ passphrase: PASSPHRASE })).rejects.toMatchObject({ name: 'KeyMismatchError' })
    expect(s.getState()).toEqual({ phase: 'mismatch', where: 'remote' })
    expect(github.requests.some((r) => r.method === 'PUT')).toBe(false)
  }, 60_000)

  it('een meta die deze app niet kan lezen (format logboek-meta, ongeldige velden) is geen kapotte meta: nooit terugzetten', async () => {
    const { name } = await phone()
    github.write(META_PATH, toBase64(utf8(JSON.stringify({ format: 'logboek-meta', version: 1, passphrase: 'onbekend' }))))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toEqual({ phase: 'mismatch', where: 'remote' })
  }, 60_000)

  it('een oude meta zonder check-veld wordt nooit overschreven', async () => {
    const { name } = await phone()
    const old = { ...(JSON.parse(serializeMeta(k1.meta)) as Record<string, unknown>) }
    delete old.check
    github.write(META_PATH, toBase64(utf8(JSON.stringify(old))))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toEqual({ phase: 'mismatch', where: 'remote' })
    expect(github.requests.some((r) => r.method === 'PUT')).toBe(false)
  }, 60_000)

  it('een ander apparaat zet intussen een meta van een ander logboek neer: niets overschreven', async () => {
    const { name } = await phone()
    github.files.delete(META_PATH)
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    github.beforePut = (path) => {
      if (path === META_PATH) github.write(META_PATH, toBase64(utf8(serializeMeta(k2.meta))))
    }
    await expect(s.restoreRemoteMeta({ passphrase: PASSPHRASE })).rejects.toBeDefined()
    const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
    expect(meta.check).toBe(k2.meta.check)
  }, 60_000)

  it('meta weg én token onleesbaar: het scherm vraagt een token en zet daarna alles terug (geen doodlopend scherm)', async () => {
    const { name, db } = await phone()
    github.files.delete(META_PATH)
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toMatchObject({ phase: 'mismatch', metaRestorable: true })
    await putLocal(db, 'token', await encryptObject(k2.masterKey, 'local/token', utf8('{}')))
    await expect(s.restoreRemoteMeta({ passphrase: PASSPHRASE })).rejects.toMatchObject({ key: 'error.tokenRequired' })
    await s.restoreRemoteMeta({ passphrase: PASSPHRASE }, TOKEN)
    expect(s.getState().phase).toBe('unlocked')
    await store(s).sync()
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    await cleanDevice()
  }, 60_000)

  it('meta weg én één databestand kapot: terugzetten lukt, het kapotte bestand krijgt zijn eigen melding', async () => {
    const { name } = await phone()
    github.files.delete(META_PATH)
    github.write('plans.json.enc', toBase64((await encryptRecords(k1.masterKey, 'plans.json.enc', [])).slice(0, 10)))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    await new Promise((r) => setTimeout(r, 200))
    expect(s.getState()).toMatchObject({ phase: 'mismatch', metaRestorable: true })
    await s.restoreRemoteMeta({ passphrase: PASSPHRASE })
    expect(s.getState().phase).toBe('unlocked')
    await store(s).sync()
    expect(await store(s).repairOptions()).toEqual([{ path: 'plans.json.enc', action: 'repair' }])
    await store(s).repair('plans.json.enc')
    expect(store(s).getStatus()).toEqual({ kind: 'synced' })
    await cleanDevice()
    await expectSamplesOnGithub()
  }, 60_000)
})
