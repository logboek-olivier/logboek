import { decryptObject, encryptObject, utf8, type Bytes } from '../crypto/encrypt'
import { NewerSchemaError, SCHEMA_VERSION } from '../model/schema'
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

interface CollectionFile {
  format: 'logboek-collection'
  schemaVersion: number
  records: SyncRecord[]
}

export function encodeRecords(records: readonly SyncRecord[]): Bytes {
  const file: CollectionFile = { format: 'logboek-collection', schemaVersion: SCHEMA_VERSION, records: [...records] }
  return utf8(JSON.stringify(file))
}

/** Leest een bestand; een hogere schemaVersion dan de app kent geeft NewerSchemaError (dan niets schrijven). */
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
  for (const r of raw.records) {
    if (!isSyncRecord(r)) throw new InvalidDataError(path)
  }
  return raw.records as T[]
}

export async function encryptRecords(masterKey: CryptoKey, path: string, records: readonly SyncRecord[]): Promise<Bytes> {
  return encryptObject(masterKey, path, encodeRecords(records))
}

export async function decryptRecords<T extends SyncRecord>(masterKey: CryptoKey, path: string, blob: Bytes): Promise<T[]> {
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
      const sha = await client.putFile(path, await encryptRecords(masterKey, path, merged), remoteFile?.sha ?? null)
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
