import { decryptObject, DecryptError, encryptObject, fromBase64, toBase64, utf8, type Bytes } from '../crypto/encrypt'
import { parseMeta, unlock, type Meta, type Secret } from '../crypto/keys'
import { scrubbedCareer } from '../model/career'
import { scrubbedDocument } from '../model/documents'
import type { Undo } from '../model/edit'
import { NewerSchemaError } from '../model/schema'
import { scrubbed } from '../model/students'
import { COLLECTION_PATHS, type CareerRecord, type CollectionPath, type Collections, type Student, type SyncRecord, type VaultDocument } from '../model/types'
import type { Store } from './store'
import { decodeRecords, encodeRecords } from './sync'

// Back-up zonder laptop: één bestand met het hele logboek, dat Olivier zelf deelt (bijvoorbeeld naar Google Drive).
// Alles is versleuteld onder de hoofdsleutel; de meta (zoals meta.json.enc op GitHub: salts en de verpakte sleutel,
// geen geheimen) staat erbij, zodat het bestand alleen met de wachtzin of herstelcode van dat moment te openen is.
// Terugzetten brengt alleen terug wat nu helemaal ontbreekt, met de tijden uit de back-up: wat Olivier zelf
// verwijderde of wiste (ook studenten, regel 14) en wat intussen nieuwer is, wint bij de sync gewoon (laatste updatedAt
// wint). Daarom alleen na een geslaagde sync, zodat dit apparaat weet wat er op GitHub staat.

export const BACKUP_FORMAT = 'logboek-backup'
const BACKUP_VERSION = 1
const PAYLOAD_AAD = 'backup/inhoud'

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  meta: unknown
  payload: string
}

interface Payload {
  createdAt: string
  /** Per pad de tekst van het bestand zoals in logboek-data (format logboek-collection). */
  files: Record<string, string>
}

export interface OpenedBackup {
  createdAt: string
  files: Map<CollectionPath, SyncRecord[]>
}

/** Terugzetten kan pas als dit apparaat in deze sessie gesynct is (anders kent het niet alles wat op GitHub staat). */
export class RestoreNeedsSyncError extends Error {
  constructor() {
    super('Eerst synchroniseren')
    this.name = 'RestoreNeedsSyncError'
  }
}

/** Geen back-up van Logboek, of beschadigd. Een verkeerde wachtzin geeft WrongSecretError. */
export class InvalidBackupError extends Error {
  constructor() {
    super('Geen geldige back-up van Logboek')
    this.name = 'InvalidBackupError'
  }
}

export async function encodeBackup(meta: Meta, masterKey: CryptoKey, files: ReadonlyMap<CollectionPath, readonly SyncRecord[]>, createdAt = new Date().toISOString()): Promise<string> {
  const payload: Payload = { createdAt, files: {} }
  const decoder = new TextDecoder()
  for (const [path, records] of files) payload.files[path] = decoder.decode(encodeRecords(records))
  const sealed = await encryptObject(masterKey, PAYLOAD_AAD, utf8(JSON.stringify(payload)))
  const file: BackupFile = { format: BACKUP_FORMAT, version: BACKUP_VERSION, meta, payload: toBase64(sealed) }
  return JSON.stringify(file)
}

/** Bestandsnaam met de datum; .txt, want het deelmenu van Android accepteert geen eigen bestandstypes. */
export function backupFileName(date: string): string {
  return `logboek-back-up-${date}.txt`
}

/** Leest het buitenste deel (zonder geheimen), zodat het scherm de wachtzin kan vragen. */
export function readBackupMeta(text: string): Meta {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new InvalidBackupError()
  }
  if (typeof raw !== 'object' || raw === null || (raw as BackupFile).format !== BACKUP_FORMAT) throw new InvalidBackupError()
  const file = raw as BackupFile
  if (typeof file.version !== 'number' || file.version < 1) throw new InvalidBackupError()
  if (file.version > BACKUP_VERSION) throw new NewerSchemaError(file.version)
  if (typeof file.payload !== 'string') throw new InvalidBackupError()
  try {
    return parseMeta(JSON.stringify(file.meta))
  } catch (error) {
    if (error instanceof NewerSchemaError) throw error
    throw new InvalidBackupError()
  }
}

/** Opent een back-up met de wachtzin of herstelcode van toen. */
export async function openBackup(text: string, secret: Secret): Promise<OpenedBackup> {
  const meta = readBackupMeta(text)
  const masterKey = await unlock(meta, secret)
  const file = JSON.parse(text) as BackupFile
  let sealed: Bytes
  try {
    sealed = fromBase64(file.payload)
  } catch {
    throw new InvalidBackupError()
  }
  let payload: Payload
  try {
    payload = JSON.parse(new TextDecoder().decode(await decryptObject(masterKey, PAYLOAD_AAD, sealed))) as Payload
  } catch (error) {
    if (error instanceof DecryptError || error instanceof SyntaxError) throw new InvalidBackupError()
    throw error
  }
  if (typeof payload?.createdAt !== 'string' || typeof payload.files !== 'object' || payload.files === null) throw new InvalidBackupError()
  const files = new Map<CollectionPath, SyncRecord[]>()
  for (const path of COLLECTION_PATHS) {
    const text = payload.files[path]
    if (typeof text !== 'string') continue
    // Zelfde controle als voor een bestand van GitHub: een nieuwere schemaversie geeft "Werk de app bij".
    files.set(path, decodeRecords(path, utf8(text)))
  }
  return { createdAt: payload.createdAt, files }
}

export interface RestoreItem {
  path: CollectionPath
  /** Records in de back-up (niet verwijderd). */
  inBackup: number
  /** Records die nu helemaal ontbreken en terugkomen. */
  back: SyncRecord[]
}

/** Voorbeeld vooraf: per bestand wat er terugkomt. Alleen records waarvan nu niets meer bestaat (ook geen verwijdering). */
export function restorePlan(store: Store, backup: OpenedBackup): RestoreItem[] {
  return COLLECTION_PATHS.flatMap((path) => {
    const records = backup.files.get(path)
    if (!records) return []
    const now = new Set(store.get(path).map((r) => r.id))
    const active = records.filter((r) => r.deletedAt === null)
    return [{ path, inBackup: active.length, back: active.filter((r) => !now.has(r.id)) }]
  })
}

/**
 * Zet terug volgens het voorbeeld, opnieuw gecontroleerd tegen wat er nu is (er kan intussen gesynct zijn), met de tijden
 * uit de back-up. Geeft een functie die het ongedaan maakt.
 */
export async function applyRestore(store: Store, plan: readonly RestoreItem[]): Promise<Undo> {
  if (!store.hasSynced()) throw new RestoreNeedsSyncError()
  const done: RestoreItem[] = []
  for (const item of plan) {
    const now = new Set(store.get(item.path).map((r) => r.id))
    const back = item.back.filter((r) => !now.has(r.id))
    if (back.length === 0) continue
    await putRecords(store, item.path, back)
    done.push({ ...item, back })
  }
  void store.sync()
  return async () => {
    for (const item of done) {
      const gone = item.back.map((r) => {
        // Altijd later dan de tijd uit de back-up (die kan van een apparaat met een voorlopende klok komen).
        const later = new Date(Math.max(Date.now(), Date.parse(r.updatedAt) + 1)).toISOString()
        if (item.path === 'students.json.enc') return scrubbed(r as Student, later)
        if (item.path === 'documents/index.json.enc') return scrubbedDocument(r as VaultDocument, later)
        if (item.path === 'career.json.enc') return scrubbedCareer(r as CareerRecord, later)
        return { ...r, updatedAt: later, deletedAt: later }
      })
      await putRecords(store, item.path, gone)
    }
    void store.sync()
  }
}

function putRecords(store: Store, path: CollectionPath, records: SyncRecord[]): Promise<void> {
  // De records komen uit een gecontroleerd logboekbestand (decodeRecords); hun vorm is die van het pad.
  return store.putMany(path, records as Collections[typeof path][])
}
