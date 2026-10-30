import { COLLECTION_PATHS, type CollectionPath } from '../model/types'
import type { FileEvidence, VersionEvidence } from './evidence'
import type { IntegrityEvent } from './integrity'

// Logboek van de opslag op dit apparaat, voor Meer → Opslag: per bestand de laatste geslaagde sync en de uitkomst van
// de laatste controle. Alleen paden, aantallen, tijden en de soort uitkomst; nooit inhoud (regel 9). In localStorage,
// niet gesynct.

/** gelijk: GitHub en dit apparaat hebben dezelfde records; verschil: niet; onleesbaar: op GitHub niet te lezen;
 *  ontbreekt: niet op GitHub terwijl dit apparaat records heeft; leeg: nergens records; wacht: GitHub geeft nog een
 *  versie die dit apparaat al verving (loopt achter, geen probleem). */
export type FileState = 'gelijk' | 'verschil' | 'onleesbaar' | 'ontbreekt' | 'leeg' | 'wacht'

export interface FileCheck {
  path: CollectionPath
  /** Records op dit apparaat (niet verwijderd). */
  local: number
  /** Records op GitHub (niet verwijderd); null als het bestand er niet is of niet te lezen is. */
  remote: number | null
  state: FileState
  /** Aantal records dat verschilt (alleen bij 'verschil'). */
  differences: number
  /** Soort defect bij 'onleesbaar' (DecryptError/sleutel, InvalidDataError, …). */
  reason?: string
  /** Wie het bestand op GitHub het laatst schreef, uit het commitbericht: app-versie en apparaat-id (null bij oudere berichten). */
  writer?: { version: string | null; device: string | null }
}

export interface StorageCheck {
  /** ISO-tijd van de controle. */
  at: string
  /** Hoort meta.json.enc op GitHub bij de sleutel van dit apparaat? */
  metaOk: boolean
  files: FileCheck[]
  /** De build die controleerde (versie+commit); na een update volgt vanzelf een nieuwe controle. */
  build?: string
}

export interface StorageLog {
  /** Per bestand de laatste geslaagde sync (ISO-tijd). */
  synced: Partial<Record<CollectionPath, string>>
  check: StorageCheck | null
  /** Bewijs per onleesbaar bestand (src/storage/evidence.ts): sha's, tijden, versies, apparaat-id's, groottes, geen inhoud. */
  evidence?: FileEvidence[]
  /** Antwoorden van GitHub die niet bij hun sha hoorden (src/storage/integrity.ts), de laatste twintig. */
  integrity?: IntegrityEvent[]
}

export function checkHasProblem(check: StorageCheck): boolean {
  return !check.metaOk || check.files.some((f) => f.state === 'verschil' || f.state === 'onleesbaar' || f.state === 'ontbreekt')
}

const STATES: readonly FileState[] = ['gelijk', 'verschil', 'onleesbaar', 'ontbreekt', 'leeg', 'wacht']

function key(dbName: string): string {
  return `logboek-opslag:${dbName}`
}

export function readStorageLog(dbName: string): StorageLog {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(key(dbName)) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { synced: {}, check: null }
    const r = raw as Record<string, unknown>
    const synced: StorageLog['synced'] = {}
    if (typeof r.synced === 'object' && r.synced !== null) {
      for (const path of COLLECTION_PATHS) {
        const at = (r.synced as Record<string, unknown>)[path]
        if (typeof at === 'string') synced[path] = at
      }
    }
    const evidence = Array.isArray(r.evidence) ? r.evidence.map(parseEvidence).filter((e): e is FileEvidence => e !== null) : []
    const integrity = Array.isArray(r.integrity) ? r.integrity.map(parseIntegrity).filter((e): e is IntegrityEvent => e !== null) : []
    return { synced, check: parseCheck(r.check), ...(evidence.length > 0 ? { evidence } : {}), ...(integrity.length > 0 ? { integrity } : {}) }
  } catch {
    return { synced: {}, check: null }
  }
}

const short = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

function parseVersion(value: unknown): VersionEvidence | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const verdict = short(v.verdict, 60)
  if (verdict === null) return null
  return {
    commit: short(v.commit, 12) ?? '',
    at: short(v.at, 40),
    version: short(v.version, 80),
    device: short(v.device, 16),
    blob: short(v.blob, 40),
    size: count(v.size),
    firstByte: count(v.firstByte),
    verdict: verdict as VersionEvidence['verdict'],
  }
}

function parseEvidence(value: unknown): FileEvidence | null {
  if (typeof value !== 'object' || value === null) return null
  const e = value as Record<string, unknown>
  const path = COLLECTION_PATHS.find((p) => p === e.path)
  if (!path || typeof e.at !== 'string') return null
  const commits = Array.isArray(e.commits) ? e.commits.map(parseVersion).filter((c): c is VersionEvidence => c !== null).slice(0, 5) : []
  return { path, at: e.at, current: parseVersion(e.current), commits }
}

function parseIntegrity(value: unknown): IntegrityEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const e = value as Record<string, unknown>
  if (typeof e.at !== 'string' || typeof e.path !== 'string' || (e.phase !== 'lezen' && e.phase !== 'schrijven')) return null
  return { at: e.at, path: e.path.slice(0, 80), phase: e.phase, repaired: e.repaired === true }
}

function parseCheck(value: unknown): StorageCheck | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  if (typeof c.at !== 'string' || !Array.isArray(c.files)) return null
  const files: FileCheck[] = []
  for (const f of c.files as unknown[]) {
    if (typeof f !== 'object' || f === null) continue
    const x = f as Record<string, unknown>
    const path = COLLECTION_PATHS.find((p) => p === x.path)
    const state = STATES.find((s) => s === x.state)
    if (!path || !state || typeof x.local !== 'number') continue
    files.push({
      path,
      local: x.local,
      remote: typeof x.remote === 'number' ? x.remote : null,
      state,
      differences: typeof x.differences === 'number' ? x.differences : 0,
      ...(typeof x.reason === 'string' ? { reason: x.reason } : {}),
      ...(parseWriter(x.writer) ?? {}),
    })
  }
  return { at: c.at, metaOk: c.metaOk !== false, files, ...(typeof c.build === 'string' ? { build: c.build } : {}) }
}

function parseWriter(value: unknown): { writer: NonNullable<FileCheck['writer']> } | null {
  if (typeof value !== 'object' || value === null) return null
  const w = value as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.length <= 80 ? v : null)
  return { writer: { version: text(w.version), device: text(w.device) } }
}

export function writeStorageLog(dbName: string, log: StorageLog): void {
  try {
    globalThis.localStorage?.setItem(key(dbName), JSON.stringify(log))
  } catch {
    // Geen localStorage: het overzicht toont dan alleen wat deze sessie weet.
  }
}

/** Het overzicht van een database vergeten (de demo-database na de demo). */
export function forgetStorageLog(dbName: string): void {
  try {
    globalThis.localStorage?.removeItem(key(dbName))
  } catch {
    // Geen localStorage: niets te vergeten.
  }
}
