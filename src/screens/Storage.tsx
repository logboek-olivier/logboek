import { CircleCheck, CloudOff, Download, FileSearch, FileWarning, ShieldCheck, TriangleAlert, Upload, Wrench } from 'lucide-react'
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { CopyErrorDetails } from '../components/ErrorDetails'
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
import { ExportSection } from '../components/ExportSection'
import { applyRestore, backupFileName, openBackup, readBackupMeta, restorePlan, type OpenedBackup, type RestoreItem } from '../storage/backup'
import type { FileEvidence, Verdict, VersionEvidence } from '../storage/evidence'
import { checkHasProblem, type FileCheck, type FileState } from '../storage/storage-log'
import { deviceId } from '../storage/device'
import { describeStatus, type RepairResult, type Store } from '../storage/store'
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
  'weekreviews.json.enc': 'storage.file.weekreviews',
  'goals.json.enc': 'storage.file.goals',
  'skills.json.enc': 'storage.file.skills',
  'sessions.json.enc': 'storage.file.sessions',
  'documents/index.json.enc': 'storage.file.documents',
  'career.json.enc': 'storage.file.career',
  'accounts.json.enc': 'storage.file.accounts',
  'balances.json.enc': 'storage.file.balances',
  'fixedcosts.json.enc': 'storage.file.fixedcosts',
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
  // Wat de laatste sync op GitHub onleesbaar vond, ook als de ronde om een andere reden stopte (dan blijft "Alles
  // herstellen" staan).
  const unreadableNow = status.kind === 'demo' ? [] : store.unreadableFiles().map((f) => f.path)

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

  const [repairing, setRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<RepairResult[] | null>(null)

  async function repairAll() {
    setRepairing(true)
    setRepairResult(null)
    try {
      setRepairResult(await store.repairAll())
    } catch (error) {
      recordError(error)
      setFailed(true)
    } finally {
      setRepairing(false)
    }
  }

  async function fetchEvidence() {
    setBusy(true)
    try {
      await store.gatherEvidence()
    } catch (error) {
      recordError(error)
    } finally {
      setBusy(false)
    }
  }

  const evidence = new Map<CollectionPath, FileEvidence>((log.evidence ?? []).map((e) => [e.path, e]))
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
                    {/* Hier en op GitHub van hetzelfde moment: de laatste controle; zonder controle alleen hier. */}
                    {t('storage.counts', { here: formatNumber(file ? file.local : store.localCount(path)), github: file?.remote != null ? formatNumber(file.remote) : '–' })}
                    {' · '}
                    {synced ? t('storage.syncedAt', { when: formatMoment(synced) }) : t('storage.notSynced')}
                  </span>
                  {file?.writer && <span className="muted small storage-writer">{writerLine(file.writer)}</span>}
                  {state === 'onleesbaar' && evidence.has(path) && <EvidenceList evidence={evidence.get(path)!} />}
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
        {unreadableNow.length > 0 && (
          <div className="stack storage-repair">
            <p className="muted small">{t('storage.repairAllHint')}</p>
            <button type="button" className="btn primary" disabled={repairing || busy} onClick={() => void repairAll()}>
              <Icon icon={Wrench} />
              {repairing ? t('storage.repairing') : t('storage.repairAll')}
            </button>
            <button type="button" className="btn link" disabled={busy || repairing} onClick={() => void fetchEvidence()}>
              <Icon icon={FileSearch} />
              {t('storage.evidenceFetch')}
            </button>
            <CopyErrorDetails />
          </div>
        )}
        {repairResult && (
          <p className={`notice storage-repaired${repairResult.every((r) => r.ok) ? '' : ' storage-problem'}`} role="status">
            <Icon icon={repairResult.every((r) => r.ok) ? CircleCheck : TriangleAlert} />
            {repairResult.length === 0
              ? t('storage.repairNothing')
              : repairResult.every((r) => r.ok)
                ? t('storage.repairAllDone', { n: repairResult.length })
                : t('storage.repairAllPartial', { paths: repairResult.filter((r) => !r.ok).map((r) => t(FILE_NAME[r.path])).join(', ') })}
          </p>
        )}
        {repairResult
          ?.filter((r) => r.overwrittenBy)
          .map((r) => (
            <p key={r.path} className="muted small storage-overwritten">
              {t('storage.repairOverwritten', { file: t(FILE_NAME[r.path]), who: writerLine(r.overwrittenBy!) })}
            </p>
          ))}
        <button type="button" className={`btn${unreadableNow.length > 0 ? '' : ' primary'}`} disabled={busy || repairing} onClick={() => void runCheck()}>
          <Icon icon={ShieldCheck} />
          {busy ? t('storage.checking') : t('storage.checkNow')}
        </button>
        <p className="muted small">{t('storage.weekly')}</p>
        <p className="muted small">{t('storage.thisDevice', { id: deviceId() })}</p>
      </div>

      <Backup store={store} notify={notify} />
      <ExportSection store={store} />
    </section>
  )
}

/** "Laatst geschreven door dit apparaat · v1.0.0+6d71ec9"; oudere commitberichten noemen geen versie of apparaat. */
function writerLine(writer: NonNullable<FileCheck['writer']>): string {
  if (!writer.version && !writer.device) return t('storage.writerOld')
  const who = writer.device === null ? t('storage.writerUnknownDevice') : writer.device === deviceId() ? t('storage.writerThisDevice') : t('storage.writerOtherDevice', { id: writer.device })
  return t('storage.writer', { who, version: writer.version ?? '?' })
}

const VERDICT_LABEL: Record<string, MessageKey> = {
  leesbaar: 'storage.verdict.readable',
  leeg: 'storage.verdict.empty',
  formaat: 'storage.verdict.format',
  sleutel: 'storage.verdict.key',
  nieuwer: 'storage.verdict.newer',
  weg: 'storage.verdict.gone',
  integriteit: 'storage.verdict.integrity',
}

function verdictLabel(verdict: Verdict): string {
  if (verdict.startsWith('ander-pad:')) {
    const other = COLLECTION_PATHS.find((p) => p === verdict.slice('ander-pad:'.length))
    return t('storage.verdict.otherPath', { file: other ? t(FILE_NAME[other]) : verdict.slice('ander-pad:'.length) })
  }
  if (verdict.startsWith('ongeldig:')) return t('storage.verdict.invalid', { why: verdict.slice('ongeldig:'.length) })
  return t(VERDICT_LABEL[verdict] ?? 'storage.verdict.unknown')
}

/**
 * Het bewijs van één onleesbaar bestand: de versie op GitHub en de laatste commits, met tijd, versie, apparaat,
 * blob-sha, grootte, eerste byte en wat de app ermee kan. Geen inhoud.
 */
function EvidenceList({ evidence }: { evidence: FileEvidence }) {
  const line = (v: VersionEvidence) => {
    const who = v.device === null ? null : v.device === deviceId() ? t('storage.writerThisDevice') : t('storage.writerOtherDevice', { id: v.device })
    return [
      v.commit ? (v.at ? formatMoment(v.at) : v.commit) : t('storage.evidenceNow'),
      v.version ? `v${v.version}` : null,
      who,
      v.blob ? `blob ${v.blob}` : null,
      v.size !== null ? `${formatNumber(v.size)} B` : null,
      v.firstByte !== null ? t('storage.evidenceByte', { n: v.firstByte }) : null,
      verdictLabel(v.verdict),
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return (
    <span className="storage-evidence small">
      <span className="muted small">{t('storage.evidence', { when: formatMoment(evidence.at) })}</span>
      <ul>
        {evidence.current && <li>{line(evidence.current)}</li>}
        {evidence.commits.map((c, i) => (
          <li key={`${c.commit}-${i}`}>{line(c)}</li>
        ))}
      </ul>
    </span>
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
