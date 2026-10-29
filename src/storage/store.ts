import { DecryptError, utf8 } from '../crypto/encrypt'
import { recordError } from '../errors'
import { looksLikeMeta, META_PATH, parseMeta, serializeMeta, verifyMetaCheck, type Meta } from '../crypto/keys'
import { t } from '../i18n'
import { NewerSchemaError } from '../model/schema'
import { COLLECTION_PATHS, type CollectionPath, type Collections, type SyncRecord } from '../model/types'
import { AuthError, ConflictError, GithubError, NetworkError, type GithubClient, type GithubErrorCode, type RemoteFile } from './github'
import { getLocal, getObject, putObject, putObjectAndLocal, setAsideIfVault, type Db, type StoredObject } from './idb'
import { clearSynced, decryptOutbox, encryptOutbox, loadOutbox, markPending, mergeOutbox, OUTBOX_NAME, pendingCount, type Outbox } from './outbox'
import { MAX_REPAIRS, rememberReplaced, repairAttempts, setRepairAttempts, wasReplaced } from '../repair'
import { decryptFailureKind, decryptRecords, encryptRecords, InvalidDataError, mergeRecords, sameRecords, sealForUpload, syncCollection } from './sync'
import { encodeBackup } from './backup'
import { exclusive } from './writer'
import { readStorageLog, writeStorageLog, type FileCheck, type StorageCheck } from './storage-log'

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
  private readonly channel: BroadcastChannel | null
  /** Na elke opslag vanzelf synchroniseren (de sessie zet dit aan; tests van de opslaglaag niet). */
  private autoSync = false
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null
  /** Laatste lokale opslag en laatste volledige sync (ms sinds 1970), voor "Opgeslagen" en daarna "Gesynct". */
  private savedAt = 0
  private syncedAt = 0
  /** Soort defect per onleesbaar bestand (leeg, formaat, sleutel), voor de foutdetails; nooit inhoud. */
  private unreadableKinds = new Map<CollectionPath, string>()
  private checking: Promise<StorageCheck | null> | null = null

  private constructor(
    private readonly db: Db,
    private readonly masterKey: CryptoKey,
    private readonly client: GithubClient,
    private vaultCheck: string | null,
  ) {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`logboek-opslag:${db.name}`)
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        const path = COLLECTION_PATHS.find((p) => p === (event.data as { path?: unknown } | null)?.path)
        if (path && !this.locked) void this.absorbDisk(path).catch(recordError)
      }
      // Node (tests): het kanaal mag het proces niet openhouden.
      ;(this.channel as unknown as { unref?: () => void }).unref?.()
    }
  }

  /**
   * Laadt de lokale versleutelde kopie uit IndexedDB. Synchroniseert nog niet.
   * `vaultCheck`: het check-veld van de meta waaraan `masterKey` bij openen gebonden is (sessie). Dan geldt de
   * sleutel-invariant: vóór elke schrijfactie naar IndexedDB moet de lokale meta nog dezelfde zijn, en vóór elke
   * schrijfactie naar GitHub moet meta.json.enc op GitHub aan deze sleutel gebonden zijn. Zonder (alleen tests van de
   * opslaglaag) gelden alleen de controles uit runSync.
   */
  static async open(db: Db, masterKey: CryptoKey, client: GithubClient, vaultCheck: string | null = null): Promise<Store> {
    const store = new Store(db, masterKey, client, vaultCheck)
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
    return store
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

  /** Meerdere records in één keer versleutelen en opslaan (bijvoorbeeld een import). */
  async putMany<P extends CollectionPath>(path: P, records: readonly Collections[P][]): Promise<void> {
    this.assertUnlocked()
    // Een lokaal bestand van een nieuwere app: tot bijwerken alleen kijken, nergens wijzigen. Vóór elke wijziging
    // weigeren (ook in andere bestanden), zodat een handeling die meerdere bestanden raakt nooit half wordt opgeslagen.
    if (this.frozen.size > 0) throw new NewerSchemaError(0)
    const ids = new Set(records.map((r) => r.id))
    const kept = (this.collections.get(path) ?? []).filter((r) => !ids.has(r.id))
    this.collections.set(path, [...kept, ...records])
    for (const r of records) this.outbox = markPending(this.outbox, path, r.id, r.updatedAt)
    if (this.syncing) this.syncAgain = true
    await this.persist(path)
  }

  async remove<P extends CollectionPath>(path: P, id: string): Promise<void> {
    const current = this.get(path).find((r) => r.id === id)
    if (!current || current.deletedAt !== null) return
    const now = new Date().toISOString()
    await this.put(path, { ...current, updatedAt: now, deletedAt: now })
  }

  pendingCount(): number {
    return pendingCount(this.outbox)
  }

  /** Synchroniseert alle bestanden. Loopt er al een sync, dan volgt na afloop nog een ronde. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing
    }
    this.syncing = this.runRounds().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async runRounds(): Promise<void> {
    do {
      this.syncAgain = false
      // Eén venster tegelijk naar GitHub; een ander venster wacht en synct daarna (met wat dat venster opsloeg).
      await exclusive(this.db.name, 'sync', () => this.runSync())
    } while (this.syncAgain && !this.locked && this.status.kind !== 'offline' && this.status.kind !== 'error')
  }

  /** Wist alle ontsleutelde data uit het geheugen. De Store is daarna onbruikbaar. */
  lock(): void {
    this.locked = true
    this.collections.clear()
    this.outbox = {}
    this.listeners.clear()
    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer)
    this.autoSyncTimer = null
    this.channel?.close()
  }

  /** Na elke opslag vanzelf synchroniseren (kort daarna, zodat snel achter elkaar opslaan één sync geeft). */
  enableAutoSync(): void {
    this.autoSync = true
  }

  /** Tijdstip (ms) van de laatste lokale opslag en de laatste volledige sync; 0 = nog niet in deze sessie. */
  savedTimes(): { savedAt: number; syncedAt: number } {
    return { savedAt: this.savedAt, syncedAt: this.syncedAt }
  }

  private scheduleSync(): void {
    if (!this.autoSync || this.locked) return
    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer)
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = null
      if (!this.locked) void this.sync()
    }, AUTO_SYNC_MS)
  }

  private async runSync(): Promise<void> {
    const count = () => this.pendingCount()
    if (this.mismatch) {
      this.setStatus({ kind: 'error', code: 'keyMismatch', count: count() })
      return
    }
    if (this.outdated) {
      this.setStatus(this.updateStatus())
      return
    }
    this.setStatus({ kind: 'syncing' })
    let failure: unknown = null
    // Hoort logboek-data bij deze hoofdsleutel? Zo niet, dan niets schrijven: anders komen er bestanden onder
    // een andere sleutel naast de echte te staan, die de andere apparaten niet kunnen lezen.
    let meta: MetaCheck
    try {
      await this.assertVault()
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
      if (error instanceof NewerSchemaError) this.outdated = true
      this.reportFailure(error)
      return
    }
    // Wat andere vensters van de app intussen lokaal opsloegen, gaat in deze ronde mee.
    try {
      await this.absorbAll()
    } catch (error) {
      if (this.locked || error instanceof KeyMismatchError) return
      if (error instanceof NewerSchemaError) {
        this.setStatus(this.updateStatus())
        return
      }
      throw error
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
    for (const path of COLLECTION_PATHS) {
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
          await this.replaceRemote(path, this.collections.get(path) ?? [], remoteSha.get(path) ?? null)
          unreadable.delete(path)
        } catch (error) {
          if (this.locked || error instanceof KeyMismatchError) return
          if (error instanceof NetworkError || error instanceof AuthError) {
            this.reportFailure(error)
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
    if (failure === null && unreadable.size > 0) {
      const reasons = [...unreadable].map(([path, name]) => (kinds.has(path) ? `${name}/${kinds.get(path)}` : name))
      failure = new UnreadableFileError([...unreadable.keys()], [...new Set(reasons)].join(', '))
    }
    if (failure === null) {
      if (!waiting) {
        this.syncedOnce = true
        this.syncedAt = Date.now()
      }
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
    const meta = await Store.loadMeta(this.db)
    if (!meta) throw new Error('Geen meta op dit apparaat')
    return encodeBackup(meta, this.masterKey, new Map(COLLECTION_PATHS.map((path) => [path, this.get(path)])))
  }

  /** Laatste controle en per bestand de laatste geslaagde sync (Meer → Opslag). */
  storageLog() {
    return readStorageLog(this.db.name)
  }

  /** Records op dit apparaat per bestand (niet verwijderd). */
  localCount(path: CollectionPath): number {
    return this.list(path).length
  }

  /**
   * "Controleer nu": eerst synchroniseren, dan alles opnieuw van GitHub halen, ontsleutelen en per bestand vergelijken
   * met dit apparaat. Alleen paden, aantallen en de soort uitkomst worden bewaard (regel 9). Null als er geen
   * verbinding is of de sync niet lukte (de syncstatus zegt dan waarom). `syncFirst: false` na een net geslaagde sync.
   */
  check(syncFirst = true): Promise<StorageCheck | null> {
    this.checking ??= this.runCheck(syncFirst).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  /** Eén keer per week vanzelf, na een geslaagde sync; alleen bij een probleem verschijnt een melding. */
  async weeklyCheck(now = Date.now()): Promise<void> {
    if (!this.syncedOnce || this.locked || this.outdated) return
    const last = readStorageLog(this.db.name).check
    if (last && now - Date.parse(last.at) < CHECK_EVERY_MS && Date.parse(last.at) <= now) return
    await this.check(false)
  }

  private async runCheck(syncFirst: boolean): Promise<StorageCheck | null> {
    this.assertUnlocked()
    if (syncFirst) await this.sync()
    if (this.locked || this.status.kind === 'offline' || this.outdated || this.mismatch) return null
    if (this.status.kind === 'error' && this.status.code !== 'unreadable') return null
    const result = await exclusive(this.db.name, 'sync', async (): Promise<StorageCheck | null> => {
      let metaOk: boolean
      try {
        metaOk = (await this.checkMeta()) === 'match'
      } catch (error) {
        if (error instanceof NetworkError) return null
        throw error
      }
      const files: FileCheck[] = []
      for (const path of COLLECTION_PATHS) {
        if (this.locked) return null
        const local = this.get(path)
        const localActive = local.filter((r) => r.deletedAt === null).length
        let file: RemoteFile | null
        try {
          file = await this.client.getFile(path)
        } catch (error) {
          if (error instanceof NetworkError) return null
          throw error
        }
        if (!file) {
          files.push({ path, local: localActive, remote: null, state: local.length === 0 ? 'leeg' : 'ontbreekt', differences: 0 })
          continue
        }
        try {
          const remote = await decryptRecords(this.masterKey, path, file.content)
          const differences = countDifferences(local, remote)
          files.push({ path, local: localActive, remote: remote.filter((r) => r.deletedAt === null).length, state: differences === 0 ? 'gelijk' : 'verschil', differences })
        } catch (error) {
          if (!(error instanceof DecryptError) && !(error instanceof InvalidDataError) && !(error instanceof NewerSchemaError)) throw error
          const reason = error instanceof DecryptError ? `${error.name}/${decryptFailureKind(file.content)}` : error.name
          files.push({ path, local: localActive, remote: null, state: 'onleesbaar', differences: 0, reason })
        }
      }
      return { at: new Date().toISOString(), metaOk, files }
    })
    if (!result || this.locked) return null
    const log = readStorageLog(this.db.name)
    writeStorageLog(this.db.name, { ...log, check: result })
    this.notify()
    return result
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
    await exclusive(this.db.name, 'sync', () => this.replaceRemote(path, this.collections.get(path) ?? [], null))
    this.unreadable.delete(path)
    await this.sync()
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
  }

  /**
   * Schrijft `records` over een onleesbaar bestand op GitHub, met de SHA als voorwaarde. Is het bestand intussen
   * leesbaar (een ander apparaat herstelde het al), dan blijft het staan. Alleen een geslaagde schrijfactie telt als
   * herstelpoging.
   */
  private async replaceRemote(path: CollectionPath, records: readonly SyncRecord[], knownSha: string | null): Promise<void> {
    if (this.metaVerdict !== 'match' || this.outdated) return
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
        if (!remote) return
        else {
          try {
            await decryptRecords(this.masterKey, path, remote.content)
            return
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
        await this.client.putFile(path, await sealForUpload(this.masterKey, path, records), sha)
        if (sha) rememberReplaced(this.db.name, path, sha)
        setRepairAttempts(this.db.name, path, repairAttempts(this.db.name, path) + 1)
        return
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 1) throw error
      }
    }
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
      if (remote) await decryptRecords(this.masterKey, path, remote.content)
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
      const outbox = clearSynced(mergeOutbox(await this.diskOutbox(), this.outbox), path, snapshot)
      const blob = await encryptRecords(this.masterKey, path, merged)
      if (this.locked) return
      await this.putGuarded({ path, blob, sha: result.sha }, outbox)
      if (this.locked) return
      this.collections.set(path, merged)
      this.outbox = outbox
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
    const outbox = this.outbox
    await exclusive(this.db.name, 'lokaal', async () => {
      const merged = await this.mergeWithDisk(path, mine)
      const nextOutbox = mergeOutbox(await this.diskOutbox(), outbox)
      const blob = await encryptRecords(this.masterKey, path, merged)
      const stored = await getObject(this.db, path)
      await this.putGuarded({ path, blob, sha: stored?.sha ?? null }, nextOutbox)
      if (this.locked) return
      // Andere vensters en wijzigingen die tijdens het opslaan in het geheugen kwamen, allebei behouden.
      this.collections.set(path, mergeRecords(merged, this.collections.get(path) ?? []))
      this.outbox = mergeOutbox(nextOutbox, this.outbox)
    })
    if (this.locked) return
    this.savedAt = Date.now()
    this.broadcast(path)
    if (this.status.kind !== 'syncing') this.setStatus(this.idleStatus())
    else this.notify()
    this.scheduleSync()
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
        await setAsideIfVault(this.db, META_PATH, this.vaultCheck, path, stored.blob, `${SET_ASIDE_PREFIX}${path}/${new Date().toISOString()}`)
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

  /** Neemt wat een ander venster van dit bestand opsloeg over in het geheugen. */
  private async absorbDisk(path: CollectionPath): Promise<void> {
    if (this.frozen.has(path)) return
    const mine = this.collections.get(path) ?? []
    const merged = await this.mergeWithDisk(path, mine)
    if (this.locked) return
    const current = this.collections.get(path) ?? []
    if (sameRecords(merged, current)) return
    this.collections.set(path, mergeRecords(merged, current))
    this.outbox = mergeOutbox(await this.diskOutbox(), this.outbox)
    if (this.locked) return
    this.setStatus(this.status.kind === 'syncing' ? this.status : this.idleStatus())
  }

  private async absorbAll(): Promise<void> {
    for (const path of COLLECTION_PATHS) {
      if (this.locked) return
      await this.absorbDisk(path)
    }
    this.outbox = mergeOutbox(await this.diskOutbox(), this.outbox)
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
export function countDifferences(local: readonly SyncRecord[], remote: readonly SyncRecord[]): number {
  const byId = new Map(remote.map((r) => [r.id, stable(r)]))
  let n = 0
  for (const r of local) {
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
