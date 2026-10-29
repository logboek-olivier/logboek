import { COLLECTION_PATHS, type CollectionPath } from '../model/types'

// Logboek van de opslag op dit apparaat, voor Meer → Opslag: per bestand de laatste geslaagde sync en de uitkomst van
// de laatste controle. Alleen paden, aantallen, tijden en de soort uitkomst; nooit inhoud (regel 9). In localStorage,
// niet gesynct.

/** gelijk: GitHub en dit apparaat hebben dezelfde records; verschil: niet; onleesbaar: op GitHub niet te lezen;
 *  ontbreekt: niet op GitHub terwijl dit apparaat records heeft; leeg: nergens records. */
export type FileState = 'gelijk' | 'verschil' | 'onleesbaar' | 'ontbreekt' | 'leeg'

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
}

export interface StorageCheck {
  /** ISO-tijd van de controle. */
  at: string
  /** Hoort meta.json.enc op GitHub bij de sleutel van dit apparaat? */
  metaOk: boolean
  files: FileCheck[]
}

export interface StorageLog {
  /** Per bestand de laatste geslaagde sync (ISO-tijd). */
  synced: Partial<Record<CollectionPath, string>>
  check: StorageCheck | null
}

export function checkHasProblem(check: StorageCheck): boolean {
  return !check.metaOk || check.files.some((f) => f.state !== 'gelijk' && f.state !== 'leeg')
}

const STATES: readonly FileState[] = ['gelijk', 'verschil', 'onleesbaar', 'ontbreekt', 'leeg']

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
    return { synced, check: parseCheck(r.check) }
  } catch {
    return { synced: {}, check: null }
  }
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
    })
  }
  return { at: c.at, metaOk: c.metaOk !== false, files }
}

export function writeStorageLog(dbName: string, log: StorageLog): void {
  try {
    globalThis.localStorage?.setItem(key(dbName), JSON.stringify(log))
  } catch {
    // Geen localStorage: het overzicht toont dan alleen wat deze sessie weet.
  }
}
