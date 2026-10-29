import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEMO_DB, demoNetworkAttempts, demoStore, demoWanted, isDemo, startDemo, stopDemo } from '../src/demo'
import { getLang, setLang } from '../src/i18n'
import { COLLECTION_PATHS } from '../src/model/types'
import { GithubClient, isNetworkBlocked, NetworkError } from '../src/storage/github'
import { DB_NAME, openLogboekDb, type Db } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// PR F: demomodus. Harde regels: tijdens de demo gaat er niets van of naar GitHub (ook niet van de eigen Store, die
// open blijft), de eigen lokale data wordt niet aangeraakt, en uitzetten brengt de eigen data en taal terug.

const TOKEN = 'github_pat_DEMO_0123456789abcdefghijklmnopqrstuvwxyzABCDE'
const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

afterEach(async () => {
  await stopDemo()
  vi.restoreAllMocks()
})

/** De eigen Store met een nep-GitHub die elk verzoek telt. */
async function ownStore(name: string) {
  const github = new FakeGithub()
  const calls: string[] = []
  const fetch: typeof github.fetch = (input, init) => {
    calls.push(String(input))
    return github.fetch(input, init)
  }
  const db = await openLogboekDb(name)
  const store = await Store.open(db, masterKey, new GithubClient(TOKEN, fetch))
  return { store, db, calls }
}

/** Alles in alle onderdelen van een database (objecten, lokale gegevens, sessiesleutel), als vergelijkbare tekst. */
async function snapshot(db: Db): Promise<string> {
  const parts = await Promise.all((['objects', 'local', 'session'] as const).map(async (name) => JSON.stringify(await db.getAll(name), (_k, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v))))
  return parts.join('\n')
}

describe('demomodus', () => {
  it('voorbeelddata in het Engels zonder bedragen, en de demo-Store probeert nooit iets te versturen', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    setLang('nl', false)
    const before = demoNetworkAttempts()
    await startDemo('2026-11-10')
    expect(isDemo()).toBe(true)
    expect(getLang()).toBe('en')
    const store = demoStore()!
    expect(store.list('trips.json.enc').length).toBeGreaterThanOrEqual(3)
    expect(store.list('legs.json.enc').some((l) => l.toPlace === 'Vis')).toBe(true)
    expect(store.list('students.json.enc').length).toBeGreaterThan(0)
    expect(store.list('transactions.json.enc')).toEqual([])
    expect(store.list('trips.json.enc').every((t) => !t.salary)).toBe(true)
    // Opslaan, synchroniseren, vanzelf synchroniseren en controleren: nergens een poging tot netwerk.
    store.enableAutoSync()
    await store.put('legs.json.enc', { ...store.list('legs.json.enc')[0]!, notes: 'demo edit', updatedAt: new Date().toISOString() })
    await store.sync()
    await store.sync({ changedOnly: true })
    expect(await store.check(true)).toBeNull()
    await new Promise((r) => setTimeout(r, 1_200))
    expect(store.getStatus()).toEqual({ kind: 'demo' })
    expect(demoNetworkAttempts()).toBe(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('tijdens de demo synct ook de eigen Store niet (ook niet vanzelf); na stoppen weer wel, met de eigen data en taal', async () => {
    setLang('nl', false)
    const own = await ownStore('logboek-demo-eigen-1')
    await own.store.put('trips.json.enc', { id: 'eigen', name: 'Eigen trip', updatedAt: T0, deletedAt: null })
    await own.store.sync()
    own.store.enableAutoSync()
    const before = own.calls.length
    expect(before).toBeGreaterThan(0)

    await startDemo('2026-11-10')
    expect(isNetworkBlocked()).toBe(true)
    // Een opslag start vanzelf een sync (na 0,8 s): ook die komt niet bij GitHub.
    await own.store.put('trips.json.enc', { id: 'eigen-2', name: 'Eigen trip twee', updatedAt: T0, deletedAt: null })
    await new Promise((r) => setTimeout(r, 1_200))
    await own.store.sync()
    expect(own.calls.length).toBe(before)
    expect(own.store.getStatus().kind).toBe('offline')
    // Elke GitHub-client, ook een nieuwe: het verzoek komt niet eens bij fetch.
    let called = false
    const probe = new GithubClient(TOKEN, () => {
      called = true
      return Promise.reject(new Error('mag niet'))
    })
    await expect(probe.getFile('trips.json.enc')).rejects.toBeInstanceOf(NetworkError)
    expect(called).toBe(false)

    await stopDemo()
    expect(isDemo()).toBe(false)
    expect(isNetworkBlocked()).toBe(false)
    expect(getLang()).toBe('nl')
    await own.store.sync()
    expect(own.calls.length).toBeGreaterThan(before)
    expect(own.store.list('trips.json.enc').map((t) => t.id).sort()).toEqual(['eigen', 'eigen-2'])
  })

  it('een verzoek dat al onderweg was toen de demo begon, wordt afgebroken', async () => {
    const client = new GithubClient(TOKEN, (_input, init) => new Promise((_resolve, reject) => {
      // Een trage verbinding: pas na 30 seconden antwoord, tenzij het verzoek wordt afgebroken.
      const timer = setTimeout(() => reject(new Error('te laat')), 30_000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('afgebroken', 'AbortError'))
      })
    }))
    const outcome = client.getFile('trips.json.enc').then(
      () => 'antwoord',
      (error: unknown) => error,
    )
    const started = Date.now()
    await startDemo('2026-11-10')
    expect(await outcome).toBeInstanceOf(NetworkError)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('de eigen database (DB_NAME) blijft byte voor byte gelijk; de demo-database is na stoppen weg', async () => {
    expect(DEMO_DB).not.toBe(DB_NAME)
    const own = await ownStore(DB_NAME)
    await own.store.put('trips.json.enc', { id: 'eigen', name: 'Eigen trip', updatedAt: T0, deletedAt: null })
    const before = await snapshot(own.db)

    await startDemo('2026-11-10')
    const demo = demoStore()!
    await demo.put('trips.json.enc', { ...demo.list('trips.json.enc')[0]!, name: 'Changed in demo', updatedAt: new Date().toISOString() })
    for (const path of COLLECTION_PATHS) expect(demo.list(path).some((r) => (r as { name?: string }).name === 'Eigen trip')).toBe(false)
    expect(await snapshot(own.db)).toBe(before)
    expect(own.store.list('trips.json.enc').map((t) => t.name)).toEqual(['Eigen trip'])

    await stopDemo()
    expect(await snapshot(own.db)).toBe(before)
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(DEMO_DB)
  })

  it('stoppen terwijl de demo nog start, of een start die mislukt: geen demo, netwerk weer open', async () => {
    const starting = startDemo('2026-11-10')
    await stopDemo()
    await starting.catch(() => undefined)
    expect(isDemo()).toBe(false)
    expect(demoWanted()).toBe(false)
    expect(isNetworkBlocked()).toBe(false)

    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('kapot'))
    await expect(startDemo('2026-11-10')).rejects.toThrow('kapot')
    expect(isDemo()).toBe(false)
    expect(demoWanted()).toBe(false)
    expect(isNetworkBlocked()).toBe(false)
  })
})
