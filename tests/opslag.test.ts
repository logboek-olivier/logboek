import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptObject, fromBase64, toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, parseMeta, serializeMeta, unlock, WrongSecretError, type Meta } from '../src/crypto/keys'
import { NewerSchemaError } from '../src/model/schema'
import { COLLECTION_PATHS, type CollectionPath, type Place, type SyncRecord } from '../src/model/types'
import { Session } from '../src/session'
import { applyRestore, encodeBackup, InvalidBackupError, openBackup, restorePlan } from '../src/storage/backup'
import { openLogboekDb, putObject } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import { checkHasProblem } from '../src/storage/storage-log'
import { CHECK_EVERY_MS, Store } from '../src/storage/store'
import { GithubClient } from '../src/storage/github'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// PR A, "Data eerst": opslaan moet gewoon werken. Alle gegevens zijn verzonnen.
// - Twee vensters van de app (het Chrome-tabblad en de geïnstalleerde app delen dezelfde opslag) overschreven elkaars
//   lokale kopie: wat het ene venster opsloeg, kon het andere wegschrijven. Ook bij het eerste aanmaken van een nieuw
//   bestand na een update.
// - Vergrendelen of sluiten midden in het opslaan liet de opslag stil vallen.
// - Een nieuw bestand werd aangemaakt met een PUT zonder sha, ook als GitHub vlak na het schrijven van een ander
//   venster nog 404 gaf; en wat GitHub na het aanmaken teruggaf, werd niet gecontroleerd.

const TOKEN = 'github_pat_OPSLAG_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin van het logboek'
const NOW = '2026-10-29T08:00:00.000Z'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
let k1: Awaited<ReturnType<typeof createVault>>
let k2: Awaited<ReturnType<typeof createVault>>
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
const place = (id: string): Place => ({ id, name: `Nepplaats ${id}`, lat: 18.4, lon: -64.6, updatedAt: new Date().toISOString(), deletedAt: null })

/**
 * Telefoon met een logboek onder K1, bijgewerkt naar een versie met een nieuw bestand: `fresh` bestaat nog niet, niet op
 * GitHub en niet op het apparaat (zoals places.json.enc de eerste keer).
 */
async function phone(fresh: CollectionPath[] = []): Promise<string> {
  const name = `logboek-opslag-${++counter}`
  const db = await openLogboekDb(name)
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: github.files.get(META_PATH)!.sha })
  for (const path of COLLECTION_PATHS) {
    if (fresh.includes(path)) continue
    const records: SyncRecord[] = path === 'trips.json.enc' ? [week] : []
    const sha = github.write(path, toBase64(await encryptRecords(k1.masterKey, path, records)))
    await putObject(db, { path, blob: await encryptRecords(k1.masterKey, path, records), sha })
  }
  await saveOutbox(db, k1.masterKey, {})
  await storeToken(db, k1.masterKey, TOKEN, null)
  db.close()
  return name
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

async function remote(path: CollectionPath, key = k1.masterKey): Promise<SyncRecord[]> {
  return decryptRecords(key, path, fromBase64(github.files.get(path)!.content))
}

/** Een schoon apparaat met alleen de wachtzin: elk bestand op GitHub is te lezen, koppelen geeft een gesynct logboek. */
async function cleanDeviceReadsAll(): Promise<Store> {
  const meta = parseMeta(new TextDecoder().decode(fromBase64(github.files.get(META_PATH)!.content)))
  const key = await unlock(meta, { passphrase: PASSPHRASE })
  for (const path of COLLECTION_PATHS) {
    const file = github.files.get(path)
    if (file) await expect(decryptRecords(key, path, fromBase64(file.content)), path).resolves.toBeDefined()
  }
  const clean = new Session(`logboek-opslag-schoon-${++counter}`)
  sessions.push(clean)
  await clean.init()
  await clean.link(TOKEN, null, { passphrase: PASSPHRASE })
  await store(clean).sync()
  expect(store(clean).getStatus()).toEqual({ kind: 'synced' })
  return store(clean)
}

describe('Opslaan: één schrijver, niets verloren', () => {
  it('twee vensters zonder verbinding slaan na een update allebei iets op in het nieuwe bestand: niets gaat verloren', async () => {
    const name = await phone(['places.json.enc'])
    const a = await open(name)
    const b = await open(name)
    github.offline = true
    await store(a).put('places.json.enc', place('a1'))
    await store(b).put('places.json.enc', place('b1'))
    await store(a).put('places.json.enc', place('a2'))
    // Beide vensters dicht, daarna opnieuw open met verbinding.
    a.lock()
    b.lock()
    github.offline = false
    const again = await open(name)
    expect(store(again).list('places.json.enc').map((p) => p.id).sort()).toEqual(['a1', 'a2', 'b1'])
    await store(again).sync()
    expect((await remote('places.json.enc')).map((p) => p.id).sort()).toEqual(['a1', 'a2', 'b1'])
    const clean = await cleanDeviceReadsAll()
    expect(clean.list('places.json.enc')).toHaveLength(3)
  }, 60_000)

  it('een venster ziet wat het andere opsloeg en synct het mee', async () => {
    const name = await phone()
    const a = await open(name)
    const b = await open(name)
    await Promise.all([store(a).sync(), store(b).sync()])
    await store(a).put('places.json.enc', place('a1'))
    // Het andere venster krijgt het bericht en neemt de opslag over (BroadcastChannel), of uiterlijk bij zijn sync.
    await store(b).sync()
    expect(store(b).list('places.json.enc').map((p) => p.id)).toEqual(['a1'])
    expect((await remote('places.json.enc')).map((p) => p.id)).toEqual(['a1'])
  }, 60_000)

  it('vergrendelen of sluiten midden in het opslaan: de opslag wordt afgemaakt en komt daarna op GitHub', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).sync()
    const saving = store(s).put('places.json.enc', place('p1'))
    s.lock()
    await saving
    const again = await open(name)
    expect(store(again).list('places.json.enc').map((p) => p.id)).toEqual(['p1'])
    await store(again).sync()
    expect((await remote('places.json.enc')).map((p) => p.id)).toEqual(['p1'])
    await cleanDeviceReadsAll()
  }, 60_000)

  it('na opslaan eerst "Opgeslagen", daarna vanzelf "Gesynct"', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).sync()
    await store(s).put('places.json.enc', place('p1'))
    const { savedAt, syncedAt } = store(s).savedTimes()
    expect(savedAt).toBeGreaterThan(syncedAt)
    expect(store(s).getStatus()).toMatchObject({ kind: 'pending', count: 1 })
    // De sync start vanzelf kort na het opslaan.
    await expect.poll(() => store(s).getStatus(), { timeout: 5_000 }).toEqual({ kind: 'synced' })
    expect(store(s).savedTimes().syncedAt).toBeGreaterThanOrEqual(store(s).savedTimes().savedAt)
    expect((await remote('places.json.enc')).map((p) => p.id)).toEqual(['p1'])
  }, 60_000)
})

describe('Een nieuw bestand aanmaken: op één plek, na de sleutelcontrole', () => {
  it('GitHub geeft vlak na het aanmaken door een ander venster nog 404: geen PUT zonder sha over het bestaande bestand', async () => {
    const name = await phone(['places.json.enc'])
    const a = await open(name)
    await store(a).put('places.json.enc', place('a1'))
    await store(a).sync()
    expect(github.files.has('places.json.enc')).toBe(true)
    // Een tweede venster (of apparaat) synct; GitHub loopt nog even achter en geeft bij de eerste blik 404.
    const b = await open(name)
    await store(b).put('places.json.enc', place('b1'))
    github.notFoundReads.set('places.json.enc', 1)
    const before = github.requests.length
    await store(b).sync()
    const blindPuts = github.requests.slice(before).filter((r) => r.method === 'PUT' && r.url.endsWith('/places.json.enc') && !(JSON.parse(r.body ?? '{}') as { sha?: string }).sha)
    expect(blindPuts).toEqual([])
    expect((await remote('places.json.enc')).map((p) => p.id).sort()).toEqual(['a1', 'b1'])
    await cleanDeviceReadsAll()
  }, 60_000)

  it('elk bestand dat na een update voor het eerst op GitHub komt, is met de sleutel uit meta.json.enc en zijn eigen pad te lezen', async () => {
    const fresh: CollectionPath[] = ['places.json.enc', 'calendar.json.enc', 'checklists.json.enc']
    const name = await phone(fresh)
    const s = await open(name)
    await store(s).sync()
    for (const path of fresh) {
      const puts = github.requests.filter((r) => r.method === 'PUT' && r.url.endsWith(`/${path}`))
      expect(puts, path).toHaveLength(1)
      await expect(remote(path)).resolves.toEqual([])
    }
    // De sleutelcontrole (meta.json.enc lezen) ging aan elk nieuw bestand vooraf.
    const firstPut = github.requests.findIndex((r) => r.method === 'PUT')
    const metaRead = github.requests.findIndex((r) => r.method === 'GET' && r.url.endsWith(`/${META_PATH}`))
    expect(metaRead).toBeGreaterThanOrEqual(0)
    expect(metaRead).toBeLessThan(firstPut)
    await cleanDeviceReadsAll()
  }, 60_000)

  it('geeft GitHub voor een net aangemaakt bestand iets onleesbaars terug, dan meldt dezelfde sync het meteen met de soort defect', async () => {
    const name = await phone(['places.json.enc'])
    const db = await openLogboekDb(name)
    const s = await Store.open(db, k1.masterKey, new GithubClient(TOKEN, github.fetch), k1.meta.check ?? null)
    // Wat GitHub na het aanmaken teruggeeft, is niet wat de app schreef (bijvoorbeeld onder een andere sleutel).
    const foreign = toBase64(await encryptRecords(k2.masterKey, 'places.json.enc', []))
    github.afterPut = (path, sha) => {
      if (path === 'places.json.enc') {
        github.files.set(path, { sha, content: foreign })
        github.afterPut = null
      }
    }
    await s.sync()
    expect(s.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['places.json.enc'] })
    s.lock()
    db.close()
  }, 60_000)
})

describe('Controleer nu', () => {
  it('na een sync: alles gelijk en leesbaar; de uitkomst bevat alleen paden en aantallen', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).put('places.json.enc', place('p1'))
    const result = await store(s).check()
    expect(result).not.toBeNull()
    expect(checkHasProblem(result!)).toBe(false)
    expect(result!.files.find((f) => f.path === 'places.json.enc')).toMatchObject({ local: 1, remote: 1, state: 'gelijk' })
    expect(result!.files.find((f) => f.path === 'trips.json.enc')).toMatchObject({ local: 1, remote: 1, state: 'gelijk' })
    const saved = JSON.stringify(store(s).storageLog())
    expect(saved).not.toContain('Nepplaats')
    expect(saved).not.toContain('Nepweek')
  }, 60_000)

  it('vindt een verschil, een onleesbaar en een ontbrekend bestand', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).put('reminders.json.enc', { id: 'r1', title: 'Neptermijn', date: '2026-11-01', kind: 'deadline', doneAt: null, updatedAt: NOW, deletedAt: null })
    await store(s).sync()
    // Na de sync verandert GitHub buiten de app om.
    const changed: SyncRecord = { ...week, updatedAt: '2026-10-29T09:00:00.000Z' }
    github.write('trips.json.enc', toBase64(await encryptRecords(k1.masterKey, 'trips.json.enc', [changed])))
    github.write('places.json.enc', toBase64(await encryptRecords(k2.masterKey, 'places.json.enc', [])))
    github.files.delete('reminders.json.enc')
    const result = await store(s).check(false)
    const byPath = new Map(result!.files.map((f) => [f.path, f]))
    expect(byPath.get('trips.json.enc')).toMatchObject({ state: 'verschil', differences: 1 })
    expect(byPath.get('places.json.enc')).toMatchObject({ state: 'onleesbaar', reason: 'DecryptError/sleutel' })
    expect(byPath.get('reminders.json.enc')).toMatchObject({ state: 'ontbreekt', local: 1 })
    expect(byPath.get('legs.json.enc')).toMatchObject({ state: 'gelijk' })
    expect(checkHasProblem(result!)).toBe(true)
  }, 60_000)

  it('vanzelf één keer per week, na een geslaagde sync', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).sync()
    await expect.poll(() => store(s).storageLog().check, { timeout: 5_000 }).not.toBeNull()
    const first = store(s).storageLog().check!.at
    const gets = () => github.requests.filter((r) => r.method === 'GET').length
    const before = gets()
    await store(s).weeklyCheck(Date.parse(first) + CHECK_EVERY_MS - 60_000)
    expect(gets()).toBe(before)
    await store(s).weeklyCheck(Date.parse(first) + CHECK_EVERY_MS + 60_000)
    expect(gets()).toBeGreaterThan(before)
  }, 60_000)
})

describe('Back-up zonder laptop', () => {
  async function backupOf(s: Session): Promise<string> {
    return store(s).exportBackup()
  }

  it('is volledig versleuteld en alleen te openen met de wachtzin of herstelcode', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).put('places.json.enc', place('p1'))
    const text = await backupOf(s)
    expect(text).not.toContain('Nepplaats')
    expect(text).not.toContain('Nepweek')
    expect(text).not.toContain(TOKEN)
    await expect(openBackup(text, { passphrase: 'verkeerde wachtzin' })).rejects.toBeInstanceOf(WrongSecretError)
    const byPassphrase = await openBackup(text, { passphrase: PASSPHRASE })
    expect(byPassphrase.files.get('places.json.enc')!.map((r) => r.id)).toEqual(['p1'])
    const byRecovery = await openBackup(text, { recoveryCode: k1.recoveryWords.join(' '), wordlist })
    expect(byRecovery.files.get('trips.json.enc')!.map((r) => r.id)).toEqual(['w1'])
  }, 60_000)

  it('terugzetten brengt alleen terug wat helemaal ontbreekt: zelf verwijderd blijft weg', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).put('places.json.enc', place('p1'))
    await store(s).put('places.json.enc', place('p2'))
    const backup = await openBackup(await backupOf(s), { passphrase: PASSPHRASE })
    await store(s).remove('places.json.enc', 'p2')
    const plan = restorePlan(store(s), backup)
    expect(plan.every((item) => item.back.length === 0)).toBe(true)
    expect(plan.find((p) => p.path === 'places.json.enc')).toMatchObject({ inBackup: 2 })
  }, 60_000)

  it('terugzetten in een leeg logboek toont vooraf wat terugkomt, zet het terug en is ongedaan te maken', async () => {
    const name = await phone()
    const s = await open(name)
    await store(s).put('places.json.enc', place('p1'))
    const text = await backupOf(s)
    s.lock()
    // GitHub en de telefoon zijn het logboek kwijt; Olivier begint opnieuw (een ander logboek, K2) met één eigen plaats.
    const name2 = `logboek-opslag-leeg-${++counter}`
    const db2 = await openLogboekDb(name2)
    github.files.clear()
    github.write(META_PATH, toBase64(utf8(serializeMeta(k2.meta))))
    await putObject(db2, { path: META_PATH, blob: utf8(serializeMeta(k2.meta)), sha: github.files.get(META_PATH)!.sha })
    await storeToken(db2, k2.masterKey, TOKEN, null)
    db2.close()
    const other = new Session(name2)
    sessions.push(other)
    await other.init()
    await other.unlockLocal({ passphrase: 'nep wachtzin van een ander logboek' })
    await store(other).put('places.json.enc', place('n1'))
    const plan = restorePlan(store(other), await openBackup(text, { passphrase: PASSPHRASE }))
    expect(plan.find((p) => p.path === 'places.json.enc')!.back.map((r) => r.id)).toEqual(['p1'])
    expect(plan.find((p) => p.path === 'trips.json.enc')!.back.map((r) => r.id)).toEqual(['w1'])
    const undo = await applyRestore(store(other), plan)
    expect(store(other).list('places.json.enc').map((p) => p.id).sort()).toEqual(['n1', 'p1'])
    expect(store(other).list('trips.json.enc').map((p) => p.id)).toEqual(['w1'])
    await store(other).sync()
    // Op GitHub onder de sleutel van het nieuwe logboek.
    expect((await remote('places.json.enc', k2.masterKey)).filter((r) => r.deletedAt === null).map((r) => r.id).sort()).toEqual(['n1', 'p1'])
    await undo()
    expect(store(other).list('places.json.enc').map((p) => p.id)).toEqual(['n1'])
    expect(store(other).list('trips.json.enc')).toEqual([])
  }, 60_000)

  it('weigert een beschadigd bestand en een back-up van een nieuwere versie', async () => {
    const name = await phone()
    const s = await open(name)
    const text = await backupOf(s)
    await expect(openBackup('geen back-up', { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(InvalidBackupError)
    const parsed = JSON.parse(text) as { version: number; payload: string }
    await expect(openBackup(JSON.stringify({ ...parsed, version: 2 }), { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(NewerSchemaError)
    await expect(openBackup(JSON.stringify({ ...parsed, payload: parsed.payload.slice(0, 40) }), { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(InvalidBackupError)
    // Een bestand in de back-up van een nieuwere schemaversie: "Werk de app bij", niets terugzetten.
    const base = JSON.parse(await encodeBackup(k1.meta as Meta, k1.masterKey, new Map())) as Record<string, unknown>
    const inner = { createdAt: NOW, files: { 'trips.json.enc': JSON.stringify({ format: 'logboek-collection', schemaVersion: 99, records: [] }) } }
    const payload = toBase64(await encryptObject(k1.masterKey, 'backup/inhoud', utf8(JSON.stringify(inner))))
    await expect(openBackup(JSON.stringify({ ...base, payload }), { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(NewerSchemaError)
  }, 60_000)
})
