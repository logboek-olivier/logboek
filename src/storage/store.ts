import { utf8 } from '../crypto/encrypt'
import { META_PATH, parseMeta, serializeMeta, type Meta } from '../crypto/keys'
import { COLLECTION_PATHS, type CollectionPath, type Collections, type SyncRecord } from '../model/types'
import { AuthError, NetworkError, type GithubClient } from './github'
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

  /** Synchroniseert alle bestanden. Loopt er al een sync, dan wordt die afgewacht. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing
    this.syncing = this.runSync().finally(() => {
      this.syncing = null
    })
    return this.syncing
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
    try {
      for (const path of COLLECTION_PATHS) {
        if (this.locked) return
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
        await putObject(this.db, { path, blob: await encryptRecords(this.masterKey, path, merged), sha: result.sha })
        await saveOutbox(this.db, this.masterKey, this.outbox)
      }
      this.setStatus(this.idleStatus())
    } catch (error) {
      if (this.locked) return
      const count = this.pendingCount()
      if (error instanceof NetworkError) this.setStatus({ kind: 'offline', count })
      else if (error instanceof AuthError) this.setStatus({ kind: 'error', message: 'Token ongeldig', count })
      else this.setStatus({ kind: 'error', message: 'Synchroniseren mislukt', count })
    }
  }

  private async persist(path: CollectionPath): Promise<void> {
    const records = this.collections.get(path) ?? []
    const stored = await getObject(this.db, path)
    await putObject(this.db, {
      path,
      blob: await encryptRecords(this.masterKey, path, records),
      sha: stored?.sha ?? null,
    })
    await saveOutbox(this.db, this.masterKey, this.outbox)
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
