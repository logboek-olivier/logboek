import { useEffect, useState, type FormEvent } from 'react'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { t, type MessageKey } from '../i18n'
import type { CollectionPath } from '../model/types'
import { RECOVERY_WORD_COUNT } from '../crypto/recovery'
import type { RepairReport } from '../repair'
import { describeError, SetupError, useSession } from '../session'
import { AuthError } from '../storage/github'
import { ErrorLine, Screen } from './Setup'

// Sleutel past niet bij het logboek (fase 'mismatch'), of gegevens die niet met de sleutel uit meta.json.enc te lezen
// zijn (fase 'repair'). Nooit stil verder: niets geschreven, niets gewist zonder tik en wachtzin.

export function KeyMismatch({ where, metaRestorable = false }: { where: 'local' | 'remote'; metaRestorable?: boolean }) {
  const session = useSession()
  const [copies, setCopies] = useState<CollectionPath[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Alleen bij een ander logboek op GitHub: de lijst van wat er bij opnieuw koppelen verloren gaat.
  useEffect(() => {
    if (where !== 'remote') return
    let active = true
    void session.localCopies().then((list) => active && setCopies(list), () => active && setCopies([]))
    return () => {
      active = false
    }
  }, [session, where])

  async function relink() {
    setBusy(true)
    setError(null)
    try {
      await session.relink()
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }

  return (
    <Screen title={t(metaRestorable ? 'key.metaRestoreTitle' : 'key.mismatchTitle')}>
      {metaRestorable ? (
        <RestoreMeta />
      ) : (
        <>
          <p>{t('key.mismatchText')}</p>
          <p className="muted">{t(where === 'remote' ? 'key.mismatchRemote' : 'key.mismatchNext')}</p>
          <button className="btn primary" onClick={() => void session.backToUnlock()}>
            {t('key.unlockAgain')}
          </button>
        </>
      )}
      {/* Wissen en opnieuw koppelen alleen bij een ander logboek op GitHub. Bij een ontbrekende of kapotte meta is
          terugzetten de uitweg: wissen zou de laatste kopie van de versleutelde hoofdsleutel weggooien, en daarna
          lukt koppelen niet (geen geldige meta op GitHub). */}
      {where === 'remote' && !metaRestorable && copies !== null && (
        <div className="section">
          <h2>{t('key.relinkLost')}</h2>
          {copies.length > 0 ? (
            <ul className="rows loss-list">
              {copies.map((path) => (
                <li key={path} className="row-item">
                  <span className="row-main">
                    <span>{t(FILE_LABEL[path])}</span>
                    <span className="muted small">{path} · {t('key.lostFile')}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t('key.relinkNothing')}</p>
          )}
          <button className="btn danger" disabled={busy} onClick={() => void relink()}>
            {t('key.relink')}
          </button>
          <ErrorLine error={error} />
        </div>
      )}
      <CopyErrorDetails />
    </Screen>
  )
}

/**
 * meta.json.enc op GitHub ontbreekt of is kapot (geen ander logboek): met de wachtzin zet dit apparaat zijn eigen meta
 * terug, en de sync daarna de rest. Er gaat niets verloren; zonder tik wordt niets geschreven.
 */
function RestoreMeta() {
  const session = useSession()
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [tokenNeeded, setTokenNeeded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await session.restoreRemoteMeta(mode === 'passphrase' ? { passphrase: secret } : { recoveryCode: secret }, tokenNeeded ? token : undefined)
    } catch (err) {
      // De token op dit apparaat ontbreekt of is onleesbaar: alleen Olivier kan een nieuwe geven.
      if ((err instanceof SetupError && err.key === 'error.tokenRequired') || err instanceof AuthError) setTokenNeeded(true)
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <p>{t('key.metaRestoreText')}</p>
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
      {tokenNeeded && (
        <label>
          {t('token.label')}
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          <span className="muted small">{t('repair.tokenHint')}</span>
        </label>
      )}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={busy || secret.trim().length === 0 || (tokenNeeded && token.trim().length === 0)}>
        {t('key.metaRestore')}
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
      <button className="btn link" type="button" onClick={() => void session.backToUnlock()}>
        {t('key.unlockAgain')}
      </button>
    </form>
  )
}

const FILE_LABEL: Record<CollectionPath, MessageKey> = {
  'trips.json.enc': 'key.file.trips',
  'legs.json.enc': 'key.file.legs',
  'transactions.json.enc': 'key.file.transactions',
  'settings.json.enc': 'key.file.settings',
  'curricula.json.enc': 'key.file.curricula',
  'students.json.enc': 'key.file.students',
  'plans.json.enc': 'key.file.plans',
  'places.json.enc': 'key.file.places',
  'reminders.json.enc': 'key.file.reminders',
  'checklists.json.enc': 'key.file.checklists',
  'calendar.json.enc': 'key.file.calendar',
}

/** Paden als leesbare opsomming ("Fooien en kosten, Instellingen en Studenten"). */
function listLabels(paths: readonly CollectionPath[]): string {
  const labels = paths.map((p) => t(FILE_LABEL[p]).toLowerCase())
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} ${t('common.and')} ${labels[labels.length - 1]}`
}

/**
 * Logboek herstellen: in gewone taal wat er verloren gaat, dan één tik op "Herstellen" (met wachtzin of herstelcode
 * als die gevraagd wordt, en alleen een token als de token op dit apparaat onleesbaar is).
 */
export function Repair({ report, needsSecret }: { report: RepairReport | null; needsSecret: boolean }) {
  const session = useSession()
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenNeeded = report?.tokenNeeded ?? false

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await session.repair({
        secret: needsSecret ? (mode === 'passphrase' ? { passphrase: secret } : { recoveryCode: secret }) : undefined,
        token: tokenNeeded ? token : undefined,
      })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || (needsSecret && secret.trim().length === 0) || (tokenNeeded && token.trim().length === 0)
  return (
    <Screen title={t('repair.title')}>
      {report === null ? (
        <p>{t('repair.unknown')}</p>
      ) : (
        <>
          <p>{t('repair.intro')}</p>
          <div className="section">
            <h2>{t('repair.lost')}</h2>
            {report.lost.length > 0 ? (
              <ul className="rows loss-list">
                {report.lost.map((path) => (
                  <li key={path} className="row-item">
                    <span className="row-main">
                      <span>{t(FILE_LABEL[path])}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t('repair.nothingLost')}</p>
            )}
            {report.localOnly.length > 0 && <p className="muted small">{t('repair.localOnly', { files: listLabels(report.localOnly) })}</p>}
            {report.replaced.length > 0 && <p className="muted small">{t('repair.replaced', { files: listLabels(report.replaced) })}</p>}
            <p className="muted small">{t('repair.kept')}</p>
          </div>
        </>
      )}
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {needsSecret &&
          (mode === 'passphrase' ? (
            <label>
              {t('passphrase.label')}
              <input type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </label>
          ) : (
            <label>
              {t('setup.recoveryField', { n: RECOVERY_WORD_COUNT })}
              <textarea rows={4} autoComplete="off" autoCapitalize="none" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </label>
          ))}
        {tokenNeeded && (
          <label>
            {t('token.label')}
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
            <span className="muted small">{t('repair.tokenHint')}</span>
          </label>
        )}
        <ErrorLine error={error} />
        <button className="btn primary" type="submit" disabled={disabled}>
          {busy ? t('repair.busy') : t('repair.button')}
        </button>
        {needsSecret && (
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
        )}
      </form>
      <CopyErrorDetails />
    </Screen>
  )
}
