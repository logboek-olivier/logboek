import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session } from '../src/session'
import { DATA_REPO, isRepoName } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { loadToken, repoOf, storeToken } from '../src/storage/token'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// Fundering, fase 5: een tweede gebruiker (een vriend) met een eigen data-repo, token en sleutel. De standaard blijft de
// repo van Olivier, zodat zijn opslag niets verandert. Verzonnen token, wachtzin en repo.

const TOKEN = 'github_pat_VRIEND_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin van een vriend'
const FRIEND_REPO = 'nepvriend/mijn-logboek'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
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

describe('reponaam', () => {
  it('alleen eigenaar/naam', () => {
    expect(isRepoName('nepvriend/mijn-logboek')).toBe(true)
    expect(isRepoName(DATA_REPO)).toBe(true)
    for (const bad of ['', 'zonder-slash', 'a/b/c', 'https://github.com/a/b', '../x', 'a/..', 'a /b']) expect(isRepoName(bad), bad).toBe(false)
  })

  it('de token bewaart een eigen repo; zonder (oudere opslag of Olivier) geldt de standaard', async () => {
    const db = await openLogboekDb(`logboek-tweede-${++counter}`)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await storeToken(db, key, TOKEN, null, FRIEND_REPO)
    expect(repoOf(await loadToken(db, key))).toBe(FRIEND_REPO)
    await storeToken(db, key, TOKEN, null)
    expect(await loadToken(db, key)).toEqual({ token: TOKEN, expiresAt: null })
    expect(repoOf(await loadToken(db, key))).toBe(DATA_REPO)
  })
})

describe('een vriend met een eigen repo', () => {
  it('nieuw logboek, vergrendelen en ontgrendelen: alles gaat naar de eigen repo, nooit naar die van Olivier', async () => {
    github.repo = FRIEND_REPO
    const name = `logboek-tweede-${++counter}`
    const session = new Session(name)
    sessions.push(session)
    await session.init()
    await session.checkEmptyRepo(TOKEN, FRIEND_REPO)
    await session.finishNewVault(TOKEN, null, await createVault(PASSPHRASE, wordlist), FRIEND_REPO)
    expect(session.getState().phase).toBe('unlocked')
    session.lock()
    await new Promise((r) => setTimeout(r, 50))
    const again = new Session(name)
    sessions.push(again)
    await again.init()
    expect(again.getState().phase).toBe('locked')
    await again.unlockLocal({ passphrase: PASSPHRASE })
    expect(again.getState().phase).toBe('unlocked')
    const state = again.getState()
    if (state.phase === 'unlocked') await state.store.sync()
    expect(github.requests.length).toBeGreaterThan(0)
    expect(github.requests.every((r) => r.url.includes(`/repos/${FRIEND_REPO}`))).toBe(true)
    expect(github.files.has('meta.json.enc')).toBe(true)
  })
})
