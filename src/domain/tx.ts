import type { Bytes } from '../crypto/encrypt'
import type { CollectionPath, Collections, SyncRecord } from '../model/types'
import type { Store, WriteEntries, WriteHandle } from '../storage/store'

// De transactie van een opdracht (docs/FUNDERING.md). Modelcode leest en schrijft hierin; pas `commit`
// (src/domain/commit.ts) legt alles in één keer vast. Lezen ziet de eigen, nog niet vastgelegde wijzigingen al.

/** Wat lezende modelcode nodig heeft: de Store en een transactie bieden allebei dit. */
export interface Reader {
  /** Alle records, ook verwijderde (tombstones). */
  get<P extends CollectionPath>(path: P): readonly Collections[P][]
  /** Alle niet-verwijderde records. */
  list<P extends CollectionPath>(path: P): Collections[P][]
}

export class Tx implements Reader {
  private readonly writes = new Map<CollectionPath, Map<string, SyncRecord>>()
  private readonly afterwards: Array<() => Promise<void>> = []
  private readonly handle: WriteHandle

  constructor(
    private readonly store: Store,
    /** Eén tijd voor de hele opdracht. */
    readonly now: string,
  ) {
    // Alleen zolang de app ontgrendeld is; een begonnen opdracht wordt afgemaakt (Store.beginWrite).
    this.handle = store.beginWrite()
  }

  /** Wat er nu vastligt, zonder de wijzigingen van deze transactie. */
  base<P extends CollectionPath>(path: P): readonly Collections[P][] {
    return this.handle.read(path)
  }

  get<P extends CollectionPath>(path: P): readonly Collections[P][] {
    const base = this.handle.read(path)
    const mine = this.writes.get(path)
    if (!mine) return base
    return [...base.filter((r) => !mine.has(r.id)), ...mine.values()] as Collections[P][]
  }

  list<P extends CollectionPath>(path: P): Collections[P][] {
    return this.get(path).filter((r) => r.deletedAt === null)
  }

  async put<P extends CollectionPath>(path: P, record: Collections[P]): Promise<void> {
    await this.putMany(path, [record])
  }

  async putMany<P extends CollectionPath>(path: P, records: readonly Collections[P][]): Promise<void> {
    if (records.length === 0) return
    const mine = this.writes.get(path) ?? new Map<string, SyncRecord>()
    for (const r of records) mine.set(r.id, r)
    this.writes.set(path, mine)
  }

  /** Een record verwijderen (tombstone); de inhoud blijft staan. */
  async remove<P extends CollectionPath>(path: P, id: string): Promise<void> {
    const current = this.get(path).find((r) => r.id === id)
    if (!current || current.deletedAt !== null) return
    await this.put(path, { ...current, updatedAt: this.now, deletedAt: this.now })
  }

  /** Is er in deze sessie al een keer gesynct? (Automatische opdrachten wachten daarop.) */
  hasSynced(): boolean {
    return this.store.hasSynced()
  }

  /** Bestanden die nu niet te gebruiken zijn (onleesbaar, apart gezet of van een nieuwere versie). */
  unusable(): CollectionPath[] {
    return [...this.store.unreadableFiles().map((u) => u.path), ...this.store.setAside(), ...this.store.frozenPaths()]
  }

  /** Een documentbestand versleuteld op het apparaat zetten (vóór de index die ernaar wijst). */
  putDocumentFile(fileId: string, bytes: Bytes): Promise<void> {
    return this.store.putDocumentFile(fileId, bytes)
  }

  /** Na het vastleggen: de versleutelde kopie van een documentbestand op het apparaat houden of niet. */
  setDocumentOffline(fileId: string, offline: boolean): void {
    this.afterwards.push(() => this.store.setDocumentOffline(fileId, offline))
  }

  /** Alleen voor `commit`: wat deze transactie wil schrijven, per bestand. */
  entries(): Array<{ path: CollectionPath; records: SyncRecord[] }> {
    return [...this.writes.entries()].map(([path, records]) => ({ path, records: [...records.values()] }))
  }

  /** Alleen voor `commit`: alles in één keer vastleggen; geeft de vastgelegde versies terug. */
  write(entries: WriteEntries): Promise<Array<{ path: CollectionPath; records: SyncRecord[] }>> {
    return this.handle.write(entries)
  }

  /** Alleen voor `commit`: wat na het vastleggen moet gebeuren. */
  followUps(): Array<() => Promise<void>> {
    return [...this.afterwards]
  }
}
