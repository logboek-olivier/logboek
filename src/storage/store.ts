import { DecryptError, utf8 } from '../crypto/encrypt'
import { recordError } from '../errors'
import { META_PATH, parseMeta, serializeMeta, verifyMetaCheck, type Meta } from '../crypto/keys'
import { t } from '../i18n'
import { NewerSchemaError } from '../model/schema'
import { COLLECTION_PATHS, type CollectionPath, type Collections, type SyncRecord } from '../model/types'
import { AuthError, ConflictError, GithubError, NetworkError, type GithubClient, type GithubErrorCode, type RemoteFile } from './github'
import { getObject, putObject, type Db } from './idb'
import { clearSynced, loadOutbox, markPending, pendingCount, saveOutbox, type Outbox } from './outbox'
import { decryptRecords, encryptRecords, InvalidDataError, syncCollection } from './sync'


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
   * GitHub (repo leeg of opnieuw aangemaakt). In beide gevallen is er niets geschreven.
   */
  | { kind: 'error'; code: SyncErrorCode; count: number; github?: GithubErrorCode; paths?: CollectionPath[] }

export type SyncErrorCode = 'token' | 'update' | 'github' | 'failed' | 'unreadable' | 'otherKey' | 'noMeta'

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
      return t('sync.failed')
  }
}

type Listener = () => void
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
  /** Minstens één sync is in deze sessie zonder fouten afgerond (de lokale kopie is bijgewerkt). */
  private syncedOnce = false
  /** Bestanden die op GitHub onleesbaar waren bij de laatste sync, met de soort fout. */
  private unreadable = new Map<CollectionPath, string>()
  /** Uitkomst van de laatste meta-controle; herstellen mag alleen na een bevestigde 'match'. */
  private metaVerdict: MetaCheck = 'unknown'

  private constructor(
    private readonly db: Db,
    private readonly masterKey: CryptoKey,
    private readonly client: GithubClient,
  ) {}

  /** Laadt de lokale versleutelde kopie uit IndexedDB. Synchroniseert nog niet. */
  static async open(db: Db, masterKey: CryptoKey, client: GithubClient): Promise<Store> {
    const store = new Store(db, masterKey, client)
    for (const path of COLLECTION_PATHS) {
      const stored = await getObject(db, path)
      store.collections.set(path, stored ? await decryptRecords(masterKey, path, stored.blob) : [])
    }
    store.outbox = await loadOutbox(db, masterKey)
    store.status = store.idleStatus()
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

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
      await this.runSync()
    } while (this.syncAgain && !this.locked && this.status.kind !== 'offline' && this.status.kind !== 'error')
  }

  /** Wist alle ontsleutelde data uit het geheugen. De Store is daarna onbruikbaar. */
  lock(): void {
    this.locked = true
    this.collections.clear()
    this.outbox = {}
    this.listeners.clear()
  }

  private async runSync(): Promise<void> {
    const count = () => this.pendingCount()
    if (this.outdated) {
      this.setStatus({ kind: 'error', code: 'update', count: count() })
      return
    }
    this.setStatus({ kind: 'syncing' })
    let failure: unknown = null
    // Hoort logboek-data bij deze hoofdsleutel? Zo niet, dan niets schrijven: anders komen er bestanden onder
    // een andere sleutel naast de echte te staan, die de andere apparaten niet kunnen lezen.
    let meta: MetaCheck
    try {
      meta = await this.checkMeta()
      this.metaVerdict = meta
      if (meta === 'mismatch' || meta === 'missing') {
        this.unreadable = new Map()
        this.reportFailure(meta === 'missing' ? new MissingMetaError() : new OtherKeyError())
        return
      }
    } catch (error) {
      if (this.locked) return
      if (error instanceof NewerSchemaError) this.outdated = true
      this.reportFailure(error)
      return
    }
    // Leespas: alle bestanden ophalen en controleren vóór er iets geschreven wordt. Een bestand van een
    // nieuwere schemaversie (geschreven door een nieuwere app) betekent: niets naar GitHub schrijven.
    const prefetched = new Map<CollectionPath, RemoteFile | null>()
    const unreadable = new Map<CollectionPath, string>()
    let decryptFailures = 0
    let readable = 0
    for (const path of COLLECTION_PATHS) {
      if (this.locked) return
      try {
        const file = await this.client.getFile(path)
        if (file) {
          await decryptRecords(this.masterKey, path, file.content)
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
          if (error instanceof DecryptError) decryptFailures++
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
    // Eén onleesbaar of blijvend conflicterend bestand houdt de andere bestanden niet tegen;
    // zonder verbinding of met een ongeldige token stoppen we wel direct.
    for (const path of COLLECTION_PATHS) {
      if (this.locked) return
      if (!prefetched.has(path)) continue
      try {
        await this.syncPath(path, prefetched.get(path))
      } catch (error) {
        if (this.locked) return
        failure = error
        if (error instanceof NewerSchemaError) {
          this.outdated = true
          break
        }
        if (error instanceof NetworkError || error instanceof AuthError) break
      }
    }
    if (this.locked) return
    if (failure === null && unreadable.size > 0) failure = new UnreadableFileError([...unreadable.keys()], [...new Set(unreadable.values())].join(', '))
    if (failure === null) {
      this.syncedOnce = true
      this.setStatus(this.idleStatus())
      return
    }
    this.reportFailure(failure)
  }

  /**
   * Hoort meta.json.enc op GitHub bij deze hoofdsleutel? match: gebonden via het check-veld; mismatch: het check-veld
   * hoort bij een andere sleutel; missing: geen meta op GitHub terwijl dit apparaat een logboek heeft (repo leeg of
   * opnieuw aangemaakt); unknown: onleesbaar, een oudere meta zonder check-veld, of een apparaat zonder lokale meta.
   * De lokale meta zegt niets over de sleutel in het geheugen; alleen het check-veld telt.
   */
  private async checkMeta(): Promise<MetaCheck> {
    const remote = await this.client.getFile(META_PATH)
    if (!remote) return (await Store.loadMeta(this.db).catch(() => null)) ? 'missing' : 'unknown'
    let meta: Meta
    try {
      meta = parseMeta(new TextDecoder().decode(remote.content))
    } catch (error) {
      if (error instanceof NewerSchemaError) throw error
      return 'unknown'
    }
    if (await verifyMetaCheck(meta, this.masterKey)) return 'match'
    return meta.check ? 'mismatch' : 'unknown'
  }

  /**
   * Paden die te herstellen zijn: op GitHub niet te ontsleutelen (DecryptError), meta.json.enc bevestigd bij deze
   * sleutel, en hier een lokale kopie. Een bestand dat wel ontsleutelt maar ongeldig is, wordt nooit overschreven.
   */
  async repairable(): Promise<CollectionPath[]> {
    if (this.outdated || this.metaVerdict !== 'match') return []
    const result: CollectionPath[] = []
    for (const [path, reason] of this.unreadable) {
      if (reason === 'DecryptError' && (await getObject(this.db, path))) result.push(path)
    }
    return result
  }

  /**
   * Zet de lokale versie van een onleesbaar bestand opnieuw op GitHub. Alleen na een tik van Olivier, nooit
   * automatisch. De onleesbare versie blijft in de geschiedenis van logboek-data staan.
   */
  async repair(path: CollectionPath): Promise<void> {
    this.assertUnlocked()
    if (!(await this.repairable()).includes(path)) return
    for (let attempt = 0; attempt < 2; attempt++) {
      // Vlak voor het schrijven opnieuw kijken: misschien heeft een ander apparaat het bestand al hersteld.
      const remote = await this.client.getFile(path)
      if (remote) {
        try {
          await decryptRecords(this.masterKey, path, remote.content)
          break
        } catch (error) {
          if (error instanceof NewerSchemaError) {
            this.outdated = true
            throw error
          }
          if (!(error instanceof DecryptError)) throw error
        }
      }
      try {
        const records = this.collections.get(path) ?? []
        await this.client.putFile(path, await encryptRecords(this.masterKey, path, records), remote?.sha ?? null)
        break
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 1) throw error
      }
    }
    this.unreadable.delete(path)
    await this.sync()
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
    const snapshot = { ...(this.outbox[path] ?? {}) }
    const local = this.collections.get(path) ?? []
    const result = await syncCollection(this.client, this.masterKey, path, local, prefetched)
    if (this.locked) return
    // Wijzigingen tijdens het wachten blijven staan: samenvoegen met wat ondertussen lokaal is gezet.
    const during = (this.collections.get(path) ?? []).filter((r) => {
      const synced = result.records.find((s) => s.id === r.id)
      return !synced || r.updatedAt > synced.updatedAt
    })
    const merged = [...result.records.filter((s) => !during.some((d) => d.id === s.id)), ...during]
    this.collections.set(path, merged)
    this.outbox = clearSynced(this.outbox, path, snapshot)
    const outbox = this.outbox
    const blob = await encryptRecords(this.masterKey, path, merged)
    if (this.locked) return
    await putObject(this.db, { path, blob, sha: result.sha })
    if (this.locked) return
    await saveOutbox(this.db, this.masterKey, outbox)
  }

  private async persist(path: CollectionPath): Promise<void> {
    // Na vergrendelen niets meer schrijven: het geheugen is gewist en de outbox zou leeg worden opgeslagen.
    // lock() kan tijdens elke await komen, daarom na elke await opnieuw controleren.
    const records = this.collections.get(path) ?? []
    const outbox = this.outbox
    const blob = await encryptRecords(this.masterKey, path, records)
    const stored = await getObject(this.db, path)
    if (this.locked) return
    await putObject(this.db, { path, blob, sha: stored?.sha ?? null })
    if (this.locked) return
    await saveOutbox(this.db, this.masterKey, outbox)
    if (this.locked) return
    if (this.status.kind !== 'syncing') this.setStatus(this.idleStatus())
    else this.notify()
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
