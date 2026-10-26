import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { daysUntil, Session } from '../src/session'
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
