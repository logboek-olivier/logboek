import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes, toBase64 } from '../src/crypto/encrypt'
import { Session } from '../src/session'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'

// Fundering (beveiliging): iemand met alleen schrijfrechten op de data-repo (een gelekte token) mag de wachtzin en de
// herstelcode niet op afstand onbruikbaar maken. Het check-veld dekt de verpakte sleutels, niet de salts en rondes: een
// apparaat neemt een meta van GitHub daarom alleen over als de salts en rondes gelijk zijn, of als de sleutel echt
// opnieuw verpakt is (wachtzin gewijzigd). Verzonnen token en wachtzin.

const TOKEN = 'github_pat_METASALT_0123456789abcdefghijklmnopqrstuvwxy'
const PASS = 'nep wachtzin voor de meta-salt-test'
const NEW_PASS = 'nieuwe nep wachtzin voor de test'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
let github: FakeGithub
const sessions: Session[] = []
let counter = 0

beforeEach(() => {
  github = new FakeGithub()
  globalThis.fetch = ((input: string, init: RequestInit) => github.fetch(input, init)) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const s of sessions) s.lock()
  sessions.length = 0
})

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function newLogbook(): Promise<{ name: string; session: Session }> {
  const name = `logboek-meta-salt-${++counter}`
  const session = new Session(name)
  sessions.push(session)
  await session.init()
  await session.finishNewVault(TOKEN, null, await createVault(PASS, wordlist))
  return { name, session }
}

async function reopen(name: string): Promise<Session> {
  const s = new Session(name)
  sessions.push(s)
  await s.init()
  return s
}

describe('meta van GitHub overnemen', () => {
  it('vervalste salts en rondes (check gelijk) worden niet overgenomen: de wachtzin blijft werken', async () => {
    const { name, session } = await newLogbook()
    session.lock()
    const file = github.files.get('meta.json.enc')!
    const meta = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
    meta.passphrase.salt = toBase64(randomBytes(16))
    meta.passphrase.iterations = 10_000_000
    meta.recovery.salt = toBase64(randomBytes(16))
    github.write('meta.json.enc', Buffer.from(JSON.stringify(meta)).toString('base64'), 'sync 2026-10-30T00:00:00.000Z')
    const again = await reopen(name)
    await again.unlockLocal({ passphrase: PASS })
    await pause(200)
    again.lock()
    await pause(50)
    const third = await reopen(name)
    await third.unlockLocal({ passphrase: PASS })
    expect(third.getState().phase).toBe('unlocked')
  })

  it('een echte wachtzinwijziging op een ander apparaat wordt wel overgenomen', async () => {
    const { name: laptopName, session: laptop } = await newLogbook()
    // Een tweede apparaat koppelt hetzelfde logboek.
    const phoneName = `logboek-meta-salt-${++counter}`
    const phone = new Session(phoneName)
    sessions.push(phone)
    await phone.init()
    await phone.link(TOKEN, null, { passphrase: PASS })
    phone.lock()
    await laptop.changePassphrase(PASS, NEW_PASS)
    void laptopName
    // De telefoon ontgrendelt nog met de oude wachtzin en neemt de nieuwe meta over.
    const again = await reopen(phoneName)
    await again.unlockLocal({ passphrase: PASS })
    await pause(200)
    again.lock()
    await pause(50)
    const third = await reopen(phoneName)
    await third.unlockLocal({ passphrase: NEW_PASS })
    expect(third.getState().phase).toBe('unlocked')
  })
})
