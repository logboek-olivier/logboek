import { CircleCheck, CloudOff, CloudUpload, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { recordError } from '../errors'
import type { CollectionPath } from '../model/types'
import { describeStatus, type Store, type SyncStatus } from '../storage/store'
import { CopyErrorDetails } from './ErrorDetails'
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
    <>
      <StatusButton store={store} status={status} />
      {status.kind === 'error' && (status.code === 'unreadable' || status.code === 'otherKey') && <SyncProblem store={store} status={status} />}
    </>
  )
}

function StatusButton({ store, status }: { store: Store; status: SyncStatus }) {
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

/**
 * Uitleg bij een onleesbaar bestand of een andere sleutel. Herstellen (de lokale kopie opnieuw op GitHub zetten)
 * gebeurt alleen na een tik; zonder lokale kopie zegt de app dat eerlijk en wist hij niets.
 */
function SyncProblem({ store, status }: { store: Store; status: Extract<SyncStatus, { kind: 'error' }> }) {
  const [repairable, setRepairable] = useState<CollectionPath[] | null>(null)
  const [busy, setBusy] = useState<CollectionPath | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const paths = status.paths ?? []
  const key = paths.join(',')

  useEffect(() => {
    let live = true
    void store.repairable().then((list) => {
      if (live) setRepairable(list)
    })
    return () => {
      live = false
    }
  }, [store, key])

  async function repair(path: CollectionPath) {
    setBusy(path)
    setMessage(null)
    try {
      await store.repair(path)
      setMessage(t('sync.repaired'))
    } catch (error) {
      recordError(error)
      setMessage(t('sync.repairFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="notice sync-problem" role="alert">
      {status.code === 'otherKey' ? (
        <p>{t('sync.otherKeyHint')}</p>
      ) : (
        paths.map((path) =>
          repairable?.includes(path) ? (
            <div key={path} className="stack-sm">
              <p>{t('sync.repairHint', { path })}</p>
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => void repair(path)}>
                <Icon icon={CloudUpload} />
                {t('sync.repair')}
              </button>
            </div>
          ) : repairable ? (
            <p key={path}>{t('sync.noLocalCopy', { path })}</p>
          ) : null,
        )
      )}
      {message && <p className="small">{message}</p>}
      <CopyErrorDetails />
    </div>
  )
}
