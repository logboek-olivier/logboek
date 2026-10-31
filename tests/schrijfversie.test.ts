import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { encryptObject, utf8 } from '../src/crypto/encrypt'
import { NewerSchemaError, NewerWriterError, WRITER_VERSION, writerVersion, writerVersionForTests } from '../src/model/schema'
import { decodeRecords, encodeRecords, InvalidDataError, invalidReason, salvageRecords } from '../src/storage/sync'

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

  it('een schrijfversie die geen geheel getal van 0 of hoger is: ongeldig bestand', () => {
    for (const bad of ['2', -1, 1.5, null, true]) {
      expect(() => decodeRecords(PATH, file({ minWriterVersion: bad }))).toThrow(InvalidDataError)
      expect(invalidReason(file({ minWriterVersion: bad }))).toBe('versie')
    }
    expect(invalidReason(file({ minWriterVersion: WRITER_VERSION + 1 }))).toBeNull()
  })

  it('"Alles herstellen" neemt niets over uit een bestand van een nieuwere schrijver', async () => {
    const blob = await encryptObject(key, PATH, file({ minWriterVersion: WRITER_VERSION + 1 }))
    expect(await salvageRecords(key, PATH, blob)).toEqual([])
    expect(await salvageRecords(key, PATH, await encryptObject(key, PATH, file({ minWriterVersion: WRITER_VERSION })))).toEqual([record])
  })
})
