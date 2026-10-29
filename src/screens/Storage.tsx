import { CircleCheck, CloudOff, Download, FileWarning, ShieldCheck, TriangleAlert, Upload } from 'lucide-react'
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { useSyncStatus } from '../components/SyncStatusLine'
import { RECOVERY_WORD_COUNT } from '../crypto/recovery'
import { loadWordlist } from '../crypto/recovery'
import { recordError } from '../errors'
import { formatMoment, formatNumber } from '../format'
import { t, type MessageKey } from '../i18n'
import { COLLECTION_PATHS, todayIso, type CollectionPath } from '../model/types'
import { describeError } from '../session'
import { shareOrDownload } from '../share'
import { applyRestore, backupFileName, openBackup, readBackupMeta, restorePlan, type OpenedBackup, type RestoreItem } from '../storage/backup'
import { checkHasProblem, type FileCheck, type FileState } from '../storage/storage-log'
import { describeStatus, type Store } from '../storage/store'
import { ErrorLine } from './Setup'

// Meer → Opslag: per bestand de laatste sync, het aantal records hier en op GitHub en of het leesbaar is; "Controleer
// nu" haalt alles opnieuw van GitHub, ontsleutelt het en vergelijkt het met deze telefoon (vanzelf één keer per week).
// Daaronder de back-up zonder laptop: één versleuteld bestand downloaden of delen, en terugzetten met een voorbeeld.

export const FILE_NAME: Record<CollectionPath, MessageKey> = {
  'trips.json.enc': 'storage.file.trips',
  'legs.json.enc': 'storage.file.legs',
  'transactions.json.enc': 'storage.file.transactions',
  'settings.json.enc': 'storage.file.settings',
  'curricula.json.enc': 'storage.file.curricula',
  'students.json.enc': 'storage.file.students',
  'plans.json.enc': 'storage.file.plans',
  'places.json.enc': 'storage.file.places',
  'reminders.json.enc': 'storage.file.reminders',
  'checklists.json.enc': 'storage.file.checklists',
  'calendar.json.enc': 'storage.file.calendar',
}

const STATE_LABEL: Record<FileState, MessageKey> = {
  gelijk: 'storage.state.same',
  verschil: 'storage.state.different',
  onleesbaar: 'storage.state.unreadable',
  ontbreekt: 'storage.state.missing',
  leeg: 'storage.state.empty',
  wacht: 'storage.state.waiting',
}

function useStorageLog(store: Store) {
  // De Store meldt een nieuwe controle via subscribe; het logboek zelf staat in localStorage.
  const version = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => JSON.stringify(store.storageLog()),
  )
  return JSON.parse(version) as ReturnType<Store['storageLog']>
}

export function Storage({ store, notify }: { store: Store; notify: Notify }) {
  const status = useSyncStatus(store)
  const log = useStorageLog(store)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const check = log.check
  const unreadableNow = status.kind === 'error' && status.code === 'unreadable' ? (status.paths ?? []) : []

  async function runCheck() {
    setBusy(true)
    setFailed(false)
    try {
      const result = await store.check()
      if (!result) setFailed(true)
    } catch (error) {
      recordError(error)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const byPath = new Map<CollectionPath, FileCheck>((check?.files ?? []).map((f) => [f.path, f]))
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.storage')}</h1>
      </header>

      <div className="section stack">
        <h2>{t('storage.files')}</h2>
        {check && !checkHasProblem(check) && (
          <p className="notice storage-ok" role="status">
            <Icon icon={ShieldCheck} />
            {t('storage.allGood', { when: formatMoment(check.at) })}
          </p>
        )}
        {check && checkHasProblem(check) && (
          <p className="notice storage-problem" role="alert">
            <Icon icon={TriangleAlert} />
            {check.metaOk ? t('storage.problem', { when: formatMoment(check.at) }) : t('storage.metaProblem')}
          </p>
        )}
        {!check && <p className="muted">{t('storage.never')}</p>}
        {failed && (
          <p className="notice" role="status">
            <Icon icon={CloudOff} />
            {t('storage.cannotCheck', { reason: describeStatus(status) })}
          </p>
        )}
        <ul className="rows storage-files">
          {COLLECTION_PATHS.map((path) => {
            const file = byPath.get(path)
            const state: FileState | null = unreadableNow.includes(path) ? 'onleesbaar' : (file?.state ?? null)
            const synced = log.synced[path]
            const good = state === 'gelijk' || state === 'leeg' || state === 'wacht'
            return (
              <li key={path} className="row-item storage-file">
                <span className="row-main">
                  <span>{t(FILE_NAME[path])}</span>
                  <span className="muted small">
                    {t('storage.counts', { here: formatNumber(store.localCount(path)), github: file?.remote != null ? formatNumber(file.remote) : '–' })}
                    {' · '}
                    {synced ? t('storage.syncedAt', { when: formatMoment(synced) }) : t('storage.notSynced')}
                  </span>
                </span>
                {state && (
                  <span className={`storage-state${good ? ' good' : ' bad'}`}>
                    <Icon icon={good ? CircleCheck : FileWarning} />
                    {state === 'verschil' ? t('storage.state.differentN', { n: file?.differences ?? 0 }) : t(STATE_LABEL[state])}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void runCheck()}>
          <Icon icon={ShieldCheck} />
          {busy ? t('storage.checking') : t('storage.checkNow')}
        </button>
        <p className="muted small">{t('storage.weekly')}</p>
      </div>

      <Backup store={store} notify={notify} />
    </section>
  )
}

function Backup({ store, notify }: { store: Store; notify: Notify }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const content = await store.exportBackup()
      const file = new File([content], backupFileName(todayIso()), { type: 'text/plain' })
      await shareOrDownload(file, t('backup.title'))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function chosen(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const content = await file.text()
      readBackupMeta(content)
      setText(content)
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <div className="section stack">
      <h2>{t('backup.title')}</h2>
      <p className="muted">{t('backup.downloadHint')}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
        <Icon icon={Download} />
        {t('backup.download')}
      </button>
      <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
        <Icon icon={Upload} />
        {t('backup.restore')}
      </button>
      {/* Geen accept-filter: Android en Google Drive grijzen anders bestanden uit. */}
      <input
        ref={fileInput}
        type="file"
        hidden
        aria-label={t('backup.choose')}
        onChange={(e) => {
          void chosen(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <ErrorLine error={error} />
      {text && (
        <RestoreBackup
          store={store}
          text={text}
          notify={notify}
          onClose={() => {
            setText(null)
          }}
        />
      )}
    </div>
  )
}

/** Wachtzin of herstelcode van toen, dan het voorbeeld, dan één tik op "Terugzetten" (met ongedaan maken). */
function RestoreBackup({ store, text, notify, onClose }: { store: Store; text: string; notify: Notify; onClose: () => void }) {
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<OpenedBackup | null>(null)
  const [plan, setPlan] = useState<RestoreItem[] | null>(null)

  async function open(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const backup = await openBackup(text, mode === 'passphrase' ? { passphrase: secret } : { recoveryCode: secret, wordlist: await loadWordlist() })
      setSecret('')
      setOpened(backup)
      setPlan(restorePlan(store, backup))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!plan || busy) return
    setBusy(true)
    setError(null)
    try {
      const undo = await applyRestore(store, plan)
      notify(t('backup.done'), undo)
      onClose()
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }

  if (opened && plan) {
    const total = plan.reduce((n, item) => n + item.back.length, 0)
    return (
      <div className="stack backup-preview">
        <h3>{t('backup.preview', { when: formatMoment(opened.createdAt) })}</h3>
        <ul className="rows">
          {plan.map((item) => (
            <li key={item.path} className="row-item">
              <span className="row-main">{t(FILE_NAME[item.path])}</span>
              <span className="muted small num">{t('backup.previewLine', { back: formatNumber(item.back.length), inBackup: formatNumber(item.inBackup) })}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">{total === 0 ? t('backup.nothing') : t('backup.explain')}</p>
        {total > 0 && !store.hasSynced() && <p className="notice">{t('backup.syncFirst')}</p>}
        <ErrorLine error={error} />
        {total > 0 && (
          <button type="button" className="btn primary" disabled={busy || !store.hasSynced()} onClick={() => void apply()}>
            {t('backup.apply', { n: total })}
          </button>
        )}
        <button type="button" className="btn link" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  return (
    <form className="stack" onSubmit={(e) => void open(e)}>
      <p>{t('backup.secretHint')}</p>
      {mode === 'passphrase' ? (
        <label>
          {t('passphrase.label')}
          <input type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
      ) : (
        <label>
          {t('setup.recoveryField', { n: RECOVERY_WORD_COUNT })}
          <textarea rows={4} autoComplete="off" autoCapitalize="none" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
      )}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={busy || secret.trim().length === 0}>
        {t('backup.open')}
      </button>
      <button
        className="btn link"
        type="button"
        onClick={() => {
          setMode(mode === 'passphrase' ? 'recovery' : 'passphrase')
          setSecret('')
        }}
      >
        {mode === 'passphrase' ? t('setup.useRecovery') : t('setup.usePassphrase')}
      </button>
      <button type="button" className="btn link" onClick={onClose}>
        {t('common.cancel')}
      </button>
    </form>
  )
}
