import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta, type Meta } from '../src/crypto/keys'
import { effectiveCurricula } from '../src/model/curricula'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from '../src/model/types'
import { covers, readMarker } from '../src/repair'
import { LOCK_AFTER_MS, Session } from '../src/session'
import { getObject, getSessionKey, openLogboekDb, putObject, putSessionKey, type Db } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import type { Store } from '../src/storage/store'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { loadToken, storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// "Logboek herstellen", nagebouwd naar de toestand op Oliviers telefoon na PR #27 (alle gegevens verzonnen):
// - GitHub: meta.json.enc, trips en legs onder K1 (de wachtzin hoort bij K1); transactions, settings, curricula en
//   students onder een vreemde sleutel K2; plans bestaat niet;
// - telefoon: lokale meta van K1, lokale gegevens, outbox en sessiesleutel onder K2.
// Herstellen gebeurt alleen na een tik plus de juiste wachtzin, en wist nooit iets dat met K1 leesbaar is.

const TOKEN = 'github_pat_HERSTEL_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin van het logboek'
const NOW = '2026-10-26T11:56:00.000Z'
const originalFetch = globalThis.fetch
const wordlist = parseWordlistForTests()

let k1: { meta: Meta; masterKey: CryptoKey; recoveryWords: string[] }
let k2: { meta: Meta; masterKey: CryptoKey }
let github: FakeGithub
let counter = 0
const sessions: Session[] = []

/** Eenvoudige localStorage voor Node (het verslag van "Logboek herstellen" staat daarin, alleen paden). */
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
  globalThis.fetch = ((input: string, init?: RequestInit) =>
    // De woordenlijst voor de herstelcode komt in de app uit public/; hier uit het bestand.
    String(input).endsWith('bip39-en.txt') ? Promise.resolve(new Response(wordlist.join('\n'))) : github.fetch(input, init ?? {})) as typeof fetch
  globalThis.localStorage?.clear()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const s of sessions) s.lock()
  sessions.length = 0
})

// Klare tekst die nooit over de lijn mag. Lang genoeg: drie tekens als 'Nep' komen in willekeurige base64 (de
// ciphertext) gewoon voor, en maakten de test af en toe rood.
const PLAIN = ['Nepweek', 'Nephaven', 'Nepanna', 'Nepcursus']
const week = { id: 'w1', name: 'Nepweek', updatedAt: NOW, deletedAt: null }
const day = { id: 'd1', tripId: 'w1', date: '2026-10-20', fromPlace: 'Nephaven', fromCountry: 'NL', toPlace: 'Nepdorp', toCountry: 'NL', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 12, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'manual', updatedAt: NOW, deletedAt: null }
const tip = { id: 'f1', date: '2026-10-26', kind: 'fooi', amount: 20, currency: 'EUR', source: 'yacht-week', updatedAt: NOW, deletedAt: null }
const settings = { id: 'settings', lastBoat: 'Nepboot', updatedAt: NOW, deletedAt: null }
const editedCourse = { ...SEED_CURRICULA[0]!, name: { nl: 'Nepcursus', en: 'Fake course' }, updatedAt: NOW, deletedAt: null }
const student = { id: 's1', firstName: 'Nepanna', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, archivedAt: null, updatedAt: NOW, deletedAt: null }

const ON_GITHUB_K1: [CollectionPath, SyncRecord[]][] = [['trips.json.enc', [week]], ['legs.json.enc', [day]]]
const ON_GITHUB_K2: [CollectionPath, SyncRecord[]][] = [
  ['transactions.json.enc', [tip]],
  ['settings.json.enc', [settings]],
  ['curricula.json.enc', [editedCourse]],
  ['students.json.enc', [student]],
]

async function putRemote(path: string, key: CryptoKey, records: SyncRecord[]): Promise<string> {
  return github.write(path, toBase64(await encryptRecords(key, path, records)))
}

/** Bouwt de toestand van de telefoon. `token`: onder welke sleutel de token op het apparaat staat. */
async function phone(options: { token: 'k1' | 'k2'; sessionKey: 'fresh' | 'stale' | 'none' }): Promise<{ name: string; db: Db; shas: Map<string, string> }> {
  const name = `logboek-herstel-${++counter}`
  const db = await openLogboekDb(name)
  const shas = new Map<string, string>()
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
  for (const [path, records] of ON_GITHUB_K1) shas.set(path, await putRemote(path, k1.masterKey, records))
  for (const [path, records] of ON_GITHUB_K2) shas.set(path, await putRemote(path, k2.masterKey, records))
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: github.files.get(META_PATH)!.sha })
  for (const [path, records] of [...ON_GITHUB_K1, ...ON_GITHUB_K2]) {
    await putObject(db, { path, blob: await encryptRecords(k2.masterKey, path, records), sha: 'oud' })
  }
  await saveOutbox(db, k2.masterKey, { 'transactions.json.enc': { f1: NOW } })
  await storeToken(db, options.token === 'k1' ? k1.masterKey : k2.masterKey, TOKEN, null)
  if (options.sessionKey !== 'none') {
    const lastUsed = options.sessionKey === 'fresh' ? Date.now() - 1000 : Date.now() - 2 * 60 * 60 * 1000
    await putSessionKey(db, { name: 'masterKey', key: k2.masterKey, lastUsed })
  }
  return { name, db, shas }
}

function puts(): { path: string; sha: string | undefined }[] {
  return github.requests
    .filter((r) => r.method === 'PUT')
    .map((r) => ({ path: decodeURIComponent(r.url.split('/contents/')[1] ?? ''), sha: (JSON.parse(r.body ?? '{}') as { sha?: string }).sha }))
}

async function remoteRecords(path: string, key: CryptoKey): Promise<SyncRecord[]> {
  const file = github.files.get(path)!
  return decryptRecords(key, path, Uint8Array.from(Buffer.from(file.content, 'base64')))
}

function unlockedStore(session: Session): Store {
  const state = session.getState()
  if (state.phase !== 'unlocked') throw new Error(`niet ontgrendeld maar ${state.phase}`)
  return state.store
}

async function expectRepaired(session: Session, shas: Map<string, string>, name: string) {
  expect(session.getState().phase).toBe('unlocked')
  const store = unlockedStore(session)
  await store.sync()
  expect(store.getStatus()).toEqual({ kind: 'synced' })
  // Met K1 leesbaar op GitHub: niet aangeraakt.
  for (const [path] of ON_GITHUB_K1) expect(github.files.get(path)!.sha).toBe(shas.get(path))
  expect(puts().map((p) => p.path)).not.toContain('trips.json.enc')
  expect(puts().map((p) => p.path)).not.toContain('legs.json.enc')
  // Onleesbare bestanden: vervangen door een lege versie onder K1, met de oude SHA als voorwaarde.
  for (const [path] of ON_GITHUB_K2) {
    expect(await remoteRecords(path, k1.masterKey)).toEqual([])
    expect(puts().find((p) => p.path === path)?.sha).toBe(shas.get(path))
  }
  // Alles is weer leesbaar en de app werkt: week en dagen van GitHub, de ASA-cursussen zijn terug.
  for (const path of COLLECTION_PATHS) {
    const file = github.files.get(path)
    if (file) await expect(remoteRecords(path, k1.masterKey), path).resolves.toBeDefined()
  }
  expect(store.list('trips.json.enc').map((t) => t.name)).toEqual(['Nepweek'])
  expect(store.list('legs.json.enc')).toHaveLength(1)
  expect(store.list('transactions.json.enc')).toEqual([])
  expect(effectiveCurricula(store.list('curricula.json.enc')).map((c) => c.id)).toEqual(SEED_CURRICULA.map((c) => c.id))
  expect(readMarker(name)).toBeNull()
  expect(github.requests.some((r) => PLAIN.some((plain) => (r.body ?? '').includes(plain)))).toBe(false)
}

describe('Logboek herstellen: toestand van de telefoon na PR #27', () => {
  it('oude sessiesleutel: wachtzin → "Logboek herstellen" met wat er verloren gaat → één tik → Gesynct', async () => {
    const { name, db, shas } = await phone({ token: 'k1', sessionKey: 'stale' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    expect(s.getState().phase).toBe('locked')
    expect(await getSessionKey(db)).toBeUndefined()

    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toEqual({
      phase: 'repair',
      needsSecret: false,
      report: { lost: ['transactions.json.enc', 'settings.json.enc', 'curricula.json.enc', 'students.json.enc'], localOnly: ['trips.json.enc', 'legs.json.enc'], replaced: [], tokenNeeded: false },
    })
    // Zonder tik: niets gewist en niets geschreven.
    expect(puts()).toEqual([])
    expect(await getObject(db, 'transactions.json.enc')).toBeDefined()

    await s.repair({})
    await expectRepaired(s, shas, name)
    expect(await loadToken(db, k1.masterKey)).toEqual({ token: TOKEN, expiresAt: null })
  }, 60_000)

  it('verse sessiesleutel onder K2: direct "Logboek herstellen"; na de wachtzin eerst tonen wat er verloren gaat, dan pas na een tik herstellen', async () => {
    const { name, db, shas } = await phone({ token: 'k1', sessionKey: 'fresh' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    expect(s.getState()).toEqual({ phase: 'repair', report: null, needsSecret: true })
    expect(await getSessionKey(db)).toBeUndefined()

    await expect(s.repair({ secret: { passphrase: 'verkeerde nep wachtzin' } })).rejects.toMatchObject({ name: 'WrongSecretError' })
    expect(puts()).toEqual([])

    await s.repair({ secret: { passphrase: PASSPHRASE } })
    const state = s.getState()
    expect(state).toMatchObject({ phase: 'repair', needsSecret: false })
    if (state.phase !== 'repair') return
    expect(state.report?.lost).toEqual(['transactions.json.enc', 'settings.json.enc', 'curricula.json.enc', 'students.json.enc'])
    expect(puts()).toEqual([])

    await s.repair({})
    await expectRepaired(s, shas, name)
  }, 60_000)

  it('verse sessiesleutel onder K1, gegevens onder K2: het scherm toont vóór de wachtzin wat er verloren gaat; tik plus wachtzin herstelt', async () => {
    const { name, db, shas } = await phone({ token: 'k1', sessionKey: 'none' })
    await putSessionKey(db, { name: 'masterKey', key: k1.masterKey, lastUsed: Date.now() - 1000 })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    expect(s.getState()).toEqual({
      phase: 'repair',
      needsSecret: true,
      report: { lost: ['transactions.json.enc', 'settings.json.enc', 'curricula.json.enc', 'students.json.enc'], localOnly: ['trips.json.enc', 'legs.json.enc'], replaced: [], tokenNeeded: false },
    })
    expect(await getSessionKey(db)).toBeUndefined()
    expect(puts()).toEqual([])
    await expect(s.repair({})).rejects.toMatchObject({ key: 'error.secretRequired' })
    await s.repair({ secret: { passphrase: PASSPHRASE } })
    await expectRepaired(s, shas, name)
  }, 60_000)

  it('verslag van een eerder bezoek: het scherm toont vóór de wachtzin wat er verloren gaat; tik plus wachtzin herstelt direct', async () => {
    const { name, shas } = await phone({ token: 'k1', sessionKey: 'none' })
    const first = new Session(name)
    sessions.push(first)
    await first.init()
    await first.unlockLocal({ passphrase: PASSPHRASE })
    expect(first.getState().phase).toBe('repair')
    first.lock()

    const s = new Session(name)
    sessions.push(s)
    await s.init()
    expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: true, report: { lost: ['transactions.json.enc', 'settings.json.enc', 'curricula.json.enc', 'students.json.enc'] } })
    await s.repair({ secret: { passphrase: PASSPHRASE } })
    await expectRepaired(s, shas, name)
  }, 60_000)

  it('token onder K2: alleen dan vraagt het scherm een token (GitHub-rechten); daarna dezelfde afloop', async () => {
    const { name, db, shas } = await phone({ token: 'k2', sessionKey: 'stale' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: false, report: { tokenNeeded: true } })
    await expect(s.repair({})).rejects.toMatchObject({ key: 'error.tokenRequired' })
    expect(puts()).toEqual([])
    await s.repair({ token: TOKEN })
    // Met de token erbij is het verslag compleet (ook wat op GitHub leesbaar blijft): eerst opnieuw tonen.
    if (s.getState().phase === 'repair') await s.repair({})
    await expectRepaired(s, shas, name)
    expect(await loadToken(db, k1.masterKey)).toEqual({ token: TOKEN, expiresAt: null })
  }, 60_000)
})

describe('Logboek herstellen: veiligheid', () => {
  it('wist nooit iets dat met K1 leesbaar is: een lokale wijziging onder K1 blijft en gaat naar GitHub', async () => {
    const { name, db } = await phone({ token: 'k1', sessionKey: 'none' })
    const newer = { ...week, name: 'Nepweek hernoemd', updatedAt: '2026-10-26T18:00:00.000Z' }
    await putObject(db, { path: 'trips.json.enc', blob: await encryptRecords(k1.masterKey, 'trips.json.enc', [newer]), sha: 'oud' })
    const ownTip = { ...tip, id: 'f2' }
    // transactions lokaal leesbaar onder K1, op GitHub onder K2: de lokale versie gaat naar GitHub, niets gaat verloren.
    await putObject(db, { path: 'transactions.json.enc', blob: await encryptRecords(k1.masterKey, 'transactions.json.enc', [ownTip]), sha: 'oud' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toMatchObject({ phase: 'repair', report: { lost: ['settings.json.enc', 'curricula.json.enc', 'students.json.enc'], localOnly: ['legs.json.enc'] } })
    await s.repair({})
    const store = unlockedStore(s)
    await store.sync()
    expect(store.getStatus()).toEqual({ kind: 'synced' })
    expect(store.list('trips.json.enc').map((t) => t.name)).toEqual(['Nepweek hernoemd'])
    expect((await remoteRecords('trips.json.enc', k1.masterKey)).map((t) => (t as typeof week).name)).toEqual(['Nepweek hernoemd'])
    expect((await remoteRecords('transactions.json.enc', k1.masterKey)).map((t) => t.id)).toEqual(['f2'])
  }, 60_000)

  it('meta.json.enc op GitHub hoort bij een andere sleutel: niets herstellen, scherm "Sleutel past niet"', async () => {
    const { name, db } = await phone({ token: 'k1', sessionKey: 'none' })
    github.write(META_PATH, toBase64(utf8(serializeMeta(k2.meta))))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toEqual({ phase: 'mismatch', where: 'remote' })
    expect(puts()).toEqual([])
    expect(await getObject(db, 'transactions.json.enc')).toBeDefined()
  }, 60_000)

  it('zonder verbinding: niets gewist; herstellen lukt pas met verbinding', async () => {
    const { name, db, shas } = await phone({ token: 'k1', sessionKey: 'none' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    github.offline = true
    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toMatchObject({ phase: 'repair', report: { lost: ['trips.json.enc', 'legs.json.enc', 'transactions.json.enc', 'settings.json.enc', 'curricula.json.enc', 'students.json.enc'] } })
    await expect(s.repair({})).rejects.toMatchObject({ name: 'NetworkError' })
    expect(await getObject(db, 'transactions.json.enc')).toBeDefined()
    github.offline = false
    await s.repair({})
    await expectRepaired(s, shas, name)
  }, 60_000)

  it('na "Opnieuw beginnen vanaf GitHub" uit PR #27 (lokaal leeg, GitHub onleesbaar): de app opent, cursussen vanzelf, de rest per bestand met één tik', async () => {
    const { name, db } = await phone({ token: 'k1', sessionKey: 'none' })
    for (const path of COLLECTION_PATHS) await db.delete('objects', path)
    await saveOutbox(db, k1.masterKey, {})
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    const store = unlockedStore(s)
    await store.sync()
    // Onleesbare bestanden op GitHub blokkeren de app niet; cursussen (meegeleverd) staan vanzelf weer goed.
    expect(s.getState().phase).toBe('unlocked')
    expect(await remoteRecords('curricula.json.enc', k1.masterKey)).toEqual([])
    expect(store.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: ['transactions.json.enc', 'settings.json.enc', 'students.json.enc'] })
    const options = await store.repairOptions()
    expect(options).toEqual([
      { path: 'transactions.json.enc', action: 'reset' },
      { path: 'settings.json.enc', action: 'reset' },
      { path: 'students.json.enc', action: 'reset' },
    ])
    for (const { path } of options) await store.resetFile(path)
    expect(store.getStatus()).toEqual({ kind: 'synced' })
    for (const [path] of ON_GITHUB_K2) expect(await remoteRecords(path, k1.masterKey)).toEqual([])
    expect(store.list('trips.json.enc').map((t) => t.name)).toEqual(['Nepweek'])
    expect(github.requests.some((r) => PLAIN.some((plain) => (r.body ?? '').includes(plain)))).toBe(false)
  }, 60_000)

  it('regel 10: de sleutel wacht hoogstens 5 minuten op de tik; daarna vraagt het scherm de wachtzin weer', async () => {
    const { name } = await phone({ token: 'k1', sessionKey: 'none' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await s.unlockLocal({ passphrase: PASSPHRASE })
      expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: false })
      vi.advanceTimersByTime(LOCK_AFTER_MS)
    } finally {
      vi.useRealTimers()
    }
    expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: true })
    await expect(s.repair({})).rejects.toMatchObject({ key: 'error.secretRequired' })
    expect(puts()).toEqual([])
  }, 60_000)
})

describe('Logboek herstellen: bevindingen review', () => {
  it('covers: wat als "blijft op GitHub" getoond is, mag niet ongemerkt verloren gaan', () => {
    const shown = { lost: ['transactions.json.enc' as const], localOnly: ['trips.json.enc' as const], replaced: [], tokenNeeded: false }
    expect(covers(shown, { lost: ['transactions.json.enc'], localOnly: ['trips.json.enc'], replaced: [], tokenNeeded: false })).toBe(true)
    expect(covers(shown, { lost: ['transactions.json.enc', 'trips.json.enc'], localOnly: [], replaced: [], tokenNeeded: false })).toBe(false)
    expect(covers(shown, { lost: [], localOnly: ['transactions.json.enc'], replaced: [], tokenNeeded: false })).toBe(true)
    expect(covers(null, { lost: [], localOnly: [], replaced: ['plans.json.enc'], tokenNeeded: false })).toBe(false)
    expect(covers(null, { lost: [], localOnly: [], replaced: [], tokenNeeded: false })).toBe(true)
  })

  it('verlopen of ingetrokken token: het herstelscherm vraagt een token in plaats van vast te lopen', async () => {
    const { name, shas } = await phone({ token: 'k1', sessionKey: 'none' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    github.forceStatus = 401
    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: false, report: { tokenNeeded: true } })
    github.forceStatus = null
    await s.repair({ token: TOKEN })
    if (s.getState().phase === 'repair') await s.repair({})
    await expectRepaired(s, shas, name)
  }, 60_000)

  it('herstelcode in plaats van wachtzin', async () => {
    const { name, shas } = await phone({ token: 'k1', sessionKey: 'fresh' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.repair({ secret: { recoveryCode: k1.recoveryWords.join(' ') } })
    await s.repair({})
    await expectRepaired(s, shas, name)
  }, 60_000)

  it('regel 10 ook na een bevroren tabblad: een bewaarde sleutel ouder dan 5 minuten wordt bij de tik niet gebruikt', async () => {
    const { name, db } = await phone({ token: 'k1', sessionKey: 'none' })
    let now = Date.now()
    const s = new Session(name, () => now)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: false })
    now += LOCK_AFTER_MS
    await expect(s.repair({})).rejects.toMatchObject({ key: 'error.secretRequired' })
    expect(s.getState()).toMatchObject({ phase: 'repair', needsSecret: true })
    expect(puts()).toEqual([])
    expect(await getObject(db, 'transactions.json.enc')).toBeDefined()
  }, 60_000)

  it('een bestand in een nieuwer objectformaat wordt nooit vervangen en blokkeert het herstel niet: "Werk de app bij"', async () => {
    const { name, db } = await phone({ token: 'k1', sessionKey: 'none' })
    const blob = await encryptRecords(k1.masterKey, 'students.json.enc', [student])
    blob[0] = 2
    const sha = github.write('students.json.enc', toBase64(blob))
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    // Het herstel van de rest blijft er niet op hangen; het nieuwere bestand zelf wordt nooit aangeraakt.
    if (s.getState().phase === 'repair') await s.repair({})
    expect(s.getState().phase).toBe('unlocked')
    // Alleen de bestanden onder de vreemde sleutel K2 zijn vervangen, met hun oude SHA als voorwaarde; niets anders.
    expect(puts().map((p) => p.path).sort()).toEqual(['curricula.json.enc', 'settings.json.enc', 'transactions.json.enc'])
    expect(github.files.get('students.json.enc')!.sha).toBe(sha)
    await unlockedStore(s).sync()
    expect(unlockedStore(s).getStatus()).toMatchObject({ kind: 'error', code: 'update' })
    void db
  }, 60_000)

  it('een ander apparaat zet tijdens het herstellen een leesbare versie op GitHub: die blijft staan', async () => {
    const { name, shas } = await phone({ token: 'k1', sessionKey: 'none' })
    const s = new Session(name)
    sessions.push(s)
    await s.init()
    await s.unlockLocal({ passphrase: PASSPHRASE })
    const otherTip = { ...tip, id: 'van-de-laptop' }
    let raced = false
    // Zorg dat de leesbare versie er al staat vóór de PUT.
    const readable = await encryptRecords(k1.masterKey, 'transactions.json.enc', [otherTip])
    github.beforePut = (path) => {
      if (path !== 'transactions.json.enc' || raced) return
      raced = true
      github.write(path, toBase64(readable))
    }
    await s.repair({})
    expect(raced).toBe(true)
    expect(s.getState().phase).toBe('unlocked')
    await unlockedStore(s).sync()
    expect((await remoteRecords('transactions.json.enc', k1.masterKey)).map((r) => r.id)).toEqual(['van-de-laptop'])
    expect(github.files.get('trips.json.enc')!.sha).toBe(shas.get('trips.json.enc'))
  }, 60_000)
})
