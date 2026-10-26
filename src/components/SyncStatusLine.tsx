import { CircleCheck, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { describeStatus, type Store, type SyncStatus } from '../storage/store'
import { Icon } from './Icon'

export function useSyncStatus(store: Store) {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getStatus(),
  )
}

const ICONS = {
  synced: CircleCheck,
  syncing: LoaderCircle,
  pending: RefreshCw,
  offline: CloudOff,
  error: TriangleAlert,
} as const

export function SyncStatusLine({ store }: { store: Store }) {
  const status: SyncStatus = useSyncStatus(store)
  return (
    <p className={`sync-status sync-${status.kind}`} role="status">
      <Icon icon={ICONS[status.kind]} className={status.kind === 'syncing' ? 'spin' : ''} />
      <span>{describeStatus(status)}</span>
    </p>
  )
}
