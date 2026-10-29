import { CircleCheck, CloudOff, CloudUpload, LoaderCircle, RefreshCw, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { checkHasProblem } from '../storage/storage-log'
import { recordError } from '../errors'
import type { CollectionPath } from '../model/types'
import { describeStatus, type RepairOption, type Store, type SyncStatus } from '../storage/store'
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

/**
 * Sync-status bovenaan; tikken synchroniseert (handmatig verversen). `files`: de databestanden van het huidige scherm.
 * Een onleesbaar bestand blokkeert alleen zijn eigen onderdeel: de melding met de herstelknop staat alleen op de
 * schermen van dat bestand; de status bovenaan noemt het pad overal.
 */
export function SyncStatusLine({ store, files, onStorage }: { store: Store; files?: readonly CollectionPath[]; onStorage?: () => void }) {
  const status: SyncStatus = useSyncStatus(store)
  const here = status.kind === 'error' && status.code === 'unreadable' ? (status.paths ?? []).filter((p) => !files || files.includes(p)) : []
  const check = store.storageLog().check
  return (
    <>
      <StatusButton store={store} status={status} />
      {onStorage && check && checkHasProblem(check) && (
        <div className="notice sync-problem" role="alert">
          <p>
            <Icon icon={ShieldAlert} />
            {t('storage.problemNotice')}
          </p>
          <button type="button" className="btn small" onClick={onStorage}>
            {t('storage.open')}
          </button>
        </div>
      )}
      {status.kind === 'error' && status.code === 'unreadable' && here.length > 0 && <SyncProblem store={store} status={{ ...status, paths: here }} />}
      {status.kind === 'error' && (status.code === 'otherKey' || status.code === 'noMeta') && <SyncProblem store={store} status={status} />}
      {store.setAside().some((p) => !files || files.includes(p)) && (
        <div className="notice sync-problem" role="status">
          <p>{t('sync.setAsideHint', { path: store.setAside().filter((p) => !files || files.includes(p)).join(', ') })}</p>
        </div>
      )}
      {status.kind === 'error' && status.code === 'update' && (status.paths ?? []).length > 0 && (
        <div className="notice sync-problem" role="alert">
          <p>{t('sync.updateHint')}</p>
          <button type="button" className="btn small" onClick={() => window.location.reload()}>
            <Icon icon={RotateCcw} />
            {t('update.reload')}
          </button>
        </div>
      )}
    </>
  )
}

function StatusButton({ store, status }: { store: Store; status: SyncStatus }) {
  // Na een opslag eerst "Opgeslagen" (op deze telefoon), daarna "Gesynct" zodra de sync klaar is.
  const { saved: savedSeq, synced } = store.saveState()
  const saved = savedSeq > synced && (status.kind === 'syncing' || status.kind === 'pending' || status.kind === 'offline')
  return (
    <button
      type="button"
      className={`sync-status sync-${status.kind}`}
      aria-label={`${describeStatus(status)} · ${t('sync.now')}`}
      // "Werk de app bij": herladen haalt de nieuwste versie op (de app-pagina komt altijd van het netwerk).
      onClick={() => (status.kind === 'error' && status.code === 'update' ? window.location.reload() : void store.sync())}
      disabled={status.kind === 'syncing'}
    >
      <Icon icon={ICONS[status.kind]} className={status.kind === 'syncing' ? 'spin' : ''} />
      {saved && (
        <span className="saved-here">
          {t('sync.saved')}
          {' · '}
        </span>
      )}
      <span role="status">{describeStatus(status)}</span>
    </button>
  )
}

/**
 * Uitleg bij een onleesbaar bestand of een andere sleutel. Herstellen (de lokale kopie opnieuw op GitHub zetten) of
 * leegmaken en opnieuw beginnen gebeurt alleen na een tik; de rest van de app werkt intussen gewoon.
 */
function SyncProblem({ store, status }: { store: Store; status: Extract<SyncStatus, { kind: 'error' }> }) {
  const [options, setOptions] = useState<RepairOption[] | null>(null)
  const [busy, setBusy] = useState<CollectionPath | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const paths = status.paths ?? []
  const key = paths.join(',')

  useEffect(() => {
    let live = true
    void store.repairOptions().then((list) => {
      if (live) setOptions(list)
    })
    return () => {
      live = false
    }
  }, [store, key])

  async function run(option: RepairOption) {
    setBusy(option.path)
    setMessage(null)
    try {
      if (option.action === 'repair') await store.repair(option.path)
      else await store.resetFile(option.path)
      setMessage(t(option.action === 'repair' ? 'sync.repaired' : 'sync.resetDone'))
    } catch (error) {
      recordError(error)
      setMessage(t('sync.repairFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="notice sync-problem" role="alert">
      {status.code === 'otherKey' || status.code === 'noMeta' ? (
        <p>{t(status.code === 'otherKey' ? 'sync.otherKeyHint' : 'sync.noMetaHint')}</p>
      ) : (
        paths.map((path) => {
          const option = options?.find((o) => o.path === path)
          if (!option) return options ? <p key={path}>{t('sync.unreadableHint', { path })}</p> : null
          return (
            <div key={path} className="stack-sm">
              <p>{t(option.action === 'repair' ? 'sync.repairHint' : 'sync.resetHint', { path })}</p>
              <button type="button" className={`btn small${option.action === 'reset' ? ' danger' : ''}`} disabled={busy !== null} onClick={() => void run(option)}>
                <Icon icon={option.action === 'repair' ? CloudUpload : RotateCcw} />
                {t(option.action === 'repair' ? 'sync.repair' : 'sync.reset')}
              </button>
            </div>
          )
        })
      )}
      {message && <p className="small">{message}</p>}
      <CopyErrorDetails />
    </div>
  )
}
