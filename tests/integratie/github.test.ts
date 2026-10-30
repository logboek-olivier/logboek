import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encryptRecords } from '../../src/storage/sync'
import { META_PATH, serializeMeta } from '../../src/crypto/keys'
import { toBase64, utf8 } from '../../src/crypto/encrypt'
import { COLLECTION_PATHS, type CollectionPath, type Place, type Reminder, type Trip } from '../../src/model/types'
import { classify } from '../../src/storage/evidence'
import { GithubClient } from '../../src/storage/github'
import { openLogboekDb, putObject } from '../../src/storage/idb'
import { integrityEvents } from '../../src/storage/integrity'
import { Store } from '../../src/storage/store'
import { createVault, parseWordlistForTests } from '../helpers/vault'
import { branchFetch, createBranch, deleteBranch, target, TOKEN } from './echte-github'

// Integratietest tegen de echte GitHub-API (alleen met LOGBOEK_IT_TOKEN, in CI). Twee nep-apparaten met één testsleutel
// schrijven naar een tijdelijke branch van deze repo: alle bestanden aanmaken, direct teruglezen na schrijven,
// gelijktijdig schrijven, "herladen", een onleesbare versie van een ander logboek en "Alles herstellen", en een schoon
// apparaat dat alles leest. Na elke stap: elk bestand op GitHub is met de sleutel te lezen. Alleen nepdata.

const t = target('node')
const wordlist = parseWordlistForTests()
let k1: Awaited<ReturnType<typeof createVault>>
let k2: Awaited<ReturnType<typeof createVault>>
let counter = 0
const T = () => new Date().toISOString()

const client = () => new GithubClient(TOKEN, branchFetch(t))

async function device(): Promise<Store> {
  const db = await openLogboekDb(`logboek-integratie-${++counter}`)
  const meta = await client().getFile(META_PATH)
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(k1.meta)), sha: meta?.sha ?? null })
  return Store.open(db, k1.masterKey, client(), k1.meta.check ?? null)
}

/** De bestanden die de test raakt, zijn op GitHub met de testsleutel te lezen (zuinig met verzoeken: de token mag ~1000 per uur). */
async function everythingReadable(paths: readonly CollectionPath[] = TOUCHED): Promise<void> {
  const c = client()
  for (const path of paths) {
    const file = await c.getFile(path)
    if (file) expect(await classify(k1.masterKey, path, file.content), path).toBe('leesbaar')
  }
}

const TOUCHED: CollectionPath[] = ['trips.json.enc', 'places.json.enc', 'reminders.json.enc', 'students.json.enc', 'settings.json.enc']

describe.skipIf(!TOKEN)('echte GitHub-API (tijdelijke branch)', () => {
  beforeAll(async () => {
    k1 = await createVault('nep wachtzin voor de integratietest', wordlist)
    k2 = await createVault('nep wachtzin van een ander logboek', wordlist)
    await createBranch(t)
    // Nieuw logboek: meta.json.enc in de lege map.
    await client().putFile(META_PATH, utf8(serializeMeta(k1.meta)), null)
  }, 120_000)

  afterAll(async () => {
    await deleteBranch(t)
  }, 60_000)

  it('alle bestanden aanmaken, direct teruglezen, een schoon apparaat leest alles', async () => {
    const a = await device()
    await a.put('trips.json.enc', { id: 'trip-1', name: 'Neptrip', updatedAt: T(), deletedAt: null } as Trip)
    await a.put('places.json.enc', { id: 'plaats-1', name: 'Nephaven', lat: 18.4, lon: -64.6, updatedAt: T(), deletedAt: null } as Place)
    await a.sync()
    expect(a.getStatus()).toEqual({ kind: 'synced' })
    // Direct na het schrijven teruglezen: dezelfde sha als op het apparaat, leesbaar.
    const back = await client().getFile('trips.json.enc')
    expect(back).not.toBeNull()
    expect(await classify(k1.masterKey, 'trips.json.enc', back!.content)).toBe('leesbaar')
    // Na de eerste volledige sync staat elk bestand er, en is elk leesbaar.
    await everythingReadable(COLLECTION_PATHS)
    const clean = await device()
    await clean.sync()
    expect(clean.getStatus()).toEqual({ kind: 'synced' })
    expect(clean.list('trips.json.enc').map((r) => r.id)).toEqual(['trip-1'])
    // Geen enkel antwoord dat niet bij zijn sha hoorde.
    expect(integrityEvents().filter((e) => !e.repaired)).toEqual([])
  }, 180_000)

  it('twee apparaten schrijven tegelijk naar dezelfde bestanden: niets verloren, alles leesbaar', async () => {
    const a = await device()
    const b = await device()
    await Promise.all([a.sync(), b.sync()])
    for (let round = 0; round < 3; round++) {
      await a.put('reminders.json.enc', { id: `a-${round}`, title: 'Nep a', date: '2030-01-01', kind: 'deadline', doneAt: null, updatedAt: T(), deletedAt: null } as Reminder)
      await b.put('reminders.json.enc', { id: `b-${round}`, title: 'Nep b', date: '2030-01-01', kind: 'deadline', doneAt: null, updatedAt: T(), deletedAt: null } as Reminder)
      // Zoals vanzelf na een opslag: alleen het gewijzigde bestand, tegelijk vanaf twee apparaten.
      await Promise.all([a.sync({ changedOnly: true }), b.sync({ changedOnly: true })])
    }
    // Wie een conflict had, synct nog een keer; daarna halen beide alles op.
    await a.sync({ changedOnly: true })
    await b.sync()
    await a.sync()
    expect(a.getStatus()).toEqual({ kind: 'synced' })
    expect(b.getStatus()).toEqual({ kind: 'synced' })
    const ids = a.list('reminders.json.enc').map((r) => r.id).sort()
    expect(ids).toEqual(['a-0', 'a-1', 'a-2', 'b-0', 'b-1', 'b-2'])
    expect(b.list('reminders.json.enc').map((r) => r.id).sort()).toEqual(ids)
    await everythingReadable()
  }, 300_000)

  it('herladen (dezelfde opslag opnieuw openen) en meteen synchroniseren: geen onleesbaar bestand', async () => {
    const a = await device()
    await a.sync()
    a.lock()
    const again = await device()
    await again.sync()
    expect(again.getStatus()).toEqual({ kind: 'synced' })
    await everythingReadable()
  }, 180_000)

  it('een onleesbare versie van een ander logboek: het bewijs noemt de andere sleutel, Alles herstellen maakt het leesbaar', async () => {
    const a = await device()
    await a.sync()
    const path: CollectionPath = 'students.json.enc'
    const existing = await client().getFile(path)
    await client().putFile(path, await encryptRecords(k2.masterKey, path, []), existing?.sha ?? null)
    await a.sync()
    expect(a.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable', paths: [path] })
    const evidence = await a.gatherEvidence([path])
    expect(evidence[0]?.current?.verdict).toBe('sleutel')
    expect(evidence[0]?.commits.length).toBeGreaterThan(0)
    const results = await a.repairAll()
    expect(results).toEqual([{ path, ok: true }])
    expect(a.getStatus()).toEqual({ kind: 'synced' })
    await everythingReadable()
  }, 240_000)

  it('meta.json.enc blijft die van dit logboek', async () => {
    const meta = await client().getFile(META_PATH)
    expect(new TextDecoder().decode(meta!.content)).toBe(serializeMeta(k1.meta))
    // De nepdata in de branch is versleuteld: geen leesbare tekst.
    const trips = await client().getFile('trips.json.enc')
    expect(toBase64(trips!.content)).not.toContain(toBase64(utf8('Neptrip')))
  }, 60_000)
})
