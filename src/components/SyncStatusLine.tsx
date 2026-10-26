import { CircleCheck, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { describeStatus, type Store, type SyncStatus } from '../storage/store'
import { Icon } from './Icon'
import { t } from '../i18n'

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

/** Sync-status bovenaan; tikken synchroniseert (handmatig verversen). */
export function SyncStatusLine({ store }: { store: Store }) {
  const status: SyncStatus = useSyncStatus(store)
  return (
    <button
      type="button"
      className={`sync-status sync-${status.kind}`}
      aria-label={`${describeStatus(status)} · ${t('sync.now')}`}
      onClick={() => void store.sync()}
      disabled={status.kind === 'syncing'}
    >
      <Icon icon={ICONS[status.kind]} className={status.kind === 'syncing' ? 'spin' : ''} />
      <span role="status">{describeStatus(status)}</span>
    </button>
  )
}
