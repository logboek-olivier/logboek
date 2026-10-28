import { DecryptError, FORMAT_VERSION, type Bytes } from './crypto/encrypt'
import { META_PATH } from './crypto/keys'
import { NewerSchemaError } from './model/schema'
import { COLLECTION_PATHS, type CollectionPath, type SyncRecord } from './model/types'
import { ConflictError, type GithubClient } from './storage/github'
import { deleteIfUnchanged, getLocal, getObject, type Db } from './storage/idb'
import { loadOutbox, OUTBOX_NAME } from './storage/outbox'
import { decryptRecords, encryptRecords } from './storage/sync'
import { loadToken } from './storage/token'

// Logboek herstellen: gegevens die met de sleutel uit meta.json.enc (de wachtzin) niet te lezen zijn, opruimen.
// Alleen na een tik plus de juiste wachtzin (src/session.ts). Wat met die sleutel leesbaar is, blijft altijd staan:
// - op dit apparaat: alleen objecten die niet te ontsleutelen zijn (DecryptError) worden gewist;
// - op GitHub: alleen bestanden die niet te ontsleutelen zijn worden vervangen, met de oude SHA als voorwaarde, door de
//   leesbare lokale kopie of anders een lege versie. De oude versie blijft in de geschiedenis van logboek-data.
// Een bestand dat wel ontsleutelt maar ongeldig is, van een nieuwere schemaversie, of in een nieuwer objectformaat
// (versiebyte hoger dan deze app kent), wordt nooit aangeraakt: dan "Werk de app bij".

/** Wat Olivier vóór het herstellen ziet. Alleen paden, nooit inhoud (regel 9). */
export interface RepairReport {
  /** Niet te lezen op dit apparaat en niet op GitHub (of er is maar één onleesbare kopie): de inhoud gaat verloren. */
  lost: CollectionPath[]
  /** Op dit apparaat onleesbaar, op GitHub leesbaar: alleen wijzigingen die nog niet gesynct waren, vervallen. */
  localOnly: CollectionPath[]
  /** Op GitHub onleesbaar, hier leesbaar: de versie van dit apparaat komt op GitHub. */
  replaced: CollectionPath[]
  /** De token op dit apparaat is onleesbaar of ontbreekt: voor herstellen is een token nodig. */
  tokenNeeded: boolean
}

type LocalState = 'absent' | 'readable' | 'unreadable'

export interface LocalDiagnosis {
  state: Map<CollectionPath, LocalState>
  records: Map<CollectionPath, SyncRecord[]>
  /** Versleutelde inhoud van wat onleesbaar is, zodat wissen alleen gebeurt als het intussen niet veranderd is. */
  blobs: Map<CollectionPath | typeof OUTBOX_NAME, Bytes>
  outboxUnreadable: boolean
  tokenUnreadable: boolean
}

export interface Diagnosis {
  local: LocalDiagnosis
  /** Bestanden op GitHub die niet te ontsleutelen zijn, met hun SHA. */
  remoteUnreadable: Map<CollectionPath, string>
  report: RepairReport
}

/** Een objectformaat van een nieuwere app is geen andere sleutel: nooit vervangen, de app moet bijgewerkt worden. */
function assertKnownFormat(blob: Bytes): void {
  if (blob.length > 0 && blob[0]! > FORMAT_VERSION && blob[0]! < 16) throw new NewerSchemaError(blob[0]!)
}

async function readable(blob: Bytes, run: () => Promise<unknown>): Promise<boolean> {
  assertKnownFormat(blob)
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
  const blobs: LocalDiagnosis['blobs'] = new Map()
  for (const path of COLLECTION_PATHS) {
    const stored = await getObject(db, path)
    if (!stored) {
      state.set(path, 'absent')
      continue
    }
    assertKnownFormat(stored.blob)
    try {
      records.set(path, await decryptRecords(masterKey, path, stored.blob))
      state.set(path, 'readable')
    } catch (error) {
      if (!(error instanceof DecryptError)) throw error
      state.set(path, 'unreadable')
      blobs.set(path, stored.blob)
    }
  }
  let tokenUnreadable = true
  try {
    tokenUnreadable = (await loadToken(db, masterKey)) === null
  } catch (error) {
    if (!(error instanceof DecryptError)) throw error
  }
  const outbox = await getLocal(db, OUTBOX_NAME)
  const outboxUnreadable = outbox !== undefined && !(await readable(outbox, () => loadOutbox(db, masterKey)))
  if (outbox && outboxUnreadable) blobs.set(OUTBOX_NAME, outbox)
  return { state, records, blobs, outboxUnreadable, tokenUnreadable }
}

/** Verslag zonder GitHub (geen verbinding of geen token): elk onleesbaar lokaal bestand telt als verloren. */
export function localReport(local: LocalDiagnosis): RepairReport {
  return {
    lost: COLLECTION_PATHS.filter((p) => local.state.get(p) === 'unreadable'),
    localOnly: [],
    replaced: [],
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
    if (await readable(file.content, () => decryptRecords(masterKey, path, file.content))) remoteReadable.add(path)
    else remoteUnreadable.set(path, file.sha)
  }
  const lost: CollectionPath[] = []
  const localOnly: CollectionPath[] = []
  const replaced: CollectionPath[] = []
  for (const path of COLLECTION_PATHS) {
    const here = local.state.get(path)
    if (here === 'unreadable' && remoteReadable.has(path)) localOnly.push(path)
    else if (here === 'unreadable' || (remoteUnreadable.has(path) && here !== 'readable')) lost.push(path)
    else if (remoteUnreadable.has(path)) replaced.push(path)
  }
  return { local, remoteUnreadable, report: { lost, localOnly, replaced, tokenNeeded: local.tokenUnreadable } }
}

/**
 * Is alles wat bij herstellen verloren gaat of vervangen wordt, vooraf getoond, en niet ernstiger dan getoond?
 * Verloren moet als verloren getoond zijn; "alleen lokale wijzigingen" en "versie van dit apparaat naar GitHub" mogen
 * ook als verloren getoond zijn.
 */
export function covers(shown: RepairReport | null, fresh: RepairReport): boolean {
  if (fresh.lost.length + fresh.localOnly.length + fresh.replaced.length === 0) return true
  if (!shown) return false
  const lost = new Set(shown.lost)
  const milder = new Set([...shown.lost, ...shown.localOnly, ...shown.replaced])
  return fresh.lost.every((p) => lost.has(p)) && [...fresh.localOnly, ...fresh.replaced].every((p) => milder.has(p))
}

/** Een ander tabblad schreef tijdens het herstellen in de lokale opslag: niets gewist, opnieuw proberen. */
export class LocalChangedError extends Error {
  constructor() {
    super('Lokale opslag gewijzigd tijdens herstellen')
    this.name = 'LocalChangedError'
  }
}

/**
 * Voert het herstel uit volgens de diagnose. Opent het logboek niet; dat doet de sessie daarna. `vaultCheck`: het
 * check-veld van de lokale meta waaraan de sleutel gebonden is; lokaal wissen gebeurt alleen als dat nog klopt.
 */
export async function executeRepair(db: Db, masterKey: CryptoKey, client: GithubClient, diagnosis: Diagnosis, vaultCheck: string): Promise<void> {
  const { local } = diagnosis
  // GitHub eerst: mislukt dat (geen verbinding), dan is er lokaal nog niets gewist en kan Olivier het opnieuw proberen.
  for (const [path, sha] of diagnosis.remoteUnreadable) {
    const records = local.state.get(path) === 'readable' ? (local.records.get(path) ?? []) : []
    try {
      await replaceUnreadable(client, masterKey, path, sha, records)
      rememberReplaced(db.name, path, sha)
    } catch (error) {
      // Blijft een bestand op GitHub wijzigen (een ander apparaat, of GitHub toont nog een oudere versie), dan pakt de
      // app het daarna per onderdeel op; het herstelscherm blijft er niet op hangen.
      if (!(error instanceof ConflictError)) throw error
    }
  }
  const items = [...local.blobs].map(([key, blob]) => ({ store: key === OUTBOX_NAME ? ('local' as const) : ('objects' as const), key, blob }))
  if (items.length > 0 && !(await deleteIfUnchanged(db, META_PATH, vaultCheck, items))) throw new LocalChangedError()
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
      if (!file || (await readable(file.content, () => decryptRecords(masterKey, path, file.content)))) return
      current = file.sha
    }
  }
}

/** Laatste verslag, zodat "Logboek herstellen" bij het volgende openen al vóór de wachtzin toont wat er verloren gaat. */
function markerKey(dbName: string | undefined): string {
  return `logboek-herstel:${dbName ?? 'logboek'}`
}

const MARKER_VERSION = 2

export function readMarker(dbName: string | undefined): RepairReport | null {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(markerKey(dbName)) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return null
    const paths = (value: unknown) => (Array.isArray(value) ? COLLECTION_PATHS.filter((p) => value.includes(p)) : [])
    const r = raw as Record<string, unknown>
    // Verslagen van vóór versie 2 konden ook alleen over bestanden op GitHub gaan; die blokkeren de app niet meer.
    if (r.v !== MARKER_VERSION) return null
    return { lost: paths(r.lost), localOnly: paths(r.localOnly), replaced: paths(r.replaced), tokenNeeded: r.tokenNeeded === true }
  } catch {
    return null
  }
}

export function writeMarker(dbName: string | undefined, report: RepairReport): void {
  try {
    globalThis.localStorage?.setItem(markerKey(dbName), JSON.stringify({ v: MARKER_VERSION, ...report }))
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

/**
 * Herstelpogingen per bestand (alleen paden en tellers, regel 9). Na MAX_REPAIRS herstelpogingen die niet blijven staan
 * stopt de app met opnieuw proberen en biedt hij één knop: het bestand op GitHub leegmaken en opnieuw beginnen.
 * Zo raakt herstel nooit in een lus.
 */
export const MAX_REPAIRS = 2

function attemptsKey(dbName: string): string {
  return `logboek-herstelpogingen:${dbName}`
}

function readJson(key: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? '{}')
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    if (Object.keys(value).length === 0) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Geen localStorage: dan telt alleen deze sessie (in het geheugen van de Store).
  }
}

/** Pogingen tellen een dag; daarna begint de teller opnieuw (een nieuw probleem is dan geen lus). */
const ATTEMPTS_TTL_MS = 24 * 60 * 60 * 1000

export function repairAttempts(dbName: string, path: CollectionPath, now = Date.now()): number {
  const value = readJson(attemptsKey(dbName))[path]
  if (typeof value !== 'object' || value === null) return 0
  const { n, at } = value as { n?: unknown; at?: unknown }
  if (typeof n !== 'number' || typeof at !== 'number' || now - at >= ATTEMPTS_TTL_MS || now < at) return 0
  return n
}

export function setRepairAttempts(dbName: string, path: CollectionPath, count: number, now = Date.now()): void {
  const all = readJson(attemptsKey(dbName))
  if (count > 0) all[path] = { n: count, at: now }
  else delete all[path]
  writeJson(attemptsKey(dbName), all)
}

/**
 * SHA's van onleesbare versies die dit apparaat al verving. GitHub geeft vlak na het schrijven soms nog even de oude
 * versie terug; die is dan geen nieuw probleem en geen reden om opnieuw te herstellen.
 */
function replacedKey(dbName: string): string {
  return `logboek-vervangen:${dbName}`
}

export function rememberReplaced(dbName: string, path: CollectionPath, sha: string): void {
  const all = readJson(replacedKey(dbName))
  const list = Array.isArray(all[path]) ? (all[path] as unknown[]).filter((s): s is string => typeof s === 'string') : []
  all[path] = [...list.filter((s) => s !== sha), sha].slice(-5)
  writeJson(replacedKey(dbName), all)
}

export function wasReplaced(dbName: string, path: CollectionPath, sha: string): boolean {
  const list = readJson(replacedKey(dbName))[path]
  return Array.isArray(list) && list.includes(sha)
}
