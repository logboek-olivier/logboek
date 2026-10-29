import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fromBase64, toBase64, utf8 } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta, type Meta } from '../src/crypto/keys'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from '../src/model/types'
import { Session } from '../src/session'
import { openLogboekDb, putObject } from '../src/storage/idb'
import { saveOutbox } from '../src/storage/outbox'
import type { Store } from '../src/storage/store'
import { decryptRecords, encryptRecords } from '../src/storage/sync'
import { storeToken } from '../src/storage/token'
import { createVault, parseWordlistForTests } from './helpers/vault'

const TOKEN = 'github_pat_GEDRAG_0123456789abcdefghijklmnopqrstuvwxyz'
const PASSPHRASE = 'nep wachtzin van het logboek'
const wordlist = parseWordlistForTests()
const originalFetch = globalThis.fetch
let k1: { meta: Meta; masterKey: CryptoKey }
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

// Gerandomiseerde storingstest met hoe GitHub zich echt gedraagt: een PUT zonder sha op een bestaand bestand geeft 422,
// lezen vlak na schrijven geeft soms nog de vorige versie (of 404), en gelijktijdige commits geven soms 409. Twee
// vensters openen tegelijk na een update die drie nieuwe bestanden toevoegt en slaan door elkaar plaatsen op, met en
// zonder verbinding. Na elke run: alles op GitHub is met de sleutel te lezen en geen enkele opslag is verloren.
// Vaste zaden, dus elke run is herhaalbaar. Alle gegevens zijn verzonnen.

let seed = 1
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

/** GitHub met echte eigenaardigheden: 422 zonder sha, oude versies of 404 vlak na schrijven, conflicten tussen commits. */
class RealGithub {
  files = new Map<string, { sha: string; content: string }>()
  history = new Map<string, ({ sha: string; content: string } | null)[]>()
  n = 0
  inFlight = 0
  offline = false
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    await new Promise((r) => setTimeout(r, Math.floor(rand() * 4)))
    if (this.offline) throw new TypeError('Failed to fetch')
    const method = init.method ?? 'GET'
    const prefix = 'https://api.github.com/repos/logboek-olivier/logboek-data'
    const rest = url.slice(prefix.length)
    if (rest === '') return json(200, {})
    const m = /^\/contents\/(.+)$/.exec(rest)
    if (!m) return json(404, {})
    const path = decodeURIComponent(m[1]!)
    if (method === 'GET') {
      const hist = this.history.get(path) ?? []
      // Soms een oudere versie (of nog 404) vlak na schrijven.
      let file = this.files.get(path) ?? null
      if (hist.length > 0 && rand() < 0.3) file = hist[Math.floor(rand() * hist.length)] ?? null
      if (!file) return json(404, {})
      return json(200, { sha: file.sha, content: `${file.content}\n` })
    }
    const req = JSON.parse(String(init.body)) as { content: string; sha?: string }
    this.inFlight++
    await new Promise((r) => setTimeout(r, Math.floor(rand() * 4)))
    this.inFlight--
    const current = this.files.get(path)
    if (current && !req.sha) return json(422, { message: '"sha" wasn\'t supplied' })
    if (current && req.sha !== current.sha) return json(409, {})
    if (!current && req.sha) return json(422, {})
    if (this.inFlight > 0 && rand() < 0.2) return json(409, { message: 'ref conflict' })
    const hist = this.history.get(path) ?? []
    hist.push(current ?? null)
    this.history.set(path, hist.slice(-2))
    const sha = `sha-${++this.n}`
    this.files.set(path, { sha, content: req.content })
    return json(current ? 200 : 201, { content: { sha } })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeAll(async () => {
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
  }
  k1 = await createVault(PASSPHRASE, wordlist)
}, 30_000)

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const s of sessions) s.lock()
  sessions.length = 0
})

function store(session: Session): Store {
  const state = session.getState()
  if (state.phase !== 'unlocked') throw new Error(`niet ontgrendeld maar ${state.phase}`)
  return state.store
}

const place = (id: string) => ({ id, name: `Nepplaats ${id}`, lat: 18.4, lon: -64.6, updatedAt: new Date().toISOString(), deletedAt: null })

describe('GitHub-gedrag: twee vensters na een update', () => {
  for (const offline of [false, true]) for (let run = 1; run <= 10; run++) {
    it(`${offline ? 'zonder verbinding, ' : ''}run ${run}`, async () => {
      seed = run * 7919 + (offline ? 1 : 0)
      const gh = new RealGithub()
      globalThis.fetch = ((input: string, init?: RequestInit) => gh.fetch(input, init ?? {})) as typeof fetch
      const name = `gedrag-${offline ? 'offline' : 'online'}-${run}`
      const db = await openLogboekDb(name)
      const metaText = serializeMeta(k1.meta)
      gh.files.set(META_PATH, { sha: 'meta-1', content: toBase64(utf8(metaText)) })
      await putObject(db, { path: META_PATH, blob: utf8(metaText), sha: 'meta-1' })
      // Oude versie: places, calendar en de weekafsluitingen bestonden nog niet.
      const NEW: CollectionPath[] = ['places.json.enc', 'calendar.json.enc', 'checklists.json.enc', 'weekreviews.json.enc']
      for (const path of COLLECTION_PATHS) {
        if (NEW.includes(path)) continue
        const records: SyncRecord[] = []
        const blob = await encryptRecords(k1.masterKey, path, records)
        const sha = `old-${path}`
        gh.files.set(path, { sha, content: toBase64(blob) })
        await putObject(db, { path, blob, sha })
      }
      await saveOutbox(db, k1.masterKey, {})
      await storeToken(db, k1.masterKey, TOKEN, null)
      db.close()
      // Update: twee vensters openen tegelijk.
      const open = async () => {
        const s = new Session(name)
        sessions.push(s)
        await s.init()
        if (s.getState().phase === 'locked') await s.unlockLocal({ passphrase: PASSPHRASE })
        return s
      }
      const [a, b] = await Promise.all([open(), open()])
      await Promise.all([store(a).sync(), store(b).sync()])
      if (offline) gh.offline = true
      const ids: string[] = []
      const work = async (s: Session, tag: string) => {
        for (let i = 0; i < 4; i++) {
          if (s.getState().phase !== 'unlocked') return
          const id = `${tag}${i}`
          ids.push(id)
          await store(s).put('places.json.enc', place(id)).catch(() => undefined)
          if (rand() < 0.5) await store(s).sync().catch(() => undefined)
        }
      }
      await Promise.all([work(a, 'a'), work(b, 'b'), store(a).sync(), store(b).sync()])
      for (let i = 0; i < 4; i++) {
        await store(a).sync().catch(() => undefined)
        await store(b).sync().catch(() => undefined)
      }
      let last: Session[] = [a, b]
      if (offline) {
        a.lock()
        b.lock()
        gh.offline = false
        const c = await open()
        await store(c).sync()
        await store(c).sync()
        last = [c]
      }
      // Na een rustige laatste ronde wacht er in geen enkel venster nog iets.
      for (const s of last) await store(s).sync()
      for (const s of last) await store(s).sync()
      for (const s of last) expect(store(s).pendingCount()).toBe(0)

      // Alles op GitHub leesbaar met K1?
      for (const [path, file] of gh.files) {
        if (path === META_PATH) continue
        await expect(decryptRecords(k1.masterKey, path, fromBase64(file.content)), path).resolves.toBeDefined()
      }
      const remote = await decryptRecords(k1.masterKey, 'places.json.enc', fromBase64(gh.files.get('places.json.enc')!.content))
      const missing = ids.filter((id) => !remote.some((r) => r.id === id))
      expect(missing).toEqual([])
    }, 60_000)
  }
})
