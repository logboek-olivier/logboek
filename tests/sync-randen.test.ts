import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { encryptObject, utf8 } from '../src/crypto/encrypt'
import type { Leg, Reminder } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { decryptRecords, salvageRecords } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'

// Fundering: randgevallen van de sync. Eén bestand herstellen gooit nooit de goede records van een ander apparaat weg;
// een opslag in een ander venster midden in een ronde verdwijnt nooit uit de outbox zonder naar GitHub te gaan; een
// opslag tijdens een ronde die op een fout eindigt (een onleesbaar ander bestand) gaat toch mee. Verzonnen data.

const TOKEN = 'github_pat_RANDEN_0123456789abcdefghijklmnopqrstuvwxyz'
const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

const rem = (id: string): Reminder => ({ id, title: `Neptermijn ${id}`, date: '2027-01-01', kind: 'deadline', doneAt: null, updatedAt: T0, deletedAt: null })
const leg = (id: string): Leg => ({
  id,
  tripId: 't',
  date: '2026-10-20',
  fromPlace: 'Nepstad',
  fromCountry: 'Nepland',
  toPlace: 'Nepdorp',
  toCountry: 'Nepland',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 10,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: new Date().toISOString(),
  deletedAt: null,
})

describe('één bestand herstellen', () => {
  it('bewaart de goede records van een bestand op GitHub dat wel ontsleutelt maar ongeldig is', async () => {
    const github = new FakeGithub()
    const client = new GithubClient(TOKEN, github.fetch)
    const path = 'reminders.json.enc'
    // Op GitHub: twee goede termijnen van een ander apparaat en één record zonder updatedAt.
    const bad = utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 1, records: [rem('a'), rem('b'), { id: 'kapot', deletedAt: null }] }))
    await client.putFile(path, await encryptObject(masterKey, path, bad), null)
    const s = await Store.open(await openLogboekDb(`logboek-randen-${++counter}`), masterKey, client)
    await s.put(path, rem('c'))
    await s.sync()
    // In de app is de meta-controle 'match'; deze opslagtest heeft geen meta.
    ;(s as unknown as { metaVerdict: string }).metaVerdict = 'match'
    expect(await s.repairOptions()).toEqual([{ path, action: 'repair' }])
    await s.repair(path)
    const after = await salvageRecords(masterKey, path, (await client.getFile(path))!.content)
    expect(after.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('twee vensters', () => {
  it('een opslag van een ander venster midden in een ronde blijft wachten tot hij echt op GitHub staat', async () => {
    const github = new FakeGithub()
    const db = await openLogboekDb(`logboek-randen-${++counter}`)
    const client = new GithubClient(TOKEN, github.fetch)
    const w1 = await Store.open(db, masterKey, client)
    const w2 = await Store.open(db, masterKey, client)
    await w1.put('legs.json.enc', leg('eerste'))
    await w1.sync()
    // Venster 2 slaat precies op tussen het lezen van de bestanden en van de outbox door venster 1 (zonder bericht).
    const inner = w1 as unknown as { absorbOutbox: () => Promise<void>; channel: BroadcastChannel | null }
    if (inner.channel) inner.channel.onmessage = null
    const original = inner.absorbOutbox.bind(w1)
    let once = true
    inner.absorbOutbox = async () => {
      if (once) {
        once = false
        await w2.put('legs.json.enc', leg('tweede'))
      }
      return original()
    }
    await w1.sync()
    const onGithub = (await decryptRecords<Leg>(masterKey, 'legs.json.enc', (await client.getFile('legs.json.enc'))!.content)).map((l) => l.id)
    const w3 = await Store.open(db, masterKey, client)
    // Staat hij nog niet op GitHub, dan telt hij als wachtend, en de volgende sync zet hem erop.
    if (!onGithub.includes('tweede')) expect(w3.pendingCount()).toBeGreaterThan(0)
    await w3.sync()
    expect((await decryptRecords<Leg>(masterKey, 'legs.json.enc', (await client.getFile('legs.json.enc'))!.content)).map((l) => l.id)).toContain('tweede')
  })
})

describe('opslag tijdens een ronde die op een fout eindigt', () => {
  it('gaat kort daarna alsnog naar GitHub', async () => {
    const github = new FakeGithub()
    const client = new GithubClient(TOKEN, github.fetch)
    // Een ander bestand is blijvend onleesbaar: elke ronde eindigt op "onleesbaar".
    await client.putFile('reminders.json.enc', new Uint8Array([1, 2, 3]), null)
    const s = await Store.open(await openLogboekDb(`logboek-randen-${++counter}`), masterKey, client)
    s.enableAutoSync()
    const trip = (id: string) => ({ id, name: `Neptrip ${id}`, updatedAt: new Date().toISOString(), deletedAt: null })
    await s.put('trips.json.enc', trip('eerste'))
    await s.put('legs.json.enc', leg('eerste'))
    await s.sync()
    expect(s.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable' })
    // Een ronde met een trip en een dag; terwijl de trip naar GitHub gaat, slaat Olivier nog een trip op, en de rest van
    // de ronde duurt langer dan de 0,8 s tot de sync na een opslag (een trage verbinding).
    let saved = false
    github.beforePut = (path) => {
      if (saved || path !== 'trips.json.enc') return
      saved = true
      void s.put('trips.json.enc', trip('tweede'))
      github.gate = new Promise<void>((r) => setTimeout(r, 1_200)).then(() => {
        github.gate = null
      })
    }
    await s.put('trips.json.enc', trip('derde'))
    await s.put('legs.json.enc', leg('derde'))
    await s.sync()
    expect(s.getStatus()).toMatchObject({ kind: 'error', code: 'unreadable' })
    await new Promise((r) => setTimeout(r, 2_500))
    await (s as unknown as { syncing: Promise<void> | null }).syncing
    const ids = (await decryptRecords(masterKey, 'trips.json.enc', (await client.getFile('trips.json.enc'))!.content)).map((r) => r.id)
    expect(ids).toContain('tweede')
  })
})
