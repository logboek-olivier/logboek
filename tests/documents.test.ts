import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decryptObject, DecryptError, encryptObject, fromBase64, toBase64, utf8, type Bytes } from '../src/crypto/encrypt'
import { META_PATH, serializeMeta } from '../src/crypto/keys'
import { documentDueItems, scaledSize } from '../src/model/documents'
import type { VaultDocument } from '../src/model/types'
import { documentPath, DocumentTooLargeError, DocumentUnavailableError, fileIdOf, isFileId, MAX_DOCUMENT_BYTES } from '../src/storage/documents'
import { GithubClient } from '../src/storage/github'
import { getObject, openLogboekDb, putObject } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { createVault, parseWordlistForTests } from './helpers/vault'
import { put } from './helpers/schrijf'
import { documentVerwijderen } from '../src/domain/kluis'

// Kluis: documentbestanden versleuteld op het apparaat en op GitHub, met een willekeurige naam; alleen te lezen met de
// hoofdsleutel en het eigen pad. Alle bestanden zijn verzonnen bytes.

const TOKEN = 'github_pat_KLUIS_0123456789abcdefghijklmnopqrstuvwxyz'
const wordlist = parseWordlistForTests()
let k1: Awaited<ReturnType<typeof createVault>>
let k2: Awaited<ReturnType<typeof createVault>>
let github: FakeGithub
let counter = 0

beforeAll(async () => {
  k1 = await createVault('nep wachtzin van de kluis', wordlist)
  k2 = await createVault('nep wachtzin van een ander logboek', wordlist)
}, 30_000)

beforeEach(() => {
  github = new FakeGithub()
  github.write(META_PATH, toBase64(utf8(serializeMeta(k1.meta))))
})

/** Een apparaat met het logboek onder K1 (zoals na koppelen): lokale meta, Store gebonden aan het check-veld. */
async function device(vault = k1): Promise<Store> {
  const db = await openLogboekDb(`logboek-kluis-${++counter}`)
  await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(vault.meta)), sha: github.files.get(META_PATH)!.sha })
  return Store.open(db, vault.masterKey, new GithubClient(TOKEN, github.fetch), vault.meta.check ?? null)
}

const FILE_A = '3b241101-e2bb-4255-8caf-4136c566a962'
const FILE_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const bytes = (text: string): Bytes => utf8(`%PDF-nepdocument ${text}`)
const doc = (fileId: string, extra: Partial<VaultDocument> = {}): VaultDocument => ({
  id: `doc-${fileId.slice(0, 4)}`,
  title: 'Nepcertificaat',
  category: 'certificaten',
  mime: 'application/pdf',
  size: 20,
  offline: false,
  fileId,
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  ...extra,
})
const blobPuts = () => github.requests.filter((r) => r.method === 'PUT' && r.url.includes('/contents/documents/') && r.url.endsWith('.bin'))
const blobDeletes = () => github.requests.filter((r) => r.method === 'DELETE' && r.url.endsWith('.bin'))

/** Een document zoals addDocument het maakt: eerst het bestand, dan de index. */
async function add(store: Store, fileId: string, content: Bytes, extra: Partial<VaultDocument> = {}): Promise<void> {
  await store.putDocumentFile(fileId, content)
  await put(store, 'documents/index.json.enc', doc(fileId, extra))
}

describe('paden', () => {
  it('alleen een UUID wordt een pad; nooit een naam, een map of ../', () => {
    expect(documentPath(FILE_A)).toBe(`documents/${FILE_A}.bin`)
    expect(fileIdOf(`documents/${FILE_A}.bin`)).toBe(FILE_A)
    expect(fileIdOf('documents/index.json.enc')).toBeNull()
    for (const bad of ['', 'paspoort', '../meta.json', `${FILE_A}/x`, FILE_A.toUpperCase()]) {
      expect(isFileId(bad)).toBe(false)
      expect(() => documentPath(bad)).toThrow()
    }
  })
})

describe('documentbestanden', () => {
  it('versleuteld op het apparaat, bij de sync als nieuw bestand naar GitHub; alleen met de sleutel en het eigen pad te lezen', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'))
    expect(await phone.documentFileState(FILE_A)).toBe('pending')
    expect(await phone.pendingDocumentFiles()).toEqual([FILE_A])
    await phone.sync()
    expect(blobPuts()).toHaveLength(1)
    const remote = github.files.get(documentPath(FILE_A))!
    const sealed = fromBase64(remote.content)
    // Niets leesbaars op GitHub: geen tekst van het document, en de naam is de UUID.
    expect(new TextDecoder().decode(sealed)).not.toContain('nepdocument')
    expect(await decryptObject(k1.masterKey, documentPath(FILE_A), sealed)).toEqual(bytes('A'))
    // Onder een ander pad of met een andere sleutel: niet te ontsleutelen (AAD = pad).
    await expect(decryptObject(k1.masterKey, documentPath(FILE_B), sealed)).rejects.toBeInstanceOf(DecryptError)
    await expect(decryptObject(k2.masterKey, documentPath(FILE_A), sealed)).rejects.toBeInstanceOf(DecryptError)
    expect(await phone.documentFileState(FILE_A)).toBe('local')
    expect(await phone.pendingDocumentFiles()).toEqual([])
    // Een volgende sync uploadt niets opnieuw.
    await phone.sync()
    expect(blobPuts()).toHaveLength(1)
  })

  it('een tweede apparaat opent het bestand van GitHub; offline bewaart een versleutelde kopie, uitzetten haalt hem weg', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'))
    await phone.sync()
    const laptop = await device()
    expect(await laptop.documentFileState(FILE_A)).toBe('none')
    expect(await laptop.documentFile(FILE_A)).toEqual(bytes('A'))
    expect(await laptop.documentFileState(FILE_A)).toBe('none')
    await laptop.setDocumentOffline(FILE_A, true)
    expect(await laptop.documentFileState(FILE_A)).toBe('local')
    // Zonder verbinding: uit de kopie.
    github.offline = true
    expect(await laptop.documentFile(FILE_A)).toEqual(bytes('A'))
    github.offline = false
    await laptop.setDocumentOffline(FILE_A, false)
    expect(await laptop.documentFileState(FILE_A)).toBe('none')
    // Een bestand dat nergens staat (het andere apparaat synchroniseerde nog niet).
    await expect(laptop.documentFile(FILE_B)).rejects.toBeInstanceOf(DocumentUnavailableError)
  })

  it('niet offline: na de upload blijft de kopie tot de volgende ronde, daarna alleen nog op GitHub', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'), { offline: false })
    await phone.sync()
    // Net geüpload: de kopie blijft (GitHub geeft vlak na schrijven soms nog niets terug).
    expect(await phone.documentFileState(FILE_A)).toBe('local')
    await phone.sync()
    expect(await phone.documentFileState(FILE_A)).toBe('none')
    expect(await phone.documentFile(FILE_A)).toEqual(bytes('A'))
  })

  it('nooit naar een logboek van een andere sleutel: dan geen enkel bestand naar GitHub', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'))
    github.write(META_PATH, toBase64(utf8(serializeMeta(k2.meta))))
    await phone.sync()
    expect(blobPuts()).toHaveLength(0)
    expect(github.files.has(documentPath(FILE_A))).toBe(false)
  })

  it('zonder verbinding wacht het bestand; de volgende sync uploadt het, ook zonder andere wijzigingen', async () => {
    const phone = await device()
    github.offline = true
    await add(phone, FILE_A, bytes('A'))
    await phone.sync()
    expect(github.files.has(documentPath(FILE_A))).toBe(false)
    expect(phone.pendingCount()).toBe(2)
    github.offline = false
    await phone.sync({ changedOnly: true })
    expect(github.files.has(documentPath(FILE_A))).toBe(true)
    expect(phone.getStatus().kind).toBe('synced')
  })

  it('een afgebroken upload (het bestand staat er al): de versie op GitHub telt als die met deze sleutel te lezen is', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'))
    github.write(documentPath(FILE_A), toBase64(await encryptObject(k1.masterKey, documentPath(FILE_A), bytes('A'))))
    await phone.sync()
    expect(await phone.documentFileState(FILE_A)).toBe('local')
    expect(phone.getStatus().kind).toBe('synced')
  })

  it('een onleesbaar bestand op GitHub blokkeert alleen dat document', async () => {
    const phone = await device()
    github.write(documentPath(FILE_B), toBase64(utf8('kapot')))
    await expect(phone.documentFile(FILE_B)).rejects.toBeInstanceOf(DecryptError)
    await add(phone, FILE_A, bytes('A'))
    await phone.sync()
    expect(github.files.has(documentPath(FILE_A))).toBe(true)
  })

  it('verwijderen: de kopie blijft een dag (ongedaan maken), daarna weg; groter dan 20 MB en na vergrendelen: geweigerd', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'), { offline: true })
    await phone.sync()
    const undo = await documentVerwijderen(phone, phone.list('documents/index.json.enc')[0]!)
    await phone.sync()
    expect(await phone.documentFileState(FILE_A)).toBe('local')
    await undo()
    expect(phone.list('documents/index.json.enc')).toHaveLength(1)
    // Twee dagen geleden verwijderd: de volgende ronde haalt de kopie weg.
    const old = new Date(Date.now() - 2 * 24 * 3_600_000).toISOString()
    await put(phone, 'documents/index.json.enc', { ...phone.list('documents/index.json.enc')[0]!, updatedAt: new Date().toISOString(), deletedAt: old })
    await phone.sync()
    await phone.sync()
    expect(await phone.documentFileState(FILE_A)).toBe('none')
    // En van GitHub (met de SHA als voorwaarde), één keer: een volgende volledige ronde kijkt niet opnieuw.
    expect(github.files.has(documentPath(FILE_A))).toBe(false)
    expect(blobDeletes()).toHaveLength(1)
    await phone.sync()
    expect(blobDeletes()).toHaveLength(1)
    await expect(phone.putDocumentFile(FILE_B, new Uint8Array(MAX_DOCUMENT_BYTES + 1))).rejects.toBeInstanceOf(DocumentTooLargeError)
    phone.lock()
    await expect(phone.documentFile(FILE_A)).rejects.toThrow()
    await expect(phone.putDocumentFile(FILE_B, bytes('B'))).rejects.toThrow()
  })
})

describe('na de beveiligingsreview', () => {
  it('verwijderen laat geen titel, categorie, datums of notitie in de index; ongedaan maken zet ze terug', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'), { title: 'Nep paspoort', notes: 'nepnummer 123', expiresAt: '2030-01-01', category: 'identiteit' })
    await phone.sync()
    const undo = await documentVerwijderen(phone, phone.list('documents/index.json.enc')[0]!)
    const tombstone = phone.get('documents/index.json.enc')[0]!
    expect(tombstone).toEqual({ id: tombstone.id, title: '', category: 'overig', mime: '', size: 0, offline: false, fileId: FILE_A, updatedAt: tombstone.updatedAt, deletedAt: tombstone.deletedAt })
    await phone.sync()
    const laptop = await device()
    await laptop.sync()
    expect(JSON.stringify(laptop.get('documents/index.json.enc'))).not.toContain('Nep paspoort')
    await undo()
    expect(phone.list('documents/index.json.enc')[0]).toMatchObject({ title: 'Nep paspoort', notes: 'nepnummer 123', category: 'identiteit', deletedAt: null })
  })

  it('een losgeraakt bestand (zonder index) gaat nooit naar GitHub en is na een dag weg van het apparaat', async () => {
    const phone = await device()
    await phone.putDocumentFile(FILE_A, bytes('A'))
    expect(await phone.pendingDocumentFiles()).toEqual([])
    await phone.sync()
    expect(blobPuts()).toHaveLength(0)
    expect(await phone.documentFileState(FILE_A)).toBe('pending')
    // Twee dagen oud: de volgende geslaagde ronde ruimt het op.
    const db = (phone as unknown as { db: Parameters<typeof putObject>[0] }).db
    const object = (await getObject(db, documentPath(FILE_A)))!
    await putObject(db, { ...object, addedAt: Date.now() - 2 * 24 * 3_600_000 })
    await phone.sync()
    expect(await phone.documentFileState(FILE_A)).toBe('none')
    expect(blobPuts()).toHaveLength(0)
  })

  it('een mislukte upload houdt de databestanden niet op; vanzelf na een opslag pas na 10 minuten opnieuw, verversen altijd', async () => {
    const phone = await device()
    await add(phone, FILE_A, bytes('A'))
    github.beforePut = (p) => {
      if (p.endsWith('.bin')) throw new TypeError('Failed to fetch')
    }
    await phone.sync()
    expect(github.files.has('documents/index.json.enc')).toBe(true)
    expect(phone.getStatus()).toEqual({ kind: 'pending', count: 1 })
    github.beforePut = null
    // Vanzelf na een opslag, zonder andere wijzigingen: nog niet opnieuw (geen verzoek naar GitHub).
    const before = github.requests.length
    await phone.sync({ changedOnly: true })
    expect(github.requests.length).toBe(before)
    // Met een andere wijziging gaat die wel, het document nog niet.
    await put(phone, 'reminders.json.enc', { id: 'nep-termijn', title: 'Nep', date: '2030-01-01', kind: 'deadline', doneAt: null, updatedAt: new Date().toISOString(), deletedAt: null })
    await phone.sync({ changedOnly: true })
    expect(github.files.has('reminders.json.enc')).toBe(true)
    expect(blobPuts()).toHaveLength(1)
    // Verversen (volledige ronde) probeert het meteen.
    await phone.sync()
    expect(github.files.has(documentPath(FILE_A))).toBe(true)
    expect(phone.getStatus()).toEqual({ kind: 'synced' })
  })
})

describe('kluis in de app', () => {
  it('vervaldatums bij de termijnen; verwijderd of zonder datum niet', () => {
    const items = documentDueItems([doc(FILE_A, { expiresAt: '2027-03-01' }), doc(FILE_B, { id: 'weg', expiresAt: '2027-01-01', deletedAt: '2026-10-01T00:00:00.000Z' }), doc(FILE_B, { id: 'zonder' })])
    expect(items).toEqual([{ id: `doc-${FILE_A.slice(0, 4)}`, title: 'Nepcertificaat', date: '2027-03-01', kind: 'vervalt', source: 'document' }])
  })

  it('foto verkleinen tot 1600 px aan de lange kant, nooit vergroten', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})
