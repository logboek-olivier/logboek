import { useSyncExternalStore } from 'react'
import type { CollectionPath, Collections } from '../model/types'
import type { Store } from '../storage/store'

/** Alle records (ook tombstones) van een bestand; rendert opnieuw bij elke wijziging in de Store. */
export function useCollection<P extends CollectionPath>(store: Store, path: P): readonly Collections[P][] {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(path),
  )
}
