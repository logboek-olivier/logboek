import { useSyncExternalStore } from 'react'
import { describeStatus, type Store } from '../storage/store'

export function useSyncStatus(store: Store) {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getStatus(),
  )
}

export function SyncStatusLine({ store }: { store: Store }) {
  const status = useSyncStatus(store)
  return (
    <p className={`sync-status sync-${status.kind}`} role="status">
      {describeStatus(status)}
    </p>
  )
}
