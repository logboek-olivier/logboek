import { decryptObject, encryptObject, FORMAT_VERSION, utf8, type Bytes } from '../crypto/encrypt'
import { NewerSchemaError, NewerWriterError, SCHEMA_VERSION, writerVersion } from '../model/schema'
import type { SyncRecord } from '../model/types'
import { ConflictError, type GithubClient, type RemoteFile } from './github'

// Sync per bestand: (1) SHA en inhoud ophalen, (2) ontsleutelen, (3) samenvoegen per id, laatste updatedAt wint,
// (4) versleutelen, (5) schrijven met de oude SHA als voorwaarde. Conflict? Opnieuw vanaf (1), maximaal 3 keer.

export const MAX_ATTEMPTS = 3
const decoder = new TextDecoder()

export class SyncFailedError extends Error {
  constructor() {
    super('Synchroniseren mislukt na 3 pogingen')
    this.name = 'SyncFailedError'
  }
}

export class InvalidDataError extends Error {
  constructor(path: string) {
    super(`Inhoud van ${path} is ongeldig`)
    this.name = 'InvalidDataError'
  }
}

/**
 * Wat dit apparaat zelf wil uploaden, is niet terug te lezen (een ongeldig record in het geheugen). Een fout op het
 * apparaat, niet op GitHub: het bestand op GitHub blijft staan en telt niet als onleesbaar.
 */
export class LocalInvalidError extends Error {
  constructor(path: string) {
    super(`Wat dit apparaat voor ${path} wil schrijven, is ongeldig`)
    this.name = 'LocalInvalidError'
  }
}

interface CollectionFile {
  format: 'logboek-collection'
  schemaVersion: number
  /** De schrijfversie van de build die dit bestand schreef: een build met een lagere schrijft er niet overheen. */
  minWriterVersion: number
  records: SyncRecord[]
}

export function encodeRecords(records: readonly SyncRecord[]): Bytes {
  const file: CollectionFile = { format: 'logboek-collection', schemaVersion: SCHEMA_VERSION, minWriterVersion: writerVersion(), records: [...records] }
  return utf8(JSON.stringify(file))
}

/**
 * De minimale schrijfversie van een bestand (0 zonder het veld: geschreven door een build van vóór de schrijfversie), of
 * NaN als het veld er wel staat maar geen geheel getal van 0 of hoger is.
 */
function minWriterOf(raw: Record<string, unknown>): number {
  const value = raw.minWriterVersion
  if (value === undefined) return 0
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : NaN
}

/**
 * Leest een bestand; een hogere schemaVersion dan de app kent geeft NewerSchemaError, een hogere minimale schrijfversie
 * dan die van deze build NewerWriterError (in beide gevallen niets schrijven en "Werk de app bij").
 */
export function decodeRecords<T extends SyncRecord>(path: string, plain: Bytes): T[] {
  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(plain))
  } catch {
    throw new InvalidDataError(path)
  }
  if (!isRecord(raw) || raw.format !== 'logboek-collection' || !Array.isArray(raw.records)) {
    throw new InvalidDataError(path)
  }
  // Bestanden van vóór het veld schemaVersion droegen `version: 1`.
  const found = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : raw.version === 1 ? 1 : NaN
  if (!Number.isInteger(found) || found < 1) throw new InvalidDataError(path)
  if (found > SCHEMA_VERSION) throw new NewerSchemaError(found)
  const minWriter = minWriterOf(raw)
  if (Number.isNaN(minWriter)) throw new InvalidDataError(path)
  if (minWriter > writerVersion()) throw new NewerWriterError(minWriter)
  // Een record zonder deletedAt (JSON laat undefined weg) is gewoon niet verwijderd: aanvullen in plaats van het hele
  // bestand af te keuren. Zonder id of updatedAt is een record niet samen te voegen: dan is het bestand ongeldig.
  const records = raw.records.map((r: unknown) => (isRecord(r) && r.deletedAt === undefined ? { ...r, deletedAt: null } : r))
  for (const r of records) {
    if (!isSyncRecord(r)) throw new InvalidDataError(path)
  }
  return records as T[]
}

/**
 * Waarom een ontsleuteld bestand geen geldig logboekbestand is (voor het bewijs; nooit inhoud): geen JSON, geen
 * logboekbestand, een onbekende versie, of een record zonder id of updatedAt.
 */
export function invalidReason(plain: Bytes): 'json' | 'soort' | 'versie' | 'record' | null {
  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(plain))
  } catch {
    return 'json'
  }
  if (!isRecord(raw) || raw.format !== 'logboek-collection' || !Array.isArray(raw.records)) return 'soort'
  const found = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : raw.version === 1 ? 1 : NaN
  if (!Number.isInteger(found) || found < 1 || Number.isNaN(minWriterOf(raw))) return 'versie'
  const records = raw.records.map((r: unknown) => (isRecord(r) && r.deletedAt === undefined ? { ...r, deletedAt: null } : r))
  return records.every(isSyncRecord) ? null : 'record'
}

export async function encryptRecords(masterKey: CryptoKey, path: string, records: readonly SyncRecord[]): Promise<Bytes> {
  return encryptObject(masterKey, path, encodeRecords(records))
}

/**
 * Versleutelen voor GitHub, op één plek: met de sleutel en het pad (AAD) van dit bestand, en vóór het uploaden met
 * dezelfde sleutel en hetzelfde pad weer ontsleuteld en gecontroleerd. Zo gaat er nooit een bestand naar GitHub dat
 * deze sleutel zelf niet kan lezen.
 */
export async function sealForUpload(masterKey: CryptoKey, path: string, records: readonly SyncRecord[]): Promise<Bytes> {
  const blob = await encryptRecords(masterKey, path, records)
  let back: SyncRecord[]
  try {
    back = await decryptRecords(masterKey, path, blob)
  } catch (error) {
    if (error instanceof NewerSchemaError) throw error
    throw new LocalInvalidError(path)
  }
  if (back.length !== records.length) throw new LocalInvalidError(path)
  return blob
}

/**
 * Uit een bestand dat wel ontsleutelt maar ongeldige records heeft: de records die wel samen te voegen zijn (met id en
 * updatedAt). Zo gooit "Alles herstellen" geen goede records van een ander apparaat weg. Niet te ontsleutelen, geen
 * logboekbestand of een onbekende versie: niets.
 */
export async function salvageRecords(masterKey: CryptoKey, path: string, blob: Bytes): Promise<SyncRecord[]> {
  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(await decryptObject(masterKey, path, blob)))
  } catch {
    return []
  }
  if (!isRecord(raw) || raw.format !== 'logboek-collection' || !Array.isArray(raw.records)) return []
  const found = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : raw.version === 1 ? 1 : NaN
  if (!Number.isInteger(found) || found < 1 || found > SCHEMA_VERSION) return []
  // Van een nieuwere schrijver neemt deze build niets over (hij schrijft er ook niet overheen).
  const minWriter = minWriterOf(raw)
  if (Number.isNaN(minWriter) || minWriter > writerVersion()) return []
  return raw.records.map((r: unknown) => (isRecord(r) && r.deletedAt === undefined ? { ...r, deletedAt: null } : r)).filter(isSyncRecord)
}

/**
 * Soort defect van een bestand dat niet te ontsleutelen is, zonder inhoud (regel 9): leeg, een ander formaat (eerste
 * byte of lengte klopt niet; ook afgekapt), of een andere sleutel of ander pad (de controle van AES-GCM faalt).
 */
export function decryptFailureKind(blob: Bytes): 'leeg' | 'formaat' | 'sleutel' {
  if (blob.length === 0) return 'leeg'
  if (blob[0] !== FORMAT_VERSION || blob.length < 1 + 12 + 16) return 'formaat'
  return 'sleutel'
}

export async function decryptRecords<T extends SyncRecord>(masterKey: CryptoKey, path: string, blob: Bytes): Promise<T[]> {
  // Een objectformaat van een nieuwere app (versiebyte 2–15) is geen andere sleutel: niets schrijven en "Werk de app
  // bij". Andere eerste bytes zijn gewoon onleesbaar.
  if (blob.length > 0 && blob[0]! > FORMAT_VERSION && blob[0]! < 16) throw new NewerSchemaError(blob[0]!)
  return decodeRecords<T>(path, await decryptObject(masterKey, path, blob))
}

/** Samenvoegen per id; de laatste updatedAt wint. Bij gelijke tijd wint remote (deterministisch op elk apparaat). */
export function mergeRecords<T extends SyncRecord>(local: readonly T[], remote: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const r of local) byId.set(r.id, r)
  for (const r of remote) {
    const mine = byId.get(r.id)
    if (!mine || r.updatedAt >= mine.updatedAt) byId.set(r.id, r)
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function sameRecords(a: readonly SyncRecord[], b: readonly SyncRecord[]): boolean {
  if (a.length !== b.length) return false
  const bById = new Map(b.map((r) => [r.id, r]))
  return a.every((r) => {
    const other = bById.get(r.id)
    return other !== undefined && JSON.stringify(r) === JSON.stringify(other)
  })
}

export interface SyncResult<T extends SyncRecord> {
  records: T[]
  sha: string
  /** Of er naar GitHub geschreven is. */
  pushed: boolean
  /** Of remote iets had dat lokaal nog niet bekend was. */
  pulled: boolean
}

/**
 * `prefetched` is het al opgehaalde remote bestand (of null als het niet bestaat) voor de eerste poging,
 * zodat de Store alle bestanden kan lezen en controleren vóór hij iets schrijft.
 */
export async function syncCollection<T extends SyncRecord>(
  client: GithubClient,
  masterKey: CryptoKey,
  path: string,
  local: readonly T[],
  prefetched?: RemoteFile | null,
): Promise<SyncResult<T>> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remoteFile = attempt === 1 && prefetched !== undefined ? prefetched : await client.getFile(path)
    const remote = remoteFile ? await decryptRecords<T>(masterKey, path, remoteFile.content) : []
    const merged = mergeRecords(local, remote)
    const pulled = !sameRecords(merged, local)
    if (remoteFile && sameRecords(merged, remote)) {
      return { records: merged, sha: remoteFile.sha, pushed: false, pulled }
    }
    try {
      const sha = await client.putFile(path, await sealForUpload(masterKey, path, merged), remoteFile?.sha ?? null)
      return { records: merged, sha, pushed: true, pulled }
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error
    }
  }
  throw new SyncFailedError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSyncRecord(value: unknown): value is SyncRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.deletedAt === null || typeof value.deletedAt === 'string')
  )
}
