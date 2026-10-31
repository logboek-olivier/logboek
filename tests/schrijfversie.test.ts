import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { decryptObject, encryptObject, toBase64, utf8 } from '../src/crypto/encrypt'
import { NewerSchemaError, NewerWriterError, WRITER_VERSION, writerVersion, writerVersionForTests } from '../src/model/schema'
import { GithubClient } from '../src/storage/github'
import { decodeRecords, encodeRecords, invalidReason, salvageRecords, syncCollection } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'

// Minimale schrijfversie per bestand: elk databestand draagt de schrijfversie van de build die het schreef, en een build
// met een lagere schrijfversie leest het als "van een nieuwere versie" (niets schrijven, "Werk de app bij"). Alle gegevens
// verzonnen.

const PATH = 'trips.json.enc'
const record = { id: 'nep-trip', name: 'Neptrip', updatedAt: '2026-10-31T08:00:00.000Z', deletedAt: null }
const file = (extra: Record<string, unknown>) => utf8(JSON.stringify({ format: 'logboek-collection', schemaVersion: 1, records: [record], ...extra }))
let key: CryptoKey

beforeAll(async () => {
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

afterEach(() => writerVersionForTests())

describe('schrijfversie', () => {
  it('elk bestand dat deze build schrijft, draagt zijn schrijfversie', () => {
    const raw = JSON.parse(new TextDecoder().decode(encodeRecords([record]))) as Record<string, unknown>
    expect(raw.minWriterVersion).toBe(WRITER_VERSION)
    expect(writerVersion()).toBe(WRITER_VERSION)
    writerVersionForTests(WRITER_VERSION + 1)
    expect((JSON.parse(new TextDecoder().decode(encodeRecords([record]))) as Record<string, unknown>).minWriterVersion).toBe(WRITER_VERSION + 1)
  })

  it('zonder veld (een oudere build), met dezelfde of een lagere schrijfversie: gewoon leesbaar', () => {
    expect(decodeRecords(PATH, file({}))).toEqual([record])
    expect(decodeRecords(PATH, file({ minWriterVersion: 0 }))).toEqual([record])
    expect(decodeRecords(PATH, file({ minWriterVersion: WRITER_VERSION }))).toEqual([record])
  })

  it('van een build met een hogere schrijfversie: zoals een nieuwere schemaversie (niets schrijven, "Werk de app bij")', () => {
    const newer = file({ minWriterVersion: WRITER_VERSION + 1 })
    expect(() => decodeRecords(PATH, newer)).toThrow(NewerWriterError)
    expect(() => decodeRecords(PATH, newer)).toThrow(NewerSchemaError)
    // Na bijwerken (een build met die schrijfversie) weer leesbaar.
    writerVersionForTests(WRITER_VERSION + 1)
    expect(decodeRecords(PATH, newer)).toEqual([record])
  })

  it('een schrijfversie die deze build niet begrijpt, telt als nieuwer: nooit overschrijven, ook niet na een tik', async () => {
    for (const bad of ['2', -1, 1.5, null, true]) {
      expect(() => decodeRecords(PATH, file({ minWriterVersion: bad }))).toThrow(NewerWriterError)
      // Geen "ongeldig bestand" (dat zou na één tik vervangen worden).
      expect(invalidReason(file({ minWriterVersion: bad }))).toBeNull()
      expect(await salvageRecords(key, PATH, await encryptObject(key, PATH, file({ minWriterVersion: bad })))).toEqual([])
    }
  })

  it('een bestand met een lagere schrijfversie wordt bij de sync één keer opnieuw geschreven, met dezelfde records', async () => {
    const github = new FakeGithub()
    const client = new GithubClient('github_pat_SCHRIJFVERSIE_0123456789abcdefghijkl', github.fetch)
    // Geschreven door een build van vóór de schrijfversie (geen veld).
    github.write(PATH, toBase64(await encryptObject(key, PATH, file({}))))
    const first = await syncCollection(client, key, PATH, [record])
    expect(first).toMatchObject({ pushed: true, pulled: false, records: [record] })
    const stamped = JSON.parse(new TextDecoder().decode(await decryptObject(key, PATH, Uint8Array.from(Buffer.from(github.files.get(PATH)!.content, 'base64'))))) as Record<string, unknown>
    expect(stamped.minWriterVersion).toBe(WRITER_VERSION)
    // Daarna niet nog eens: niets veranderd, schrijfversie gelijk.
    expect(await syncCollection(client, key, PATH, [record])).toMatchObject({ pushed: false })
    // Een build met een hogere schrijfversie schrijft het opnieuw; de oudere schrijft er daarna niet meer overheen.
    writerVersionForTests(WRITER_VERSION + 1)
    expect(await syncCollection(client, key, PATH, [record])).toMatchObject({ pushed: true })
    writerVersionForTests(WRITER_VERSION)
    await expect(syncCollection(client, key, PATH, [{ ...record, name: 'Nepnaam ouder', updatedAt: '2026-10-31T09:00:00.000Z' }])).rejects.toThrow(NewerWriterError)
  })

  it('"Alles herstellen" neemt niets over uit een bestand van een nieuwere schrijver', async () => {
    const blob = await encryptObject(key, PATH, file({ minWriterVersion: WRITER_VERSION + 1 }))
    expect(await salvageRecords(key, PATH, blob)).toEqual([])
    expect(await salvageRecords(key, PATH, await encryptObject(key, PATH, file({ minWriterVersion: WRITER_VERSION })))).toEqual([record])
  })
})
