import { utf8 } from '../crypto/encrypt'
import { META_PATH, parseMeta, serializeMeta, type Meta } from '../crypto/keys'
import { COLLECTION_PATHS, type CollectionPath, type Collections, type SyncRecord } from '../model/types'
import { AuthError, GithubError, NetworkError, type GithubClient } from './github'
import { getObject, putObject, type Db } from './idb'
import { clearSynced, loadOutbox, markPending, pendingCount, saveOutbox, type Outbox } from './outbox'
import { decryptRecords, encryptRecords, syncCollection } from './sync'

// Ontsleutelde data in het geheugen, alleen na ontgrendelen. Elke wijziging gaat direct versleuteld naar
// IndexedDB en in de outbox; sync gebeurt bij ontgrendelen en op verzoek. Vergrendelen = alles hier wissen.

export type SyncStatus =
  | { kind: 'synced' }
  | { kind: 'syncing' }
  | { kind: 'pending'; count: number }
  | { kind: 'offline'; count: number }
  | { kind: 'error'; message: string; count: number }

export function describeStatus(status: SyncStatus): string {
  switch (status.kind) {
    case 'synced':
      return 'Gesynct'
    case 'syncing':
      return 'Synchroniseren…'
    case 'pending':
      return status.count === 1 ? '1 wijziging wacht' : `${status.count} wijzigingen wachten`
    case 'offline':
      return 'Geen verbinding'
    case 'error':
      return status.message
  }
}

type Listener = () => void

export class Store {
  private readonly collections = new Map<CollectionPath, SyncRecord[]>()
  private readonly listeners = new Set<Listener>()
  private outbox: Outbox = {}
  private status: SyncStatus = { kind: 'synced' }
  private syncing: Promise<void> | null = null
  /** Er kwam een wijziging of een sync-verzoek binnen terwijl een sync liep: daarna nog een ronde. */
  private syncAgain = false
  private locked = false

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

  async put<P extends CollectionPath>(path: P, record: Collections[P]): Promise<void> {
    this.assertUnlocked()
    const records = (this.collections.get(path) ?? []).filter((r) => r.id !== record.id)
    records.push(record)
    this.collections.set(path, records)
    this.outbox = markPending(this.outbox, path, record.id, record.updatedAt)
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
    this.setStatus({ kind: 'syncing' })
    // Eén onleesbaar of blijvend conflicterend bestand houdt de andere bestanden niet tegen;
    // zonder verbinding of met een ongeldige token stoppen we wel direct.
    let failure: unknown = null
    for (const path of COLLECTION_PATHS) {
      if (this.locked) return
      try {
        await this.syncPath(path)
      } catch (error) {
        if (this.locked) return
        failure = error
        if (error instanceof NetworkError || error instanceof AuthError) break
      }
    }
    if (this.locked) return
    if (failure === null) {
      this.setStatus(this.idleStatus())
      return
    }
    const count = this.pendingCount()
    if (failure instanceof NetworkError) this.setStatus({ kind: 'offline', count })
    else if (failure instanceof AuthError) this.setStatus({ kind: 'error', message: 'Token ongeldig', count })
    else if (failure instanceof GithubError) this.setStatus({ kind: 'error', message: failure.message, count })
    else this.setStatus({ kind: 'error', message: 'Synchroniseren mislukt', count })
  }

  private async syncPath(path: CollectionPath): Promise<void> {
    const snapshot = { ...(this.outbox[path] ?? {}) }
    const local = this.collections.get(path) ?? []
    const result = await syncCollection(this.client, this.masterKey, path, local)
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
