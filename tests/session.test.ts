import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { daysUntil, Session } from '../src/session'
import { getSessionKey, openLogboekDb, putSessionKey } from '../src/storage/idb'
import { TOKEN_INVALID_MESSAGE } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// Sessie end-to-end in node: fake-indexeddb en een nagebootste api.github.com via globalThis.fetch.
// Verzonnen token en wachtzin.

const TOKEN_A = 'github_pat_SESSIE_A_0123456789abcdefghijklmnopqrstuvwxyz'
const TOKEN_B = 'github_pat_SESSIE_B_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin voor de sessietest'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch

let github: FakeGithub
let dbCounter = 0
const sessions: Session[] = []

beforeEach(() => {
  github = new FakeGithub()
  globalThis.fetch = ((input: string, init: RequestInit) => github.fetch(input, init)) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  // Vergrendelen ruimt de 5-minutentimer op.
  for (const s of sessions) s.lock()
  sessions.length = 0
})

async function unlockedSession(expiresAt: string | null): Promise<Session> {
  // Eigen database per test: deleteDatabase zou wachten op de open verbinding van de vorige test.
  const session = new Session(`logboek-sessie-${++dbCounter}`)
  sessions.push(session)
  await session.init()
  expect(session.getState().phase).toBe('setup')
  const vault = await createVault(PASSPHRASE, wordlist)
  await session.finishNewVault(TOKEN_A, expiresAt, vault)
  expect(session.getState().phase).toBe('unlocked')
  return session
}

function store(session: Session) {
  const state = session.getState()
  if (state.phase !== 'unlocked') throw new Error('niet ontgrendeld')
  return state.store
}

async function settled(session: Session): Promise<void> {
  await store(session).sync()
}

describe('sessie: hoofdsleutel 5 minuten in IndexedDB (beveiligingsregel 10)', () => {
  async function reopen(name: string, now: () => number): Promise<Session> {
    const next = new Session(name, now)
    sessions.push(next)
    await next.init()
    return next
  }

  async function freshSession(now: () => number): Promise<{ session: Session; name: string }> {
    const name = `logboek-sessie-${++dbCounter}`
    const session = new Session(name, now)
    sessions.push(session)
    await session.init()
    await session.finishNewVault(TOKEN_A, null, await createVault(PASSPHRASE, wordlist))
    await store(session).put('trips.json.enc', { id: 't1', name: 'nep', updatedAt: new Date().toISOString(), deletedAt: null })
    await settled(session)
    session.flushActivity()
    // De opslag gebeurt op de achtergrond; even laten afronden.
    await new Promise((r) => setTimeout(r, 50))
    return { session, name }
  }

  it('verversen binnen 5 minuten: direct ontgrendeld met dezelfde data', async () => {
    let t = 1_000_000
    const { name } = await freshSession(() => t)
    t += 4 * 60 * 1000
    const next = await reopen(name, () => t)
    expect(next.getState().phase).toBe('unlocked')
    expect(store(next).list('trips.json.enc').map((r) => r.name)).toEqual(['nep'])
  })

  it('na 5 minuten: vergrendeld en de sleutel is gewist (ook als de klok daarna terug wordt gezet)', async () => {
    let t = 1_000_000
    const { name } = await freshSession(() => t)
    t += 5 * 60 * 1000
    expect((await reopen(name, () => t)).getState().phase).toBe('locked')
    t -= 5 * 60 * 1000
    expect((await reopen(name, () => t)).getState().phase).toBe('locked')
  })

  it('een klok die achteruit staat telt als verlopen', async () => {
    let t = 1_000_000
    const { name } = await freshSession(() => t)
    t -= 60 * 1000
    expect((await reopen(name, () => t)).getState().phase).toBe('locked')
  })

  it('handmatig vergrendelen wist de opgeslagen sleutel', async () => {
    const t = 1_000_000
    const { session, name } = await freshSession(() => t)
    session.lock()
    await new Promise((r) => setTimeout(r, 50))
    expect((await reopen(name, () => t)).getState().phase).toBe('locked')
  })

  it('openen telt niet als gebruik: na hervatten loopt alleen de resterende tijd', async () => {
    let t = 1_000_000
    const { name } = await freshSession(() => t)
    t += 4 * 60 * 1000
    const next = await reopen(name, () => t)
    expect(next.getState().phase).toBe('unlocked')
    t += 61 * 1000
    expect(next.checkExpiry()).toBe(true)
    expect((await reopen(name, () => t)).getState().phase).toBe('locked')
  })

  it('vergrendelen in één tabblad vergrendelt de andere en schrijft de sleutel niet terug', async () => {
    let t = 1_000_000
    const { session: a, name } = await freshSession(() => t)
    const b = await reopen(name, () => t)
    expect(b.getState().phase).toBe('unlocked')
    a.lock()
    await new Promise((r) => setTimeout(r, 50))
    expect(b.getState().phase).toBe('locked')
    t += 30 * 1000
    b.touch()
    b.flushActivity()
    await new Promise((r) => setTimeout(r, 50))
    expect((await reopen(name, () => t)).getState().phase).toBe('locked')
  })

  it('een sleutel waarvan het wissen bij vergrendelen niet afkwam, wordt toch niet gebruikt', async () => {
    const storage = new Map<string, string>()
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    }
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true })
    try {
      let t = 1_000_000
      const { session, name } = await freshSession(() => t)
      const db = await openLogboekDb(name)
      const kept = await getSessionKey(db)
      expect(kept).toBeDefined()
      t += 1000
      session.lock()
      await new Promise((r) => setTimeout(r, 50))
      // Alsof het wissen in IndexedDB niet doorkwam (app direct gesloten).
      await putSessionKey(db, kept!)
      db.close()
      expect((await reopen(name, () => t)).getState().phase).toBe('locked')
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('touch en checkExpiry vergrendelen na 5 minuten zonder gebruik, ook als de timer niet liep', async () => {
    let t = 1_000_000
    const { session } = await freshSession(() => t)
    t += 3 * 60 * 1000
    session.touch()
    t += 4 * 60 * 1000
    expect(session.checkExpiry()).toBe(false)
    t += 61 * 1000
    expect(session.checkExpiry()).toBe(true)
    expect(session.getState().phase).toBe('locked')
  })
})

describe('sessie en token', () => {
  it('bewaart de vervaldatum versleuteld, wist hem bij vergrendelen en zet hem terug na ontgrendelen', async () => {
    const session = await unlockedSession('2026-12-01')
    await settled(session)
    expect(session.tokenExpiresAt).toBe('2026-12-01')
    session.lock()
    expect(session.tokenExpiresAt).toBeNull()
    expect(session.getState().phase).toBe('locked')
    await session.unlockLocal({ passphrase: PASSPHRASE })
    expect(session.getState().phase).toBe('unlocked')
    expect(session.tokenExpiresAt).toBe('2026-12-01')
    await settled(session)
    // Niets van de token of de datum leesbaar over de lijn.
    const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
    expect(wire).not.toContain(TOKEN_A)
    expect(wire).not.toContain('2026-12-01')
  })

  it('meldt een 401 als verlopen token, houdt de outbox en synct na Token vervangen met een nieuwe Store', async () => {
    const session = await unlockedSession(null)
    await settled(session)
    const previous = store(session)
    github.forceStatus = 401
    await previous.put('trips.json.enc', { id: 't1', name: 'wacht', updatedAt: new Date().toISOString(), deletedAt: null })
    await previous.sync()
    expect(previous.getStatus()).toEqual({ kind: 'error', message: TOKEN_INVALID_MESSAGE, count: 1 })
    expect(previous.pendingCount()).toBe(1)

    // Nieuwe token: controleren moet slagen, dus GitHub antwoordt weer gewoon.
    github.forceStatus = null
    github.requests.length = 0
    const first = session.replaceToken(TOKEN_B, '2027-03-01')
    const second = session.replaceToken(TOKEN_B, '2027-03-01')
    expect(second).toBe(first)
    await first
    const next = store(session)
    expect(next).not.toBe(previous)
    expect(() => previous.get('trips.json.enc')).toThrow('Vergrendeld')
    expect(session.tokenExpiresAt).toBe('2027-03-01')
    await next.sync()
    expect(next.getStatus()).toEqual({ kind: 'synced' })
    expect(next.pendingCount()).toBe(0)
    expect(github.files.has('trips.json.enc')).toBe(true)
    // Alle requests na het vervangen dragen de nieuwe token in de header, nooit in URL of body.
    const auth = github.requests.map((r) => r.body ?? '').join('\n')
    expect(auth).not.toContain(TOKEN_B)
    expect(auth).not.toContain(TOKEN_A)
  })

  it('laat een bewust leeggemaakte vervaldatum leeg, ook als GitHub een header meegeeft', async () => {
    github.forceHeaders = { 'github-authentication-token-expiration': '2026-11-24 12:00:00 UTC' }
    const session = await unlockedSession(null)
    await settled(session)
    expect(session.tokenExpiresAt).toBeNull()
    await session.replaceToken(TOKEN_B, null)
    expect(session.tokenExpiresAt).toBeNull()
    session.lock()
    await session.unlockLocal({ passphrase: PASSPHRASE })
    expect(session.tokenExpiresAt).toBeNull()
  })

  it('rekent dagen tot de vervaldatum in lokale datums, ook over een jaargrens', () => {
    expect(daysUntil('2026-11-24', '2026-10-25')).toBe(30)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
    expect(daysUntil('2026-10-25', '2026-10-25')).toBe(0)
    expect(daysUntil('2026-10-20', '2026-10-25')).toBe(-5)
    expect(daysUntil(null, '2026-10-25')).toBeNull()
  })
})
