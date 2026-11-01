import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta } from '../src/crypto/keys'
import { COLLECTION_PATHS, type SyncRecord } from '../src/model/types'
import { Session } from '../src/session'
import { deviceId, isDeviceId } from '../src/storage/device'
import { BUILD, commitMessage, parseCommitMessage } from '../src/storage/github'
import { openLogboekDb, putObject } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import type { Store } from '../src/storage/store'
import { encryptRecords } from '../src/storage/sync'
import { storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'
import { put } from './helpers/schrijf'

// PR A, diagnose: elk commitbericht in logboek-data is "sync <ISO-tijd> v<versie> d<apparaat-id>" (regel 9). Meer →
// Opslag toont per bestand welke versie en welk apparaat het laatst schreef, en na elke update controleert de app
// vanzelf. Verzonnen gegevens.

const TOKEN = 'github_pat_DIAGNOSE_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin voor de diagnose'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
let vault: Awaited<ReturnType<typeof createVault>>
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
  vault = await createVault(PASSPHRASE, wordlist)
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

/** Een telefoon met een logboek; elk bestand op GitHub komt van "een ander apparaat" met een oud commitbericht. */
async function phone(): Promise<Store> {
  const name = `logboek-diagnose-${++counter}`
  const db = await openLogboekDb(name)
  github.write(META_PATH, toBase64(utf8(serializeMeta(vault.meta))))
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(vault.meta)), sha: github.files.get(META_PATH)!.sha })
  for (const path of COLLECTION_PATHS) {
    const records: SyncRecord[] = path === 'trips.json.enc' ? [{ id: 'w1', name: 'Nepweek', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null } as SyncRecord] : []
    const sha = github.write(path, toBase64(await encryptRecords(vault.masterKey, path, records)))
    await putObject(db, { path, blob: await encryptRecords(vault.masterKey, path, records), sha })
  }
  await saveOutbox(db, vault.masterKey, {})
  await storeToken(db, vault.masterKey, TOKEN, null)
  db.close()
  const s = new Session(name)
  sessions.push(s)
  await s.init()
  if (s.getState().phase === 'locked') await s.unlockLocal({ passphrase: PASSPHRASE })
  const state = s.getState()
  if (state.phase !== 'unlocked') throw new Error(`niet ontgrendeld maar ${state.phase}`)
  return state.store
}

describe('Commitbericht met versie en apparaat', () => {
  it('"sync <ISO-tijd> v<versie> d<apparaat-id>", en terug te lezen; oudere berichten hebben geen versie of apparaat', () => {
    const message = commitMessage(new Date('2026-10-29T08:00:00.000Z'), '1.0.0+6d71ec9', '0a1b2c3d')
    expect(message).toBe('sync 2026-10-29T08:00:00.000Z v1.0.0+6d71ec9 d0a1b2c3d')
    expect(parseCommitMessage(message)).toEqual({ at: '2026-10-29T08:00:00.000Z', version: '1.0.0+6d71ec9', device: '0a1b2c3d' })
    expect(parseCommitMessage('sync 2026-10-01T00:00:00.000Z')).toEqual({ at: '2026-10-01T00:00:00.000Z', version: null, device: null })
    expect(parseCommitMessage('Initial commit')).toEqual({ at: null, version: null, device: null })
  })

  it('het apparaat-id is willekeurig, acht hexadecimale tekens, en blijft op dit apparaat hetzelfde', () => {
    const id = deviceId()
    expect(isDeviceId(id)).toBe(true)
    expect(deviceId()).toBe(id)
    expect(globalThis.localStorage.getItem('logboek-apparaat')).toBe(id)
    // Sitegegevens gewist midden in een sessie: in deze sessie blijft het id hetzelfde (en wordt weer bewaard).
    globalThis.localStorage.clear()
    expect(deviceId()).toBe(id)
    expect(globalThis.localStorage.getItem('logboek-apparaat')).toBe(id)
  })

  it('elke schrijfactie naar GitHub gebruikt het nieuwe bericht, zonder inhoud', async () => {
    const s = await phone()
    await put(s, 'trips.json.enc', { id: 'w2', name: 'Nepweek twee', updatedAt: new Date().toISOString(), deletedAt: null })
    await s.sync()
    const puts = github.requests.filter((r) => r.method === 'PUT')
    expect(puts.length).toBeGreaterThan(0)
    for (const put of puts) {
      const message = JSON.parse(put.body ?? '{}').message as string
      expect(message).toMatch(/^sync \d{4}-\d{2}-\d{2}T\S+ v\S+ d[0-9a-f]{8}$/)
      expect(message).toContain(`v${BUILD} d${deviceId()}`)
      expect(message).not.toContain('Nepweek')
    }
  })
})

describe('Meer → Opslag: wie schreef het laatst', () => {
  it('per bestand de versie en het apparaat van de laatste schrijfactie; een ouder bericht zonder', async () => {
    const s = await phone()
    await put(s, 'trips.json.enc', { id: 'w2', name: 'Nepweek twee', updatedAt: new Date().toISOString(), deletedAt: null })
    await s.sync()
    // Een ander apparaat met een andere versie schreef de agenda.
    const calendar = await encryptRecords(vault.masterKey, 'calendar.json.enc', [])
    const current = github.files.get('calendar.json.enc')!
    github.files.set('calendar.json.enc', { sha: current.sha, content: toBase64(calendar) })
    github.commits.set('calendar.json.enc', [...(github.commits.get('calendar.json.enc') ?? []), 'sync 2026-10-29T07:00:00.000Z v0.9.0+abc1234 d12345678'])
    const check = await s.check(false, -1)
    const byPath = new Map(check!.files.map((f) => [f.path, f]))
    expect(byPath.get('trips.json.enc')?.writer).toEqual({ version: BUILD, device: deviceId() })
    expect(byPath.get('calendar.json.enc')?.writer).toEqual({ version: '0.9.0+abc1234', device: '12345678' })
    expect(byPath.get('plans.json.enc')?.writer).toEqual({ version: null, device: null })
    // Bewaard in het verslag (alleen versie en id), dus ook na opnieuw openen te zien.
    expect(s.storageLog().check?.files.find((f) => f.path === 'trips.json.enc')?.writer).toEqual({ version: BUILD, device: deviceId() })
  })

  it('geeft de commits-API een fout, dan gaat de controle gewoon door, zonder schrijver', async () => {
    const s = await phone()
    await s.sync()
    github.failCommits = true
    const check = await s.check(false, -1)
    expect(check).not.toBeNull()
    expect(check!.files.every((f) => f.writer === undefined)).toBe(true)
    expect(check!.files.find((f) => f.path === 'trips.json.enc')?.state).toBe('gelijk')
  })
})

describe('Na een update vanzelf controleren', () => {
  it('een andere build dan bij de vorige controle: direct opnieuw; dezelfde build: pas na een week', async () => {
    const s = await phone()
    await s.sync()
    await s.check(false, -1)
    const first = s.storageLog().check!
    expect(first.build).toBe(BUILD)
    const gets = () => github.requests.filter((r) => r.method === 'GET' && r.url.includes('/contents/')).length
    const before = gets()
    await s.weeklyCheck(Date.parse(first.at) + 60_000, -1)
    expect(gets()).toBe(before)
    await s.weeklyCheck(Date.parse(first.at) + 60_000, -1, 'nieuwe-versie+abcdef0')
    expect(gets()).toBeGreaterThan(before)
    expect(s.storageLog().check!.at >= first.at).toBe(true)
  })
})
