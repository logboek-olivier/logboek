import { decryptObject, DecryptError, encryptObject, utf8, type Bytes } from '../crypto/encrypt'
import { clearDiagnostics, recordError, setDiagnostics } from '../errors'
import { looksLikeMeta, META_PATH, parseMeta, serializeMeta, verifyMetaCheck, type Meta } from '../crypto/keys'
import { t } from '../i18n'
import { NewerSchemaError } from '../model/schema'
import { COLLECTION_PATHS, justAfter, type CollectionPath, type Collections, type SyncRecord } from '../model/types'
import { AuthError, BUILD, ConflictError, DOCUMENT_TIMEOUT_MS, GithubError, IntegrityError, NetworkError, type GithubClient, type GithubErrorCode, type RemoteFile } from './github'
import { deleteObject, getLocal, getObject, listObjectPaths, putObject, putObjectAndLocal, putObjectIfVault, setAsideIfVault, type Db, type StoredObject } from './idb'
import { DOCUMENT_GRACE_MS, DOCUMENT_RETRY_MS, documentPath, DocumentTooLargeError, DocumentUnavailableError, DOCUMENTS_PREFIX, fileIdOf, isFileId, MAX_DOCUMENT_BYTES, rememberRemovedDocumentFile, removedDocumentFiles } from './documents'
import { clearSynced, decryptOutbox, encryptOutbox, loadOutbox, markPending, mergeOutbox, OUTBOX_NAME, pendingCount, type Outbox } from './outbox'
import { MAX_REPAIRS, rememberReplaced, repairAttempts, setRepairAttempts, wasReplaced } from '../repair'
import { decryptFailureKind, decryptRecords, encryptRecords, InvalidDataError, mergeRecords, salvageRecords, sameRecords, sealForUpload, syncCollection } from './sync'
import { encodeBackup } from './backup'
import { exclusive } from './writer'
import { evidenceLines, gatherEvidence, type FileEvidence } from './evidence'
import { onIntegrity } from './integrity'
import { newerBuildStarted } from './versions'
import { deviceId } from './device'
import { checkHasProblem, readStorageLog, writeStorageLog, type FileCheck, type StorageCheck } from './storage-log'

/**
 * Bestanden met meegeleverde inhoud in de code (cursussen, checklists). Is zo'n bestand op GitHub onleesbaar, dan zet de
 * app vanzelf de kopie van dit apparaat terug (zonder kopie: leeg, dus opnieuw de meegeleverde inhoud). Na twee keer
 * stopt dat en toont de app de knop. De onleesbare versie blijft in de geschiedenis van logboek-data.
 */
/** Sleutelvoorvoegsel in IndexedDB voor lokale bestanden die ongeldig bleken: apart bewaard, nooit weggegooid. */
export const SET_ASIDE_PREFIX = 'apart/'

const SEED_PATHS: ReadonlySet<CollectionPath> = new Set(['curricula.json.enc', 'checklists.json.enc'])

/**
 * Soorten fout waarbij een bestand op GitHub vervangen mag worden (na een tik, of vanzelf bij seedbestanden): niet te
 * ontsleutelen, of wel ontsleuteld maar geen geldig logboekbestand. Een nieuwere schemaversie nooit: "Werk de app bij".
 */
const REPLACEABLE: ReadonlySet<string> = new Set(['DecryptError', 'InvalidDataError'])

/** Wat de app per onleesbaar bestand aanbiedt: de lokale kopie opnieuw opslaan, of leegmaken en opnieuw beginnen. */
export interface RepairOption {
  path: CollectionPath
  action: 'repair' | 'reset'
}


// Ontsleutelde data in het geheugen, alleen na ontgrendelen. Elke wijziging gaat direct versleuteld naar
// IndexedDB en in de outbox; sync gebeurt bij ontgrendelen en op verzoek. Vergrendelen = alles hier wissen.

export type SyncStatus =
  | { kind: 'synced' }
  /** Demomodus: deze Store synct nooit (src/demo.ts). */
  | { kind: 'demo' }
  | { kind: 'syncing' }
  | { kind: 'pending'; count: number }
  | { kind: 'offline'; count: number }
  /**
   * token: verlopen of ingetrokken; update: nieuwere schemaversie; github: andere GitHub-fout; failed: overig;
   * unreadable: één of meer bestanden op GitHub zijn niet te ontsleutelen of te lezen (`paths`), de andere zijn gesynct;
   * otherKey: logboek-data hoort bij een andere hoofdsleutel dan dit apparaat; noMeta: meta.json.enc ontbreekt op
   * GitHub (repo leeg of opnieuw aangemaakt). In beide gevallen is er niets geschreven. keyMismatch: de sleutel in
   * het geheugen hoort niet (meer) bij meta.json.enc; de sessie stopt en schrijft niets meer.
   */
  | { kind: 'error'; code: SyncErrorCode; count: number; github?: GithubErrorCode; paths?: CollectionPath[] }

export type SyncErrorCode = 'token' | 'update' | 'github' | 'failed' | 'unreadable' | 'otherKey' | 'noMeta' | 'keyMismatch'

/** Een bestand op GitHub is niet te ontsleutelen of te lezen. De melding noemt alleen paden en de soort fout. */
export class UnreadableFileError extends Error {
  constructor(
    readonly paths: CollectionPath[],
    readonly reason: string,
  ) {
    super(`Onleesbaar op GitHub (${reason}): ${paths.join(', ')}`)
    this.name = 'UnreadableFileError'
  }
}

/** logboek-data heeft geen meta.json.enc terwijl dit apparaat een logboek heeft: dit apparaat schrijft niets. */
export class MissingMetaError extends Error {
  constructor() {
    super('meta.json.enc ontbreekt op GitHub')
    this.name = 'MissingMetaError'
  }
}

/** logboek-data hoort bij een andere hoofdsleutel (bijvoorbeeld opnieuw aangemaakt): dit apparaat schrijft niets. */
export class OtherKeyError extends Error {
  constructor() {
    super('logboek-data hoort bij een andere hoofdsleutel')
    this.name = 'OtherKeyError'
  }
}

/**
 * De hoofdsleutel in het geheugen hoort niet bij meta.json.enc. local: de meta op dit apparaat is vervangen (een
 * ander tabblad of een andere versie van de app maakte of koppelde een logboek) of hoort bij een andere sleutel;
 * remote: meta.json.enc op GitHub hoort bij een andere sleutel, ontbreekt of is niet te controleren.
 */
/**
 * Waarom meta.json.enc op GitHub niet bij de sleutel past: missing = ontbreekt (repo leeg of opnieuw aangemaakt);
 * unreadable = geen geldige meta (kapotte inhoud); other = hoort bij een andere sleutel, of is niet te controleren
 * (oude meta zonder check-veld). Alleen bij missing en unreadable kan dit apparaat zijn eigen meta terugzetten.
 */
export type RemoteMetaProblem = 'missing' | 'unreadable' | 'other'

export class KeyMismatchError extends Error {
  constructor(
    readonly where: 'local' | 'remote',
    readonly remote: RemoteMetaProblem = 'other',
  ) {
    super(`Sleutel past niet bij meta.json.enc (${where}${where === 'remote' ? `, ${remote}` : ''})`)
    this.name = 'KeyMismatchError'
  }
}

export function describeStatus(status: SyncStatus): string {
  switch (status.kind) {
    case 'synced':
      return t('sync.synced')
    case 'demo':
      return t('sync.demo')
    case 'syncing':
      return t('sync.syncing')
    case 'pending':
      return t('sync.pending', { n: status.count })
    case 'offline':
      return t('sync.offline')
    case 'error':
      if (status.code === 'token') return t('sync.tokenInvalid')
      if (status.code === 'update') return t('sync.updateApp')
      if (status.code === 'github') return t(`github.${status.github ?? 'unexpected'}`)
      if (status.code === 'unreadable') return t('sync.unreadable', { paths: (status.paths ?? []).join(', ') })
      if (status.code === 'otherKey') return t('sync.otherKey')
      if (status.code === 'noMeta') return t('sync.noMeta')
      if (status.code === 'keyMismatch') return t('key.mismatchTitle')
      return t('sync.failed')
  }
}

type Listener = () => void
/** Zo lang na de laatste opslag start de sync vanzelf. */
const AUTO_SYNC_MS = 800
/** Zo vaak controleert de app vanzelf of GitHub en dit apparaat gelijk zijn (Meer → Opslag). */
export const CHECK_EVERY_MS = 7 * 24 * 60 * 60 * 1000
/** Zo lang wacht de controle voor hij een gevonden probleem nog één keer bekijkt. */
const CHECK_RETRY_MS = 3_000
/** Zo lang wacht teruglezen na "Alles herstellen" als GitHub vlak na het schrijven nog de vervangen versie geeft. */
const READ_BACK_PAUSE_MS = 1_000

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Uitkomst van "Alles herstellen" per bestand; is het herstel meteen weer overschreven, dan wie dat deed. */
export interface RepairResult {
  path: CollectionPath
  ok: boolean
  overwrittenBy?: { device: string | null; version: string | null }
}

function isProblem(file: FileCheck): boolean {
  return file.state === 'verschil' || file.state === 'onleesbaar' || file.state === 'ontbreekt'
}
type MetaCheck = 'match' | 'mismatch' | 'missing' | 'unknown'

export class Store {
  private readonly collections = new Map<CollectionPath, SyncRecord[]>()
  private readonly listeners = new Set<Listener>()
  private outbox: Outbox = {}
  private status: SyncStatus = { kind: 'synced' }
  private syncing: Promise<void> | null = null
  /** Er kwam een wijziging of een sync-verzoek binnen terwijl een sync liep: daarna nog een ronde. */
  private syncAgain = false
  private locked = false
  /** logboek-data bevat een bestand van een nieuwere schemaversie: niets meer naar GitHub schrijven. */
  private outdated = false
  /** Lokale bestanden van een nieuwere app: nooit overschrijven; tot bijwerken is de hele Store alleen-lezen. */
  private readonly frozen = new Set<CollectionPath>()
  /** Lokale bestanden die bij openen ongeldig bleken en apart zijn bewaard (de melding staat bij dat onderdeel). */
  private readonly setAsidePaths: CollectionPath[] = []
  /** Minstens één sync is in deze sessie zonder fouten afgerond (de lokale kopie is bijgewerkt). */
  private syncedOnce = false
  /** Bestanden die op GitHub onleesbaar waren bij de laatste sync, met de soort fout. */
  private unreadable = new Map<CollectionPath, string>()
  /** De laatste meta-controle vond op GitHub een meta.json.enc die geen geldige meta is. */
  private remoteMetaUnreadable = false
  /** Uitkomst van de laatste meta-controle; herstellen mag alleen na een bevestigde 'match'. */
  private metaVerdict: MetaCheck = 'unknown'
  /** De sleutel past niet (meer) bij meta.json.enc: deze Store schrijft nooit meer iets. */
  private mismatch = false
  private readonly mismatchListeners = new Set<(error: KeyMismatchError) => void>()
  /** Andere vensters van de app (die dezelfde opslag delen) laten weten dat een bestand lokaal is opgeslagen. */
  private channel: BroadcastChannel | null = null
  /** Na elke opslag vanzelf synchroniseren (de sessie zet dit aan; tests van de opslaglaag niet). */
  private autoSync = false
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null
  /** De volgende syncronde haalt alle bestanden (anders alleen de bestanden met wijzigingen die wachten). */
  private wantFull = false
  /**
   * Volgnummers voor "Opgeslagen" en daarna "Gesynct": elke lokale opslag krijgt een nummer; een geslaagde sync dekt
   * alle opslagen van vóór zijn start.
   */
  private seq = 0
  private savedSeq = 0
  private syncedSeq = 0
  /** Outbox-regels van opslagen in dit venster die nog niet op het apparaat staan (de outbox op het apparaat is leidend). */
  private unsaved: Outbox = {}
  /** Soort defect per onleesbaar bestand (leeg, formaat, sleutel), voor de foutdetails; nooit inhoud. */
  private unreadableKinds = new Map<CollectionPath, string>()
  private checking: Promise<StorageCheck | null> | null = null
  /** De lopende controle synct eerst ("Controleer nu"); anders is het de weekcontrole na een net geslaagde sync. */
  private checkingSyncs = false

  /** Luistert naar antwoorden die niet bij hun sha hoorden (src/storage/integrity.ts). */
  private offIntegrity: (() => void) | null = null
  /** De bron van het bewijs in "Kopieer foutdetails" (src/errors.ts). */
  private readonly diagnostics = (): string[] => this.diagnosticLines()

  private constructor(
    private readonly db: Db,
    private readonly masterKey: CryptoKey,
    private readonly client: GithubClient,
    private vaultCheck: string | null,
    /** Demomodus: nooit synchroniseren of controleren, nooit iets van of naar GitHub. */
    private readonly demo: boolean = false,
  ) {}

  /** Luisteren naar andere vensters; pas als het openen gelukt is (een mislukte Store houdt niets in het geheugen). */
  private listen(): void {
    if (typeof BroadcastChannel === 'undefined') return
    this.channel = new BroadcastChannel(`logboek-opslag:${this.db.name}`)
    this.channel.onmessage = (event: MessageEvent) => {
      const path = COLLECTION_PATHS.find((p) => p === (event.data as { path?: unknown } | null)?.path)
      if (path && !this.locked) void this.absorbDisk(path).catch(recordError)
    }
    // Node (tests): het kanaal mag het proces niet openhouden.
    ;(this.channel as unknown as { unref?: () => void }).unref?.()
  }

  /**
   * Laadt de lokale versleutelde kopie uit IndexedDB. Synchroniseert nog niet.
   * `vaultCheck`: het check-veld van de meta waaraan `masterKey` bij openen gebonden is (sessie). Dan geldt de
   * sleutel-invariant: vóór elke schrijfactie naar IndexedDB moet de lokale meta nog dezelfde zijn, en vóór elke
   * schrijfactie naar GitHub moet meta.json.enc op GitHub aan deze sleutel gebonden zijn. Zonder (alleen tests van de
   * opslaglaag) gelden alleen de controles uit runSync.
   */
  static async open(db: Db, masterKey: CryptoKey, client: GithubClient, vaultCheck: string | null = null, options: { demo?: boolean } = {}): Promise<Store> {
    const store = new Store(db, masterKey, client, vaultCheck, options.demo === true)
    for (const path of COLLECTION_PATHS) {
      const stored = await getObject(db, path)
      let records: SyncRecord[] = []
      if (stored) {
        try {
          records = await decryptRecords(masterKey, path, stored.blob)
        } catch (error) {
          // Niet te ontsleutelen: een andere sleutel, dat is "Logboek herstellen" (de sessie).
          if (error instanceof DecryptError) throw error
          if (!(error instanceof NewerSchemaError) && !(error instanceof InvalidDataError)) throw error
          recordError(error)
          // Wel ontsleuteld maar ongeldig: apart bewaren (nooit weggooien) en verder alsof hier geen kopie is; de
          // versie van GitHub komt bij de sync in de plaats. Lukt apart zetten niet, dan net als een nieuwere versie.
          const setAside = error instanceof InvalidDataError && (await setAsideIfVault(db, META_PATH, vaultCheck, path, stored.blob, `${SET_ASIDE_PREFIX}${path}/${new Date().toISOString()}`))
          // Van een nieuwere app: nooit overschrijven, niets naar GitHub, "Werk de app bij". De rest werkt gewoon.
          if (setAside) store.setAsidePaths.push(path)
          else {
            store.outdated = true
            store.frozen.add(path)
          }
        }
      }
      store.collections.set(path, records)
    }
    store.outbox = await loadOutbox(db, masterKey)
    store.status = store.outdated ? store.updateStatus() : store.idleStatus()
    store.listen()
    if (!store.demo) store.watchDiagnostics()
    return store
  }

  /** Antwoorden die niet bij hun sha hoorden bewaren (alleen pad, tijd, soort) en het bewijs in de foutdetails zetten. */
  private watchDiagnostics(): void {
    this.offIntegrity = onIntegrity((event) => {
      const log = readStorageLog(this.db.name)
      writeStorageLog(this.db.name, { ...log, integrity: [...(log.integrity ?? []), event].slice(-20) })
    })
    setDiagnostics(this.diagnostics)
  }

  /** Regels voor "Kopieer foutdetails": welke bestanden nu onleesbaar zijn, integriteit en het bewijs; nooit inhoud. */
  diagnosticLines(): string[] {
    const log = readStorageLog(this.db.name)
    const lines = [`Dit apparaat: ${deviceId()}`, `Onleesbaar nu: ${this.unreadableFiles().map((f) => `${f.path} (${f.reason})`).join(', ') || 'geen'}`]
    if (newerBuildStarted()) lines.push('Een nieuwere versie is gestart: dit venster schrijft niet')
    for (const e of log.integrity ?? []) lines.push(`Integriteit ${e.at} ${e.path} ${e.phase}${e.repaired ? ' (blob-API klopte)' : ''}`)
    lines.push(...evidenceLines(log.evidence ?? [], deviceId()))
    return lines
  }

  /** De bestanden die bij de laatste sync op GitHub onleesbaar waren, met de soort defect. */
  unreadableFiles(): { path: CollectionPath; reason: string }[] {
    return [...this.unreadable.entries()].map(([path, reason]) => ({ path, reason: this.unreadableKinds.has(path) ? `${reason}/${this.unreadableKinds.get(path)}` : reason }))
  }

  /** Slaat meta.json.enc lokaal op, zodat ontgrendelen zonder verbinding kan. */
  static async storeMeta(db: Db, meta: Meta, sha: string | null): Promise<void> {
    await putObject(db, { path: META_PATH, blob: utf8(serializeMeta(meta)), sha })
  }

  static async loadMeta(db: Db): Promise<Meta | null> {
    const stored = await getObject(db, META_PATH)
    return stored ? parseMeta(new TextDecoder().decode(stored.blob)) : null
  }

  /** Wordt aangeroepen zodra deze Store merkt dat de sleutel niet bij meta.json.enc hoort (de sessie stopt dan). */
  onKeyMismatch(listener: (error: KeyMismatchError) => void): () => void {
    this.mismatchListeners.add(listener)
    return () => this.mismatchListeners.delete(listener)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Lokale bestanden die bij openen ongeldig bleken en apart bewaard zijn (niet gewist). */
  setAside(): readonly CollectionPath[] {
    return this.setAsidePaths
  }

  /** True zodra een sync in deze sessie geslaagd is; daarna zijn beslissingen op basis van alle apparaten veilig. */
  hasSynced(): boolean {
    return this.syncedOnce
  }

  getStatus(): SyncStatus {
    return this.status
  }

  get<P extends CollectionPath>(path: P): readonly Collections[P][] {
    this.assertUnlocked()
    return (this.collections.get(path) ?? []) as Collections[P][]
  }

  /** Alle niet-verwijderde records. */
  list<P extends CollectionPath>(path: P): Collections[P][] {
    return this.get(path).filter((r) => r.deletedAt === null)
  }

  put<P extends CollectionPath>(path: P, record: Collections[P]): Promise<void> {
    return this.putMany(path, [record])
  }

  /**
   * Meerdere records in één keer versleutelen en opslaan (bijvoorbeeld een import). Een wijziging is altijd nieuwer dan
   * de versie die hier al staat: heeft die een tijd in de toekomst (een ander apparaat met een klok die voorloopt, of de
   * eigen klok sprong terug), dan krijgt de wijziging een tijd net daarna. Zo gaat een bewerking of verwijdering nooit
   * stil verloren.
   */
  async putMany<P extends CollectionPath>(path: P, given: readonly Collections[P][]): Promise<void> {
    this.assertUnlocked()
    // Een lokaal bestand van een nieuwere app: tot bijwerken alleen kijken, nergens wijzigen. Vóór elke wijziging
    // weigeren (ook in andere bestanden), zodat een handeling die meerdere bestanden raakt nooit half wordt opgeslagen.
    if (this.frozen.size > 0) throw new NewerSchemaError(0)
    const here = new Map((this.collections.get(path) ?? []).map((r) => [r.id, r.updatedAt]))
    const records = given.map((r) => {
      const before = here.get(r.id)
      return before !== undefined && r.updatedAt <= before ? { ...r, updatedAt: justAfter(before) } : r
    })
    const ids = new Set(records.map((r) => r.id))
    const kept = (this.collections.get(path) ?? []).filter((r) => !ids.has(r.id))
    this.collections.set(path, [...kept, ...records])
    for (const r of records) {
      this.outbox = markPending(this.outbox, path, r.id, r.updatedAt)
      this.unsaved = markPending(this.unsaved, path, r.id, r.updatedAt)
    }
    if (this.syncing) this.syncAgain = true
    await this.persist(path)
  }

  async remove<P extends CollectionPath>(path: P, id: string): Promise<void> {
    const current = this.get(path).find((r) => r.id === id)
    if (!current || current.deletedAt !== null) return
    const now = new Date().toISOString()
    await this.put(path, { ...current, updatedAt: now, deletedAt: now })
  }

  /** Wachtende wijzigingen: de outbox plus de documentbestanden die nog niet op GitHub staan. */
  pendingCount(): number {
    return pendingCount(this.outbox) + this.pendingDocs.size
  }

  /**
   * Synchroniseert alle bestanden; `changedOnly` (vanzelf na een opslag) alleen de bestanden met wijzigingen die
   * wachten, zodat op een trage verbinding niet na elke opslag alles opnieuw binnenkomt. Loopt er al een sync, dan
   * volgt na afloop nog een ronde.
   */
  sync(options: { changedOnly?: boolean } = {}): Promise<void> {
    // Demomodus: nooit synchroniseren (harde regel), ook niet als iets het vraagt.
    if (this.demo) {
      this.setStatus({ kind: 'demo' })
      return Promise.resolve()
    }
    if (!options.changedOnly) this.wantFull = true
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing
    }
    // Direct "Synchroniseren…": de ronde zelf begint pas als geen ander venster synct (Web Locks).
    if (!this.mismatch && !this.outdated && !this.locked) this.setStatus({ kind: 'syncing' })
    this.syncing = this.runRounds().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async runRounds(): Promise<void> {
    do {
      this.syncAgain = false
      const full = this.wantFull
      this.wantFull = false
      // Eén venster tegelijk naar GitHub; een ander venster wacht en synct daarna (met wat dat venster opsloeg).
      // Een ronde gooit nooit: elke fout komt in de syncstatus, zodat die nooit op "Synchroniseren…" blijft staan.
      await exclusive(this.db.name, 'sync', () =>
        this.runSync(full).catch((error: unknown) => {
          if (this.locked || error instanceof KeyMismatchError) return
          this.reportFailure(error)
        }),
      )
    } while (this.syncAgain && !this.locked && this.status.kind !== 'offline' && this.status.kind !== 'error')
    // Eindigde de ronde op een fout (bijvoorbeeld een ander bestand dat onleesbaar is) terwijl er intussen iets werd
    // opgeslagen: dat toch kort daarna versturen, in plaats van te wachten op de volgende handeling.
    if (this.syncAgain && !this.locked && this.status.kind === 'error') this.scheduleSync()
  }

  /** Wist alle ontsleutelde data uit het geheugen. De Store is daarna onbruikbaar. */
  lock(): void {
    this.locked = true
    this.offIntegrity?.()
    this.offIntegrity = null
    clearDiagnostics(this.diagnostics)
    this.collections.clear()
    this.outbox = {}
    this.unsaved = {}
    this.listeners.clear()
    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer)
    this.autoSyncTimer = null
    this.channel?.close()
  }

  /** Na elke opslag vanzelf synchroniseren (kort daarna, zodat snel achter elkaar opslaan één sync geeft). */
  enableAutoSync(): void {
    if (this.demo) return
    this.autoSync = true
  }

  /** Volgnummer van de laatste lokale opslag en van de laatste opslag die gesynct is; saved > synced = "Opgeslagen". */
  saveState(): { saved: number; synced: number } {
    return { saved: this.savedSeq, synced: this.syncedSeq }
  }

  private scheduleSync(): void {
    if (!this.autoSync || this.locked) return
    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer)
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null
      if (!this.locked) void this.sync({ changedOnly: true })
    }, AUTO_SYNC_MS)
  }

  private async runSync(full: boolean): Promise<void> {
    const count = () => this.pendingCount()
    const covered = this.seq
    if (this.mismatch) {
      this.setStatus({ kind: 'error', code: 'keyMismatch', count: count() })
      return
    }
    if (this.outdated) {
      this.setStatus(this.updateStatus())
      return
    }
    // Eén schrijver over versies heen (src/storage/versions.ts): is er na dit venster een nieuwere versie gestart (dit
    // venster bleef bevroren op de achtergrond, of werd na een update nog niet herladen), dan schrijft het niets meer.
    if (newerBuildStarted()) {
      this.outdated = true
      this.setStatus(this.updateStatus())
      return
    }
    this.setStatus({ kind: 'syncing' })
    this.uploadedThisRound.clear()
    let failure: unknown = null
    // Hoort logboek-data bij deze hoofdsleutel? Zo niet, dan niets schrijven: anders komen er bestanden onder
    // een andere sleutel naast de echte te staan, die de andere apparaten niet kunnen lezen.
    let meta: MetaCheck
    let paths: CollectionPath[]
    let uploadDocs: boolean
    try {
      await this.assertVault()
      // Wat andere vensters van de app intussen lokaal opsloegen, gaat in deze ronde mee.
      await this.absorbAll()
      paths = full ? [...COLLECTION_PATHS] : COLLECTION_PATHS.filter((p) => Object.keys(this.outbox[p] ?? {}).length > 0)
      this.pendingDocs = new Set(await this.pendingDocumentFiles())
      if (this.locked) return
      // Documentbestanden die nog niet op GitHub staan, gaan ook zonder andere wijzigingen mee (na de meta-controle);
      // vanzelf na een opslag niet als de vorige upload kort geleden mislukte (een groot bestand op een trage lijn).
      uploadDocs = this.pendingDocs.size > 0 && (full || Date.now() >= this.documentRetryAt)
      if (paths.length === 0 && !uploadDocs) {
        // Vanzelf na een opslag, maar niets wacht meer (een ander venster synct het al): niets op het netwerk.
        this.syncedSeq = Math.max(this.syncedSeq, covered)
        this.setStatus(this.idleStatus())
        return
      }
      meta = await this.checkMeta()
      this.metaVerdict = meta
      if (this.locked) return
      // Sleutel-invariant: alleen schrijven als meta.json.enc op GitHub aantoonbaar bij deze sleutel hoort.
      if (this.vaultCheck !== null && meta !== 'match') {
        this.unreadable = new Map()
        this.tripMismatch('remote', this.remoteProblem(meta))
      }
      if (meta === 'mismatch' || meta === 'missing') {
        this.unreadable = new Map()
        this.reportFailure(meta === 'missing' ? new MissingMetaError() : new OtherKeyError())
        return
      }
    } catch (error) {
      if (this.locked || error instanceof KeyMismatchError) return
      if (error instanceof NewerSchemaError) {
        this.outdated = true
        this.setStatus(this.updateStatus())
        return
      }
      this.reportFailure(error)
      return
    }
    // Leespas: alle bestanden ophalen en controleren vóór er iets geschreven wordt. Een bestand van een
    // nieuwere schemaversie (geschreven door een nieuwere app) betekent: niets naar GitHub schrijven.
    const prefetched = new Map<CollectionPath, RemoteFile | null>()
    const unreadable = new Map<CollectionPath, string>()
    const kinds = new Map<CollectionPath, string>()
    const remoteSha = new Map<CollectionPath, string>()
    let decryptFailures = 0
    let readable = 0
    /** Een bestand overgeslagen omdat GitHub nog de vervangen versie toont: deze sync telt niet als volledig. */
    let waiting = false
    for (const path of paths) {
      if (this.locked) return
      let file: RemoteFile | null = null
      try {
        file = await this.client.getFile(path)
        if (file) {
          remoteSha.set(path, file.sha)
          try {
            await decryptRecords(this.masterKey, path, file.content)
          } catch (error) {
            // Een versie die dit apparaat al verving: GitHub toont nog even de oude. Deze ronde overslaan, niets melden.
            if ((error instanceof DecryptError || error instanceof InvalidDataError) && wasReplaced(this.db.name, path, file.sha)) {
              waiting = true
              continue
            }
            throw error
          }
          readable++
        }
        prefetched.set(path, file)
      } catch (error) {
        if (this.locked) return
        if (error instanceof NewerSchemaError) {
          this.outdated = true
          this.setStatus({ kind: 'error', code: 'update', count: count() })
          return
        }
        if (error instanceof NetworkError || error instanceof AuthError) {
          this.reportFailure(error)
          return
        }
        if (error instanceof DecryptError || error instanceof InvalidDataError) {
          // Onleesbaar bestand: dit pad wordt overgeslagen (geen PUT), de andere gaan door; het pad wordt gemeld.
          unreadable.set(path, error.name)
          if (error instanceof DecryptError) {
            decryptFailures++
            if (file) kinds.set(path, decryptFailureKind(file.content))
          }
        } else failure = error
      }
    }
    if (this.locked) return
    // Zonder bruikbare meta-controle: geen enkel bestand leesbaar en meerdere niet te ontsleutelen is vrijwel zeker
    // een andere hoofdsleutel. Dan ook geen nieuwe bestanden aanmaken.
    if (meta === 'unknown' && readable === 0 && decryptFailures >= 2) {
      this.unreadable = new Map()
      this.reportFailure(new OtherKeyError())
      return
    }
    // Alleen een deel gesynct (vanzelf na een opslag): wat eerder bij de andere bestanden onleesbaar was, blijft gemeld.
    if (!full) {
      for (const [path, reason] of this.unreadable) if (!paths.includes(path) && !unreadable.has(path)) unreadable.set(path, reason)
      for (const [path, kind] of this.unreadableKinds) if (!paths.includes(path) && !kinds.has(path)) kinds.set(path, kind)
    }
    this.unreadable = unreadable
    this.unreadableKinds = kinds
    // Seedbestanden (cursussen, checklists) vanzelf herstellen; andere bestanden alleen na een tik.
    if (this.vaultCheck !== null && meta === 'match' && !this.outdated) {
      for (const [path, reason] of [...unreadable]) {
        if (this.locked) return
        // Vanzelf alleen als het bestand echt niet te ontsleutelen is; een ongeldig bestand dat wel ontsleutelt, kan
        // nog leesbare records bevatten: dat vervangt de app alleen na een tik.
        if (reason !== 'DecryptError' || !SEED_PATHS.has(path)) continue
        if (repairAttempts(this.db.name, path) >= MAX_REPAIRS) continue
        try {
          // Niets geschreven (een nieuwere versie startte, of er staat niets meer): het blijft gemeld.
          if ((await this.replaceRemote(path, this.collections.get(path) ?? [], remoteSha.get(path) ?? null)) !== null) unreadable.delete(path)
        } catch (error) {
          if (this.locked || error instanceof KeyMismatchError) return
          if (error instanceof NetworkError || error instanceof AuthError) {
            this.reportFailure(error)
            return
          }
          // Intussen schreef een nieuwere build het bestand: deze ronde niets meer schrijven, "Werk de app bij".
          if (error instanceof NewerSchemaError) {
            this.outdated = true
            this.setStatus({ kind: 'error', code: 'update', count: count() })
            return
          }
          recordError(error)
        }
      }
    }
    // Eén onleesbaar of blijvend conflicterend bestand houdt de andere bestanden niet tegen;
    // zonder verbinding of met een ongeldige token stoppen we wel direct.
    for (const path of COLLECTION_PATHS) {
      if (this.locked) return
      if (!prefetched.has(path)) continue
      try {
        await this.syncPath(path, prefetched.get(path))
      } catch (error) {
        if (this.locked || error instanceof KeyMismatchError) return
        // Pas bij het aanmaken bleek het bestand er te staan en onleesbaar te zijn (of het net aangemaakte bestand is
        // niet terug te lezen): net als in de leespas alleen dit bestand overslaan en melden.
        if (error instanceof DecryptError || error instanceof InvalidDataError) {
          unreadable.set(path, error.name)
          if (this.unreadableKinds.has(path)) kinds.set(path, this.unreadableKinds.get(path)!)
          continue
        }
        failure = error
        if (error instanceof NewerSchemaError) {
          this.outdated = true
          break
        }
        if (error instanceof NetworkError || error instanceof AuthError) break
      }
    }
    if (this.locked) return
    // Kluis: na de databestanden, zodat een groot document trips en dagen nooit ophoudt. Alleen na een bevestigde
    // meta-controle: nooit een bestand naast een logboek van een andere sleutel. Een document dat niet lukt, wacht op een
    // volgende ronde (telt als wachtende wijziging); de ronde zelf slaagt.
    const offline = failure instanceof NetworkError || failure instanceof AuthError
    if (meta === 'match' && !this.outdated && !offline) {
      try {
        if (uploadDocs) await this.uploadDocumentFiles()
        if (full) await this.removeDeletedDocumentFiles()
      } catch (error) {
        if (this.locked || error instanceof KeyMismatchError) return
        if (error instanceof AuthError && failure === null) failure = error
        else recordError(error)
      }
    }
    if (this.locked) return
    // Het bewijs uit de echte omgeving (wie schreef wat, met welke versie): op de achtergrond, alleen lezen; ook als de
    // ronde om een andere reden stopte (dan staat "Alles herstellen" er ook, zie unreadableFiles).
    if (unreadable.size > 0 && !offline) void this.autoEvidence([...unreadable.keys()]).catch(recordError)
    if (failure === null && unreadable.size > 0) {
      const reasons = [...unreadable].map(([path, name]) => (kinds.has(path) ? `${name}/${kinds.get(path)}` : name))
      failure = new UnreadableFileError([...unreadable.keys()], [...new Set(reasons)].join(', '))
    }
    if (failure === null) {
      await this.cleanupDocumentFiles().catch(recordError)
      if (this.locked) return
      if (!waiting && full) this.syncedOnce = true
      if (!waiting) this.syncedSeq = Math.max(this.syncedSeq, covered)
      this.setStatus(this.idleStatus())
      return
    }
    this.reportFailure(failure)
  }

  /**
   * Back-up van het hele logboek als tekst (zie src/storage/backup.ts): alle records, ook verwijderde, versleuteld onder
   * de hoofdsleutel, met de lokale meta erbij (alleen te openen met de wachtzin of herstelcode).
   */
  async exportBackup(): Promise<string> {
    this.assertUnlocked()
    // Een bestand van een nieuwere app staat niet in het geheugen: dan geen (onvolledige) back-up, eerst bijwerken.
    if (this.frozen.size > 0) throw new NewerSchemaError(0)
    const meta = await Store.loadMeta(this.db)
    if (!meta) throw new Error('Geen meta op dit apparaat')
    return encodeBackup(meta, this.masterKey, new Map(COLLECTION_PATHS.map((path) => [path, this.get(path)])))
  }

  /** Laatste controle en per bestand de laatste geslaagde sync (Meer → Opslag). */
  storageLog() {
    return readStorageLog(this.db.name)
  }

  /** Bestanden van een nieuwere app-versie op dit apparaat (niet in het geheugen, dus niet te exporteren). */
  frozenPaths(): CollectionPath[] {
    return [...this.frozen]
  }

  /** Records op dit apparaat per bestand (niet verwijderd). */
  localCount(path: CollectionPath): number {
    return this.list(path).length
  }

  /**
   * "Controleer nu": eerst synchroniseren, dan alles opnieuw van GitHub halen, ontsleutelen en per bestand vergelijken
   * met dit apparaat. Alleen paden, aantallen en de soort uitkomst worden bewaard (regel 9). Null als de controle niet
   * kon (geen verbinding, token, of de sync lukte niet; de syncstatus zegt waarom). `syncFirst: false` na een net
   * geslaagde sync. Wijzigingen die nog wachten tellen niet als verschil; een probleem wordt na `retryMs` nog één keer
   * bekeken, omdat GitHub vlak na het schrijven soms nog even de vorige versie geeft.
   */
  check(syncFirst = true, retryMs = CHECK_RETRY_MS): Promise<StorageCheck | null> {
    // Demomodus: niets controleren op GitHub.
    if (this.demo) return Promise.resolve(null)
    // Loopt er al een controle zonder sync vooraf, dan daarna alsnog met sync ("Controleer nu" tijdens de weekcontrole).
    if (this.checking && syncFirst && !this.checkingSyncs) return this.checking.then(() => this.check(true, retryMs))
    if (!this.checking) {
      this.checkingSyncs = syncFirst
      this.checking = this.runCheck(syncFirst, retryMs).finally(() => {
        this.checking = null
      })
    }
    return this.checking
  }

  /**
   * Eén keer per week vanzelf, na een geslaagde sync, en na elke update (een andere build dan bij de vorige controle);
   * vond de vorige controle een probleem, dan bij elk openen opnieuw (zodat de melding verdwijnt zodra het opgelost is).
   * Alleen bij een probleem verschijnt een melding.
   */
  async weeklyCheck(now = Date.now(), retryMs = CHECK_RETRY_MS, build = BUILD): Promise<void> {
    if (!this.syncedOnce || this.locked || this.outdated) return
    const last = readStorageLog(this.db.name).check
    const at = last ? Date.parse(last.at) : NaN
    if (last && !checkHasProblem(last) && last.build === build && now - at < CHECK_EVERY_MS && at <= now) return
    await this.check(false, retryMs)
  }

  /** Vond de laatste controle een probleem, dan na herstellen opnieuw controleren (op de achtergrond). */
  private recheckIfProblem(): void {
    const last = readStorageLog(this.db.name).check
    if (last && checkHasProblem(last) && !this.locked) void this.check(false).catch(recordError)
  }

  private async runCheck(syncFirst: boolean, retryMs: number): Promise<StorageCheck | null> {
    this.assertUnlocked()
    if (syncFirst) await this.sync()
    if (this.locked || this.status.kind === 'offline' || this.outdated || this.mismatch) return null
    if (this.status.kind === 'error' && this.status.code !== 'unreadable') return null
    const result = await exclusive(this.db.name, 'sync', async (): Promise<StorageCheck | null> => {
      let metaOk: boolean
      try {
        metaOk = (await this.checkMeta()) === 'match'
      } catch (error) {
        if (error instanceof NetworkError || error instanceof GithubError) return null
        throw error
      }
      const files: FileCheck[] = []
      for (const path of COLLECTION_PATHS) {
        if (this.locked) return null
        const file = await this.inspect(path)
        if (!file) return null
        files.push(file)
      }
      return { at: new Date().toISOString(), metaOk, files, build: BUILD }
    })
    if (!result || this.locked) return null
    // Een probleem nog één keer bekijken: GitHub geeft vlak na het schrijven soms nog even de vorige versie.
    if (result.files.some(isProblem) && retryMs >= 0) {
      await new Promise((r) => setTimeout(r, retryMs))
      if (this.locked) return null
      const again = await exclusive(this.db.name, 'sync', async () => {
        const files: FileCheck[] = []
        for (const file of result.files) {
          if (this.locked) return null
          const next = isProblem(file) ? await this.inspect(file.path) : file
          if (!next) return null
          files.push(next)
        }
        return files
      })
      if (!again || this.locked) return null
      result.files = again
    }
    // Wie elk bestand het laatst schreef (versie en apparaat uit het commitbericht): tegelijk en buiten het slot, zodat
    // opslaan en syncen niet wachten. Lukt het niet, dan zonder; de controle zelf staat al vast.
    const writers = await Promise.all(result.files.map((f) => (f.state === 'leeg' || f.state === 'ontbreekt' ? null : this.lastWriter(f.path))))
    if (this.locked) return null
    result.files = result.files.map((f, i) => ({ ...f, ...writers[i] }))
    const log = readStorageLog(this.db.name)
    writeStorageLog(this.db.name, { ...log, check: result })
    this.notify()
    return result
  }

  /** Eén bestand op GitHub vergelijken met dit apparaat; null zonder verbinding of bij een GitHub-fout. */
  private async inspect(path: CollectionPath): Promise<FileCheck | null> {
    let file: RemoteFile | null
    try {
      file = await this.client.getFile(path)
    } catch (error) {
      if (error instanceof NetworkError || error instanceof GithubError) return null
      throw error
    }
    // Wat nog wacht (opgeslagen maar nog niet gesynct, ook in een ander venster) telt niet als verschil.
    await this.absorbDisk(path)
    const pending = new Set(Object.keys(this.outbox[path] ?? {}))
    const local = this.get(path)
    const localActive = local.filter((r) => r.deletedAt === null).length
    if (!file) return { path, local: localActive, remote: null, state: local.length === 0 ? 'leeg' : 'ontbreekt', differences: 0 }
    try {
      const remote = await decryptRecords(this.masterKey, path, file.content)
      const differences = countDifferences(local, remote, pending)
      return { path, local: localActive, remote: remote.filter((r) => r.deletedAt === null).length, state: differences === 0 ? 'gelijk' : 'verschil', differences }
    } catch (error) {
      if (!(error instanceof DecryptError) && !(error instanceof InvalidDataError) && !(error instanceof NewerSchemaError)) throw error
      // Een versie die dit apparaat al verving: GitHub loopt nog achter, geen nieuw probleem.
      if (wasReplaced(this.db.name, path, file.sha)) return { path, local: localActive, remote: null, state: 'wacht', differences: 0 }
      const reason = error instanceof DecryptError ? `${error.name}/${decryptFailureKind(file.content)}` : error.name
      return { path, local: localActive, remote: null, state: 'onleesbaar', differences: 0, reason }
    }
  }

  /** Versie en apparaat uit het laatste commitbericht van dit bestand; null als GitHub dat niet geeft. */
  private async lastWriter(path: CollectionPath): Promise<Pick<FileCheck, 'writer'> | null> {
    try {
      const info = await this.client.lastCommit(path)
      return info ? { writer: { version: info.version, device: info.device } } : null
    } catch (error) {
      if (error instanceof NetworkError || error instanceof GithubError) return null
      throw error
    }
  }

  /**
   * Hoort meta.json.enc op GitHub bij deze hoofdsleutel? match: gebonden via het check-veld; mismatch: het check-veld
   * hoort bij een andere sleutel; missing: geen meta op GitHub terwijl dit apparaat een logboek heeft (repo leeg of
   * opnieuw aangemaakt); unknown: onleesbaar, een oudere meta zonder check-veld, of een apparaat zonder lokale meta.
   * De lokale meta zegt niets over de sleutel in het geheugen; alleen het check-veld telt.
   */
  private async checkMeta(): Promise<MetaCheck> {
    this.remoteMetaUnreadable = false
    const remote = await this.client.getFile(META_PATH)
    if (!remote) return (await Store.loadMeta(this.db).catch(() => null)) ? 'missing' : 'unknown'
    let meta: Meta
    const text = new TextDecoder().decode(remote.content)
    try {
      meta = parseMeta(text)
    } catch (error) {
      if (error instanceof NewerSchemaError) throw error
      // Alleen echt kapot (geen meta-JSON) telt als terug te zetten; een onbekende meta kan van een ander logboek zijn.
      this.remoteMetaUnreadable = !looksLikeMeta(text)
      return 'unknown'
    }
    if (await verifyMetaCheck(meta, this.masterKey)) return 'match'
    return meta.check ? 'mismatch' : 'unknown'
  }

  /**
   * Wat de app per onleesbaar bestand aanbiedt (op GitHub niet te ontsleutelen of ongeldig, meta.json.enc bevestigd
   * bij deze sleutel): 'repair' zet de leesbare kopie van dit apparaat terug; 'reset' maakt het bestand leeg en begint
   * opnieuw, als er geen lokale kopie is of herstellen al twee keer niet bleef staan. Een bestand van een nieuwere
   * schemaversie wordt nooit overschreven ("Werk de app bij").
   */
  async repairOptions(): Promise<RepairOption[]> {
    if (this.outdated || this.metaVerdict !== 'match') return []
    const result: RepairOption[] = []
    for (const [path, reason] of this.unreadable) {
      if (!REPLACEABLE.has(reason)) continue
      const local = await getObject(this.db, path)
      const tooOften = repairAttempts(this.db.name, path) >= MAX_REPAIRS
      result.push({ path, action: local && !tooOften ? 'repair' : 'reset' })
    }
    return result
  }

  /** Paden waarvoor 'repair' kan (zie repairOptions). */
  async repairable(): Promise<CollectionPath[]> {
    return (await this.repairOptions()).filter((o) => o.action === 'repair').map((o) => o.path)
  }

  /**
   * Zet de lokale versie van een onleesbaar bestand opnieuw op GitHub. Alleen na een tik van Olivier (of vanzelf bij
   * seedbestanden). De onleesbare versie blijft in de geschiedenis van logboek-data staan. Na twee pogingen die niet
   * bleven staan gebeurt hier niets meer; dan biedt de app resetFile aan.
   */
  async repair(path: CollectionPath): Promise<void> {
    this.assertUnlocked()
    if (!(await this.repairable()).includes(path)) return
    // Ontsleutelt de versie op GitHub wel maar is hij ongeldig, dan gaan zijn goede records mee (zoals bij "Alles
    // herstellen"): nooit weggooien wat een ander apparaat schreef.
    await exclusive(this.db.name, 'sync', async () => {
      const remote = await this.client.getFile(path)
      const salvaged = remote ? await salvageRecords(this.masterKey, path, remote.content) : []
      await this.replaceRemote(path, mergeRecords(this.collections.get(path) ?? [], salvaged), null)
    })
    this.unreadable.delete(path)
    await this.sync()
    this.recheckIfProblem()
  }

  /**
   * Dit bestand op GitHub leegmaken en opnieuw beginnen, na een tik. Alleen als het bestand op GitHub (nog) niet te
   * ontsleutelen is; de oude versie blijft in de geschiedenis van logboek-data. Wat dit apparaat leesbaar heeft, blijft
   * staan en gaat bij de volgende sync gewoon weer mee.
   */
  async resetFile(path: CollectionPath): Promise<void> {
    this.assertUnlocked()
    if (!(await this.repairOptions()).some((o) => o.path === path)) return
    await exclusive(this.db.name, 'sync', () => this.replaceRemote(path, [], null))
    setRepairAttempts(this.db.name, path, 0)
    this.unreadable.delete(path)
    await this.sync()
    this.recheckIfProblem()
  }

  /**
   * Schrijft `records` over een onleesbaar bestand op GitHub, met de SHA als voorwaarde. Is het bestand intussen
   * leesbaar (een ander apparaat herstelde het al), dan blijft het staan. Alleen een geslaagde schrijfactie telt als
   * herstelpoging.
   */
  private async replaceRemote(path: CollectionPath, records: readonly SyncRecord[], knownSha: string | null): Promise<string | 'leesbaar' | null> {
    if (this.metaVerdict !== 'match' || this.outdated || newerBuildStarted()) return null
    await this.assertVault()
    if (this.vaultCheck !== null) {
      const meta = await this.checkMeta()
      if (meta !== 'match') this.tripMismatch('remote', this.remoteProblem(meta))
    }
    let sha = knownSha
    for (let attempt = 0; attempt < 2; attempt++) {
      // Vlak voor het schrijven opnieuw kijken (behalve de eerste keer met een net gelezen SHA): misschien heeft een
      // ander apparaat het bestand al hersteld.
      if (sha === null || attempt > 0) {
        const remote = await this.client.getFile(path)
        // Er staat (nu) niets: niets te vervangen. Een nieuw bestand maakt alleen de sync aan.
        if (!remote) return null
        else {
          try {
            await decryptRecords(this.masterKey, path, remote.content)
            return 'leesbaar'
          } catch (error) {
            if (error instanceof NewerSchemaError) {
              this.outdated = true
              throw error
            }
            if (!(error instanceof DecryptError) && !(error instanceof InvalidDataError)) throw error
          }
          sha = remote.sha
        }
      }
      try {
        const written = await this.client.putFile(path, await sealForUpload(this.masterKey, path, records), sha)
        if (sha) rememberReplaced(this.db.name, path, sha)
        setRepairAttempts(this.db.name, path, repairAttempts(this.db.name, path) + 1)
        return written
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 1) throw error
      }
    }
    return null
  }

  /**
   * "Alles herstellen" (Meer → Opslag), na een tik: eerst een sync, zodat de lijst actueel is, dan het bewijs van elk
   * onleesbaar bestand (vóór het overschrijven), dan per bestand de leesbare kopie van dit apparaat terugzetten, of een
   * lege versie als dit apparaat er niets van heeft. Ontsleutelt de versie op GitHub wel maar is hij ongeldig, dan gaan
   * zijn goede records mee (nooit weggooien wat een ander apparaat schreef). Elk bestand wordt daarna teruggelezen via
   * de blob-sha van wat net geschreven is (onveranderlijk) en via het pad (staat het er nog?): pas dan telt het als
   * hersteld. Schreef er net iets onleesbaars overheen, dan noemt het resultaat dat apparaat en die versie. De oude versie
   * blijft in de geschiedenis van logboek-data. Alleen met meta.json.enc op GitHub bij deze sleutel en de nieuwste
   * versie van de app.
   */
  async repairAll(): Promise<RepairResult[]> {
    this.assertUnlocked()
    if (this.demo) return []
    await this.sync()
    if (this.locked || this.outdated || newerBuildStarted() || this.metaVerdict !== 'match') return []
    const targets = [...this.unreadable].filter(([, reason]) => REPLACEABLE.has(reason)).map(([path]) => path)
    if (targets.length === 0) return []
    await this.gatherEvidence(targets).catch(recordError)
    const results: RepairResult[] = []
    await exclusive(this.db.name, 'sync', async () => {
      for (const path of targets) {
        if (this.locked) return
        try {
          const remote = await this.client.getFile(path)
          const salvaged = remote ? await salvageRecords(this.masterKey, path, remote.content) : []
          const records = mergeRecords(this.collections.get(path) ?? [], salvaged)
          // Zonder bekende sha: vlak voor het schrijven nog eens kijken, zodat een intussen leesbare versie blijft staan.
          const written = await this.replaceRemote(path, records, null)
          const result: RepairResult =
            written === 'leesbaar' ? { path, ok: true } : typeof written === 'string' ? { path, ...(await this.readsBack(path, written)) } : { path, ok: false }
          if (result.ok) setRepairAttempts(this.db.name, path, 0)
          results.push(result)
        } catch (error) {
          if (this.locked || error instanceof KeyMismatchError || error instanceof NetworkError || error instanceof AuthError) throw error
          recordError(error)
          results.push({ path, ok: false })
        }
      }
    })
    for (const r of results) if (r.ok) this.unreadable.delete(r.path)
    await this.sync()
    this.recheckIfProblem()
    // Wat de laatste sync weer onleesbaar vond, is niet hersteld.
    return results.map((r) => (r.ok && this.unreadable.has(r.path) ? { ...r, ok: false } : r))
  }

  /**
   * Wat net geschreven is, teruglezen: via zijn blob-sha (onveranderlijk, gecontroleerd tegen die sha) ontsleutelen, en
   * via het pad kijken of het er nog staat. GitHub geeft vlak na schrijven soms nog de vervangen versie: dan even
   * wachten. Staat er intussen een andere, onleesbare versie, dan schreef er net een ander apparaat of venster overheen.
   */
  private async readsBack(path: CollectionPath, sha: string): Promise<Omit<RepairResult, 'path'>> {
    for (let attempt = 0; ; attempt++) {
      try {
        await decryptRecords(this.masterKey, path, await this.client.getBlobAt(sha))
        break
      } catch (error) {
        if (error instanceof NetworkError || error instanceof AuthError) throw error
        // Een blob die vlak na het schrijven nog niet te vinden is: één keer opnieuw.
        if (attempt === 0 && error instanceof GithubError && !(error instanceof IntegrityError)) {
          await pause(READ_BACK_PAUSE_MS)
          continue
        }
        recordError(error)
        return { ok: false }
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = await this.client.getFile(path)
      if (!now || now.sha === sha) return { ok: true }
      if (!wasReplaced(this.db.name, path, now.sha)) {
        try {
          await decryptRecords(this.masterKey, path, now.content)
          // Een ander venster of apparaat schreef intussen een leesbare versie: ook goed.
          return { ok: true }
        } catch (error) {
          if (!(error instanceof DecryptError) && !(error instanceof InvalidDataError)) throw error
          return { ok: false, overwrittenBy: (await this.lastWriter(path))?.writer ?? { device: null, version: null } }
        }
      }
      await pause(READ_BACK_PAUSE_MS * (attempt + 1))
    }
    // GitHub toont nog de vervangen versie; de nieuwe staat er (de blob is gelezen en ontsleuteld).
    return { ok: true }
  }

  /**
   * Het bewijs voor deze bestanden (standaard de bestanden die nu onleesbaar zijn): de versie op GitHub en de laatste
   * vijf commits, met versie, apparaat, blob-sha, grootte, eerste byte en soort uitkomst (src/storage/evidence.ts).
   * Alleen lezen. Bewaard in het opslaglogboek (een week) en opgenomen in "Kopieer foutdetails".
   */
  async gatherEvidence(paths: readonly CollectionPath[] = [...this.unreadable.keys()]): Promise<FileEvidence[]> {
    this.assertUnlocked()
    if (this.demo || paths.length === 0) return []
    const out: FileEvidence[] = []
    for (const path of paths) {
      if (this.locked) return out
      try {
        out.push(await gatherEvidence(this.client, this.masterKey, path))
      } catch (error) {
        if (error instanceof NetworkError || error instanceof GithubError) break
        throw error
      }
    }
    if (this.locked) return out
    const log = readStorageLog(this.db.name)
    const weekAgo = Date.now() - 7 * 24 * 3_600_000
    const kept = (log.evidence ?? []).filter((e) => !out.some((o) => o.path === e.path) && Date.parse(e.at) > weekAgo)
    writeStorageLog(this.db.name, { ...log, evidence: [...out, ...kept].slice(0, COLLECTION_PATHS.length) })
    this.notify()
    return out
  }

  /** Na een sync met onleesbare bestanden: het bewijs ophalen voor bestanden zonder bewijs van het laatste uur. */
  private async autoEvidence(paths: readonly CollectionPath[]): Promise<void> {
    const hourAgo = Date.now() - 3_600_000
    const fresh = new Set((readStorageLog(this.db.name).evidence ?? []).filter((e) => Date.parse(e.at) > hourAgo).map((e) => e.path))
    const todo = paths.filter((p) => !fresh.has(p))
    if (todo.length > 0 && !this.locked) await this.gatherEvidence(todo)
  }

  private reportFailure(failure: unknown): void {
    const count = this.pendingCount()
    if (!(failure instanceof NetworkError)) recordError(failure)
    if (failure instanceof NetworkError) this.setStatus({ kind: 'offline', count })
    else if (failure instanceof AuthError) this.setStatus({ kind: 'error', code: 'token', count })
    else if (failure instanceof NewerSchemaError) this.setStatus({ kind: 'error', code: 'update', count })
    else if (failure instanceof GithubError) this.setStatus({ kind: 'error', code: 'github', github: failure.code, count })
    else if (failure instanceof UnreadableFileError) this.setStatus({ kind: 'error', code: 'unreadable', count, paths: failure.paths })
    else if (failure instanceof OtherKeyError) this.setStatus({ kind: 'error', code: 'otherKey', count })
    else if (failure instanceof MissingMetaError) this.setStatus({ kind: 'error', code: 'noMeta', count })
    else this.setStatus({ kind: 'error', code: 'failed', count })
  }

  private async syncPath(path: CollectionPath, prefetched: RemoteFile | null | undefined): Promise<void> {
    let remote = prefetched
    const creating = remote === null
    if (creating) {
      // Een nieuw bestand op GitHub ontstaat alleen hier: in de sync, na de sleutelcontrole van deze ronde, en pas als
      // een tweede blik bevestigt dat het er echt niet staat (GitHub geeft vlak na schrijven soms nog even 404). Staat
      // het er intussen wel (een ander venster of apparaat was eerder), dan gewoon samenvoegen.
      remote = await this.client.getFile(path)
      if (remote) {
        try {
          await decryptRecords(this.masterKey, path, remote.content)
        } catch (error) {
          if (error instanceof DecryptError) this.unreadableKinds.set(path, decryptFailureKind(remote.content))
          throw error
        }
      }
    }
    const snapshot = { ...(this.outbox[path] ?? {}) }
    const local = this.collections.get(path) ?? []
    await this.assertVault()
    const result = await syncCollection(this.client, this.masterKey, path, local, remote)
    if (this.locked) return
    if (creating && remote === null && result.pushed) await this.verifyCreated(path, result.sha)
    await exclusive(this.db.name, 'lokaal', async () => {
      // Wijzigingen tijdens het wachten blijven staan: samenvoegen met wat ondertussen in het geheugen en (door een
      // ander venster) op het apparaat is gezet.
      const during = (this.collections.get(path) ?? []).filter((r) => {
        const synced = result.records.find((s) => s.id === r.id)
        return !synced || r.updatedAt > synced.updatedAt
      })
      const fromSync = [...result.records.filter((s) => !during.some((d) => d.id === s.id)), ...during]
      const merged = await this.mergeWithDisk(path, fromSync)
      // Alleen wat echt meeging (die versie of een nieuwere staat in wat GitHub nu heeft), gaat uit de outbox; een regel
      // die een ander venster midden in de ronde toevoegde, blijft wachten.
      const sent = new Map(result.records.map((r) => [r.id, r.updatedAt]))
      const synced = Object.fromEntries(Object.entries(snapshot).filter(([id, at]) => (sent.get(id) ?? '') >= at))
      const outbox = clearSynced(await this.diskOutbox(), path, synced)
      const blob = await encryptRecords(this.masterKey, path, merged)
      if (this.locked) return
      await this.putGuarded({ path, blob, sha: result.sha }, outbox)
      if (this.locked) return
      this.collections.set(path, merged)
      this.outbox = mergeOutbox(outbox, this.unsaved)
    })
    if (this.locked) return
    this.markSynced(path)
    this.broadcast(path)
  }

  /**
   * Net aangemaakt op GitHub: één keer teruglezen. Geeft GitHub voor onze eigen versie iets terug dat niet te lezen is,
   * dan meteen melden (pad en soort defect, nooit inhoud) in plaats van het pas bij een volgende sync te ontdekken.
   * Een oudere of andere versie (GitHub loopt nog achter, of een ander apparaat schreef al) laat de volgende sync zien.
   */
  private async verifyCreated(path: CollectionPath, sha: string): Promise<void> {
    const back = await this.client.getFile(path)
    if (!back || back.sha !== sha) return
    try {
      await decryptRecords(this.masterKey, path, back.content)
    } catch (error) {
      if (error instanceof DecryptError) this.unreadableKinds.set(path, decryptFailureKind(back.content))
      throw error
    }
  }

  /** Andere vensters laten weten dat dit bestand lokaal veranderd is. */
  private broadcast(path: CollectionPath): void {
    try {
      this.channel?.postMessage({ path })
    } catch {
      // Kanaal al gesloten (vergrendeld): niets te melden.
    }
  }

  private markSynced(path: CollectionPath): void {
    const log = readStorageLog(this.db.name)
    log.synced[path] = new Date().toISOString()
    writeStorageLog(this.db.name, log)
  }

  /**
   * Een bestand opslaan op dit apparaat. Wat er nu in het geheugen staat wordt direct vastgelegd: ook als er tijdens het
   * opslaan vergrendeld wordt (de app sluit), wordt deze opslag afgemaakt. Wat een ander venster intussen opsloeg, wordt
   * samengevoegd (laatste updatedAt wint), nooit overschreven. Bestand en outbox gaan in één transactie.
   */
  private async persist(path: CollectionPath): Promise<void> {
    if (this.frozen.has(path)) return
    const mine = this.collections.get(path) ?? []
    const added = { ...(this.unsaved[path] ?? {}) }
    await exclusive(this.db.name, 'lokaal', async () => {
      const merged = await this.mergeWithDisk(path, mine)
      // De outbox op het apparaat is leidend (een ander venster kan regels al gesynct en weggehaald hebben); alleen wat
      // dit venster nu opslaat komt erbij.
      const nextOutbox = mergeOutbox(await this.diskOutbox(), { [path]: added })
      const blob = await encryptRecords(this.masterKey, path, merged)
      const stored = await getObject(this.db, path)
      await this.putGuarded({ path, blob, sha: stored?.sha ?? null }, nextOutbox)
      this.forgetUnsaved(path, added)
      if (this.locked) return
      // Andere vensters en wijzigingen die tijdens het opslaan in het geheugen kwamen, allebei behouden.
      this.collections.set(path, mergeRecords(merged, this.collections.get(path) ?? []))
      this.outbox = mergeOutbox(nextOutbox, this.unsaved)
    })
    if (this.locked) return
    this.savedSeq = ++this.seq
    this.broadcast(path)
    if (this.status.kind !== 'syncing') this.setStatus(this.idleStatus())
    else this.notify()
    this.scheduleSync()
  }

  /** Outbox-regels die nu op het apparaat staan, zijn niet meer 'unsaved' (een latere opslag van hetzelfde record wel). */
  private forgetUnsaved(path: CollectionPath, written: Record<string, string>): void {
    const rest = { ...(this.unsaved[path] ?? {}) }
    for (const [id, updatedAt] of Object.entries(written)) if (rest[id] === updatedAt) delete rest[id]
    const next = { ...this.unsaved }
    if (Object.keys(rest).length > 0) next[path] = rest
    else delete next[path]
    this.unsaved = next
  }

  /**
   * `mine` samengevoegd met de lokale kopie op het apparaat (een ander venster kan die intussen geschreven hebben);
   * bij gelijke updatedAt wint `mine`. Een lokale kopie van een nieuwere app wordt nooit overschreven: dan alleen-lezen
   * en "Werk de app bij". Een lokale kopie die wel ontsleutelt maar ongeldig is, wordt eerst apart bewaard.
   */
  private async mergeWithDisk(path: CollectionPath, mine: readonly SyncRecord[]): Promise<SyncRecord[]> {
    const stored = await getObject(this.db, path)
    if (!stored) return [...mine]
    try {
      return mergeRecords(await decryptRecords(this.masterKey, path, stored.blob), mine)
    } catch (error) {
      if (error instanceof NewerSchemaError) {
        this.outdated = true
        this.frozen.add(path)
        this.setStatus(this.updateStatus())
        throw error
      }
      if (error instanceof InvalidDataError) {
        if (await setAsideIfVault(this.db, META_PATH, this.vaultCheck, path, stored.blob, `${SET_ASIDE_PREFIX}${path}/${new Date().toISOString()}`)) {
          if (!this.setAsidePaths.includes(path)) this.setAsidePaths.push(path)
        }
        return [...mine]
      }
      // Niet te ontsleutelen: een ander logboek op dit apparaat; putGuarded houdt het schrijven dan tegen.
      if (error instanceof DecryptError) return [...mine]
      throw error
    }
  }

  /** De outbox zoals die nu op het apparaat staat (een ander venster kan hem bijgewerkt hebben). */
  private async diskOutbox(): Promise<Outbox> {
    const blob = await getLocal(this.db, OUTBOX_NAME)
    if (!blob) return {}
    try {
      return await decryptOutbox(this.masterKey, blob)
    } catch {
      return {}
    }
  }

  /** Neemt wat een ander venster van dit bestand opsloeg over in het geheugen, met de outbox op het apparaat. */
  private async absorbDisk(path: CollectionPath, withOutbox = true): Promise<void> {
    if (this.frozen.has(path)) return
    const mine = this.collections.get(path) ?? []
    const merged = await this.mergeWithDisk(path, mine)
    if (this.locked) return
    const current = this.collections.get(path) ?? []
    if (!sameRecords(merged, current)) this.collections.set(path, mergeRecords(merged, current))
    if (withOutbox) await this.absorbOutbox()
  }

  /** De outbox op het apparaat is leidend, plus wat dit venster nog aan het opslaan is. */
  private async absorbOutbox(): Promise<void> {
    const disk = await this.diskOutbox()
    if (this.locked) return
    this.outbox = mergeOutbox(disk, this.unsaved)
    this.setStatus(this.status.kind === 'syncing' ? this.status : this.idleStatus())
  }

  private async absorbAll(): Promise<void> {
    for (const path of COLLECTION_PATHS) {
      if (this.locked) return
      await this.absorbDisk(path, false)
    }
    await this.absorbOutbox()
  }

  /**
   * Sleutel-invariant voor IndexedDB: de lokale meta moet nog de meta zijn waaraan de sleutel bij openen gebonden
   * was. Een ander tabblad of een andere versie van de app kan intussen een ander logboek hebben gemaakt of gekoppeld;
   * dan zou deze Store gegevens onder een andere sleutel naast die van het nieuwe logboek zetten.
   */
  private async assertVault(): Promise<void> {
    if (this.mismatch) throw new KeyMismatchError('local')
    if (this.vaultCheck === null) return
    const meta = await Store.loadMeta(this.db).catch(() => null)
    if (this.mismatch) throw new KeyMismatchError('local')
    if (meta?.check === this.vaultCheck) return
    // Een nieuwere meta van dezelfde sleutel (wachtzin gewijzigd, hier of op een ander apparaat) is in orde.
    if (meta?.check && (await verifyMetaCheck(meta, this.masterKey))) {
      this.vaultCheck = meta.check
      return
    }
    this.tripMismatch('local')
  }

  /**
   * Lokaal schrijven onder de sleutel-invariant: controle van de lokale meta en schrijven (bestand plus outbox) in één
   * transactie, zodat een ander tabblad er niet tussen een ander logboek kan neerzetten. Na vergrendelen hoort een
   * ander logboek op dit apparaat niet meer bij deze opslag: dan stil niets schrijven.
   */
  private async putGuarded(object: StoredObject, outbox: Outbox): Promise<void> {
    if (this.mismatch) throw new KeyMismatchError('local')
    const local = { name: OUTBOX_NAME, blob: await encryptOutbox(this.masterKey, outbox) }
    if (this.vaultCheck === null) {
      await putObjectAndLocal(this.db, META_PATH, null, object, local)
      return
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await putObjectAndLocal(this.db, META_PATH, this.vaultCheck, object, local)) return
      if (this.locked) return
      // Andere meta: hoort die bij deze sleutel, dan opnieuw met het nieuwe check-veld; anders stoppen.
      await this.assertVault()
    }
    this.tripMismatch('local')
  }

  // ---------- Kluis: documentbestanden (src/storage/documents.ts) ----------

  /** In deze ronde geüploade bestanden: hun kopie op het apparaat blijft tot een volgende ronde (GitHub loopt soms achter). */
  private readonly uploadedThisRound = new Set<string>()
  /** Documentbestanden die nog niet op GitHub staan (tellen als wachtende wijziging). */
  private pendingDocs = new Set<string>()
  /** Na een mislukte upload: vanzelf na een opslag pas na dit tijdstip opnieuw proberen (verversen probeert altijd). */
  private documentRetryAt = 0
  /** Bestanden die deze sessie al van GitHub haalde (naast localStorage). */
  private readonly removedFiles = new Set<string>()

  /** Een documentbestand versleuteld op dit apparaat zetten (AAD = pad); de volgende sync zet het op GitHub. */
  async putDocumentFile(fileId: string, bytes: Bytes): Promise<void> {
    this.assertUnlocked()
    if (this.frozen.size > 0) throw new NewerSchemaError(0)
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError()
    const path = documentPath(fileId)
    const blob = await encryptObject(this.masterKey, path, bytes)
    // Dezelfde controle als sealForUpload: wat niet terug te lezen is, komt niet op het apparaat en niet op GitHub.
    await decryptObject(this.masterKey, path, blob)
    await this.putObjectGuarded({ path, blob, sha: null, addedAt: Date.now() })
    this.pendingDocs.add(fileId)
    this.scheduleSync()
  }

  /** Het bestand van een document: de kopie op dit apparaat, anders van GitHub (alleen bewaard met `keep`). */
  async documentFile(fileId: string, keep = false): Promise<Bytes> {
    this.assertUnlocked()
    const path = documentPath(fileId)
    const local = await getObject(this.db, path)
    if (local) return decryptObject(this.masterKey, path, local.blob)
    if (this.demo) throw new DocumentUnavailableError('demo')
    const remote = await this.client.getFile(path)
    if (!remote) throw new DocumentUnavailableError('missing')
    const plain = await decryptObject(this.masterKey, path, remote.content)
    this.assertUnlocked()
    if (keep) await this.putObjectGuarded({ path, blob: remote.content, sha: remote.sha })
    return plain
  }

  /** Staat er een kopie van dit bestand op het apparaat, en is die al op GitHub? */
  async documentFileState(fileId: string): Promise<'none' | 'pending' | 'local'> {
    this.assertUnlocked()
    const local = await getObject(this.db, documentPath(fileId))
    return !local ? 'none' : local.sha === null ? 'pending' : 'local'
  }

  /** Offline beschikbaar: een kopie op het apparaat houden (zo nodig ophalen), of weghalen als hij al op GitHub staat. */
  async setDocumentOffline(fileId: string, offline: boolean): Promise<void> {
    this.assertUnlocked()
    const path = documentPath(fileId)
    const local = await getObject(this.db, path)
    if (offline) {
      if (!local) await this.documentFile(fileId, true)
      return
    }
    if (local && local.sha !== null) await deleteObject(this.db, path)
  }

  /**
   * De documentbestanden op dit apparaat die nog niet op GitHub staan, van een document dat in de index staat en niet
   * verwijderd is. Een losgeraakt bestand (de index werd nooit opgeslagen) gaat nooit naar GitHub.
   */
  async pendingDocumentFiles(): Promise<string[]> {
    if (this.demo) return []
    const live = new Set(this.get('documents/index.json.enc').filter((d) => d.deletedAt === null).map((d) => d.fileId))
    const out: string[] = []
    for (const path of await listObjectPaths(this.db, DOCUMENTS_PREFIX)) {
      const fileId = fileIdOf(path)
      if (!fileId || !live.has(fileId)) continue
      const object = await getObject(this.db, path)
      if (object && object.sha === null) out.push(fileId)
    }
    return out
  }

  /**
   * In een syncronde, na een bevestigde meta-controle: elk documentbestand dat nog niet op GitHub staat, als nieuw bestand
   * uploaden. Eerst weer ontsleuteld met dezelfde sleutel en hetzelfde pad; lukt dat niet, dan gaat dat bestand niet. Bestaat
   * het pad al (een eerdere ronde brak af na het schrijven), dan telt de versie op GitHub als die met deze sleutel te lezen is.
   */
  private async uploadDocumentFiles(): Promise<void> {
    for (const fileId of await this.pendingDocumentFiles()) {
      if (this.locked) return
      const path = documentPath(fileId)
      const local = await getObject(this.db, path)
      if (!local || local.sha !== null) continue
      try {
        await decryptObject(this.masterKey, path, local.blob)
      } catch (error) {
        // Een kapotte kopie op dit apparaat: niet uploaden, de andere bestanden wel.
        recordError(error)
        continue
      }
      let sha: string
      try {
        try {
          sha = await this.client.putFile(path, local.blob, null, DOCUMENT_TIMEOUT_MS)
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error
          const remote = await this.client.getFile(path, DOCUMENT_TIMEOUT_MS)
          if (!remote) throw error
          await decryptObject(this.masterKey, path, remote.content)
          sha = remote.sha
        }
      } catch (error) {
        if (error instanceof AuthError) throw error
        // Geen of een trage verbinding (of GitHub hapert): de andere documenten in deze ronde ook niet, en vanzelf na een
        // opslag pas over 10 minuten opnieuw. Een conflict dat niet bij deze sleutel hoort: alleen dit bestand overslaan.
        if (error instanceof NetworkError || (error instanceof GithubError && !(error instanceof ConflictError))) {
          this.documentRetryAt = Date.now() + DOCUMENT_RETRY_MS
          return
        }
        recordError(error)
        continue
      }
      if (this.locked) return
      this.uploadedThisRound.add(fileId)
      await this.putObjectGuarded({ ...local, sha })
      this.pendingDocs.delete(fileId)
    }
    this.documentRetryAt = 0
  }

  /**
   * Na een volledige ronde: het bestand van een document dat langer dan een dag verwijderd is, ook van GitHub halen (met
   * de SHA als voorwaarde; de geschiedenis van logboek-data houdt de versleutelde oude versie). Elk bestand één keer per
   * apparaat; een bestand dat er al niet meer staat, is goed.
   */
  private async removeDeletedDocumentFiles(now = Date.now()): Promise<void> {
    if (this.demo) return
    const done = removedDocumentFiles(this.db.name)
    for (const document of this.get('documents/index.json.enc')) {
      if (this.locked) return
      const { fileId } = document
      if (document.deletedAt === null || now - Date.parse(document.deletedAt) <= DOCUMENT_GRACE_MS) continue
      if (!isFileId(fileId) || done.has(fileId) || this.removedFiles.has(fileId)) continue
      const path = documentPath(fileId)
      try {
        const sha = await this.client.fileSha(path)
        if (sha) await this.client.deleteFile(path, sha)
      } catch (error) {
        if (error instanceof NetworkError || error instanceof AuthError) throw error
        // Een conflict of een andere fout: een volgende volledige ronde probeert het opnieuw.
        recordError(error)
        continue
      }
      this.removedFiles.add(fileId)
      rememberRemovedDocumentFile(this.db.name, fileId)
    }
  }

  /**
   * Opruimen op dit apparaat na een geslaagde ronde: de kopie van een verwijderd document na een dag (zodat ongedaan
   * maken werkt), en de kopie van een document dat niet offline hoeft en al op GitHub staat. Nooit iets dat nog niet op
   * GitHub staat, behalve van een document dat al een dag verwijderd is.
   */
  private async cleanupDocumentFiles(now = Date.now()): Promise<void> {
    if (this.demo) return
    const documents = new Map(this.get('documents/index.json.enc').map((d) => [d.fileId, d]))
    for (const path of await listObjectPaths(this.db, DOCUMENTS_PREFIX)) {
      if (this.locked) return
      const fileId = fileIdOf(path)
      if (!fileId || this.uploadedThisRound.has(fileId)) continue
      const document = documents.get(fileId)
      const object = await getObject(this.db, path)
      if (!object) continue
      // Losgeraakt (de index werd nooit opgeslagen): na een dag weg; zo'n bestand gaat nooit naar GitHub.
      if (!document) {
        if (object.sha === null && object.addedAt !== undefined && now - object.addedAt > DOCUMENT_GRACE_MS) await deleteObject(this.db, path)
        continue
      }
      const deletedLongAgo = document.deletedAt !== null && now - Date.parse(document.deletedAt) > DOCUMENT_GRACE_MS
      const notNeeded = document.deletedAt === null && !document.offline && object.sha !== null
      if (deletedLongAgo || notNeeded) await deleteObject(this.db, path)
    }
  }

  /** Eén object schrijven onder de sleutel-invariant (zoals putGuarded, zonder outbox). */
  private async putObjectGuarded(object: StoredObject): Promise<void> {
    if (this.mismatch) throw new KeyMismatchError('local')
    if (this.vaultCheck === null) {
      await putObject(this.db, object)
      return
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await putObjectIfVault(this.db, META_PATH, this.vaultCheck, object)) return
      if (this.locked) return
      await this.assertVault()
    }
    this.tripMismatch('local')
  }

  private remoteProblem(meta: MetaCheck): RemoteMetaProblem {
    if (meta === 'missing') return 'missing'
    return meta === 'unknown' && this.remoteMetaUnreadable ? 'unreadable' : 'other'
  }

  /** Stopt deze Store voorgoed: niets meer schrijven, de sessie laten weten dat de sleutel niet past. */
  private tripMismatch(where: 'local' | 'remote', remote: RemoteMetaProblem = 'other'): never {
    const error = new KeyMismatchError(where, remote)
    if (!this.mismatch) {
      this.mismatch = true
      recordError(error)
      this.setStatus({ kind: 'error', code: 'keyMismatch', count: this.pendingCount() })
      for (const listener of this.mismatchListeners) listener(error)
    }
    throw error
  }

  /** "Werk de app bij", met de lokale bestanden van een nieuwere app (de melding staat bij die onderdelen). */
  private updateStatus(): SyncStatus {
    const paths = [...this.frozen]
    return { kind: 'error', code: 'update', count: this.pendingCount(), ...(paths.length > 0 ? { paths } : {}) }
  }

  private idleStatus(): SyncStatus {
    if (this.demo) return { kind: 'demo' }
    const count = this.pendingCount()
    if (count === 0) return { kind: 'synced' }
    if (this.status.kind === 'offline') return { kind: 'offline', count }
    if (this.status.kind === 'error') return { ...this.status, count }
    return { kind: 'pending', count }
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private assertUnlocked(): void {
    if (this.locked) throw new Error('Vergrendeld')
  }
}

/** Aantal records dat op GitHub en op dit apparaat niet precies gelijk is (ook verwijderde, die tellen voor sync mee). */
export function countDifferences(local: readonly SyncRecord[], remote: readonly SyncRecord[], skip: ReadonlySet<string> = new Set()): number {
  const byId = new Map(remote.filter((r) => !skip.has(r.id)).map((r) => [r.id, stable(r)]))
  let n = 0
  for (const r of local) {
    if (skip.has(r.id)) continue
    if (byId.get(r.id) !== stable(r)) n++
    byId.delete(r.id)
  }
  return n + byId.size
}

/** JSON met gesorteerde sleutels: dezelfde inhoud geeft dezelfde tekst, ongeacht de volgorde van de velden. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  )
}
