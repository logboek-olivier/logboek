import { DecryptError } from './crypto/encrypt'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from './model/types'
import { ConflictError, type GithubClient } from './storage/github'
import { deleteObject, getObject, type Db } from './storage/idb'
import { deleteOutbox, loadOutbox } from './storage/outbox'
import { decryptRecords, encryptRecords } from './storage/sync'
import { loadToken } from './storage/token'

// Logboek herstellen: gegevens die met de sleutel uit meta.json.enc (de wachtzin) niet te lezen zijn, opruimen.
// Alleen na een tik plus de juiste wachtzin (src/session.ts). Wat met die sleutel leesbaar is, blijft altijd staan:
// - op dit apparaat: alleen objecten die niet te ontsleutelen zijn (DecryptError) worden gewist;
// - op GitHub: alleen bestanden die niet te ontsleutelen zijn worden vervangen, met de oude SHA als voorwaarde, door de
//   leesbare lokale kopie of anders een lege versie. De oude versie blijft in de geschiedenis van logboek-data.
// Een bestand dat wel ontsleutelt maar ongeldig is of van een nieuwere schemaversie, wordt nooit aangeraakt.

/** Wat Olivier vóór het herstellen ziet. Alleen paden, nooit inhoud (regel 9). */
export interface RepairReport {
  /** Niet te lezen op dit apparaat en niet op GitHub (of er is maar één onleesbare kopie): de inhoud gaat verloren. */
  lost: CollectionPath[]
  /** Op dit apparaat onleesbaar, op GitHub leesbaar: alleen wijzigingen die nog niet gesynct waren, vervallen. */
  localOnly: CollectionPath[]
  /** De token op dit apparaat is onleesbaar of ontbreekt: voor herstellen is een token nodig. */
  tokenNeeded: boolean
}

type LocalState = 'absent' | 'readable' | 'unreadable'

export interface LocalDiagnosis {
  state: Map<CollectionPath, LocalState>
  records: Map<CollectionPath, SyncRecord[]>
  outboxUnreadable: boolean
  tokenUnreadable: boolean
}

export interface Diagnosis {
  local: LocalDiagnosis
  /** Bestanden op GitHub die niet te ontsleutelen zijn, met hun SHA. */
  remoteUnreadable: Map<CollectionPath, string>
  report: RepairReport
}

async function readable(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return true
  } catch (error) {
    if (error instanceof DecryptError) return false
    throw error
  }
}

/** Wat er op dit apparaat met `masterKey` te lezen is. Andere fouten dan DecryptError gaan door (niets aanraken). */
export async function diagnoseLocal(db: Db, masterKey: CryptoKey): Promise<LocalDiagnosis> {
  const state = new Map<CollectionPath, LocalState>()
  const records = new Map<CollectionPath, SyncRecord[]>()
  for (const path of COLLECTION_PATHS) {
    const stored = await getObject(db, path)
    if (!stored) {
      state.set(path, 'absent')
      continue
    }
    try {
      records.set(path, await decryptRecords(masterKey, path, stored.blob))
      state.set(path, 'readable')
    } catch (error) {
      if (!(error instanceof DecryptError)) throw error
      state.set(path, 'unreadable')
    }
  }
  let tokenUnreadable = true
  try {
    tokenUnreadable = (await loadToken(db, masterKey)) === null
  } catch (error) {
    if (!(error instanceof DecryptError)) throw error
  }
  const outboxUnreadable = !(await readable(() => loadOutbox(db, masterKey)))
  return { state, records, outboxUnreadable, tokenUnreadable }
}

/** Verslag zonder GitHub (geen verbinding of geen token): elk onleesbaar lokaal bestand telt als verloren. */
export function localReport(local: LocalDiagnosis): RepairReport {
  return {
    lost: COLLECTION_PATHS.filter((p) => local.state.get(p) === 'unreadable'),
    localOnly: [],
    tokenNeeded: local.tokenUnreadable,
  }
}

/**
 * Volledige diagnose met GitHub. De aanroeper heeft al gecontroleerd dat meta.json.enc op GitHub bij `masterKey` hoort.
 * Fouten zoals geen verbinding, een ongeldig bestand of een nieuwere schemaversie gaan door: dan wordt niets aangeraakt.
 */
export async function diagnose(masterKey: CryptoKey, client: GithubClient, local: LocalDiagnosis): Promise<Diagnosis> {
  const remoteUnreadable = new Map<CollectionPath, string>()
  const remoteReadable = new Set<CollectionPath>()
  for (const path of COLLECTION_PATHS) {
    const file = await client.getFile(path)
    if (!file) continue
    if (await readable(() => decryptRecords(masterKey, path, file.content))) remoteReadable.add(path)
    else remoteUnreadable.set(path, file.sha)
  }
  const lost: CollectionPath[] = []
  const localOnly: CollectionPath[] = []
  for (const path of COLLECTION_PATHS) {
    const here = local.state.get(path)
    if (here === 'unreadable' && remoteReadable.has(path)) localOnly.push(path)
    else if (here === 'unreadable' || (remoteUnreadable.has(path) && here !== 'readable')) lost.push(path)
  }
  return { local, remoteUnreadable, report: { lost, localOnly, tokenNeeded: local.tokenUnreadable } }
}

/** Is alles wat bij herstellen verloren gaat, vooraf getoond? */
export function covers(shown: RepairReport | null, fresh: RepairReport): boolean {
  const needed = [...fresh.lost, ...fresh.localOnly]
  if (needed.length === 0) return true
  if (!shown) return false
  const known = new Set([...shown.lost, ...shown.localOnly])
  return needed.every((p) => known.has(p))
}

/** Voert het herstel uit volgens de diagnose. Opent het logboek niet; dat doet de sessie daarna. */
export async function executeRepair(db: Db, masterKey: CryptoKey, client: GithubClient, diagnosis: Diagnosis): Promise<void> {
  const { local } = diagnosis
  // GitHub eerst: mislukt dat (geen verbinding), dan is er lokaal nog niets gewist en kan Olivier het opnieuw proberen.
  for (const [path, sha] of diagnosis.remoteUnreadable) {
    const records = local.state.get(path) === 'readable' ? (local.records.get(path) ?? []) : []
    await replaceUnreadable(client, masterKey, path, sha, records)
  }
  for (const path of COLLECTION_PATHS) if (local.state.get(path) === 'unreadable') await deleteObject(db, path)
  if (local.outboxUnreadable) await deleteOutbox(db)
}

/** Vervangt een onleesbaar bestand, alleen zolang het nog onleesbaar is (SHA als voorwaarde). */
async function replaceUnreadable(client: GithubClient, masterKey: CryptoKey, path: CollectionPath, sha: string, records: SyncRecord[]): Promise<void> {
  let current = sha
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.putFile(path, await encryptRecords(masterKey, path, records), current)
      return
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt === 1) throw error
      // Intussen gewijzigd (ander apparaat): is het nu leesbaar, dan blijft het staan.
      const file = await client.getFile(path)
      if (!file || (await readable(() => decryptRecords(masterKey, path, file.content)))) return
      current = file.sha
    }
  }
}

/** Laatste verslag, zodat "Logboek herstellen" bij het volgende openen al vóór de wachtzin toont wat er verloren gaat. */
function markerKey(dbName: string | undefined): string {
  return `logboek-herstel:${dbName ?? 'logboek'}`
}

export function readMarker(dbName: string | undefined): RepairReport | null {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(markerKey(dbName)) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return null
    const paths = (value: unknown) => (Array.isArray(value) ? COLLECTION_PATHS.filter((p) => value.includes(p)) : [])
    const r = raw as Record<string, unknown>
    return { lost: paths(r.lost), localOnly: paths(r.localOnly), tokenNeeded: r.tokenNeeded === true }
  } catch {
    return null
  }
}

export function writeMarker(dbName: string | undefined, report: RepairReport): void {
  try {
    globalThis.localStorage?.setItem(markerKey(dbName), JSON.stringify(report))
  } catch {
    // Geen localStorage: dan vraagt het herstelscherm eerst de wachtzin en toont daarna wat er verloren gaat.
  }
}

export function clearMarker(dbName: string | undefined): void {
  try {
    globalThis.localStorage?.removeItem(markerKey(dbName))
  } catch {
    // Zie writeMarker.
  }
}
