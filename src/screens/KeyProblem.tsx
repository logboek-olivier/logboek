import { useState, type FormEvent } from 'react'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { t, type MessageKey } from '../i18n'
import type { CollectionPath } from '../model/types'
import { describeError, useSession, type RecoveryReport } from '../session'
import { ErrorLine, Screen } from './Setup'

// Sleutel past niet bij het logboek (fase 'mismatch'), of ontgrendeld met een geldige sleutel terwijl lokale gegevens
// onder een andere sleutel staan (fase 'recover'). Nooit stil verder: niets geschreven, niets gewist zonder keuze.

export function KeyMismatch() {
  const session = useSession()
  return (
    <Screen title={t('key.mismatchTitle')}>
      <p>{t('key.mismatchText')}</p>
      <p className="muted">{t('key.mismatchNext')}</p>
      <button className="btn primary" onClick={() => void session.backToUnlock()}>
        {t('key.unlockAgain')}
      </button>
      <CopyErrorDetails />
    </Screen>
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
}

export function KeyRecover({ report }: { report: RecoveryReport }) {
  const session = useSession()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await session.restartFromGithub(report.tokenUnreadable ? token : undefined)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={t('key.recoverTitle')}>
      <p>{t('key.recoverText')}</p>
      <div className="section">
        <h2>{t('key.lost')}</h2>
        <ul className="rows loss-list">
          {report.unreadable.map((path) => (
            <li key={path} className="row-item">
              <span className="row-main">
                <span>{t(FILE_LABEL[path])}</span>
                <span className="muted small">{path} · {t('key.lostFile')}</span>
              </span>
            </li>
          ))}
          {report.outboxUnreadable && (
            <li className="row-item">
              <span className="row-main">
                <span>{t('key.lostOutbox')}</span>
                <span className="muted small">{t('key.lostOutboxHint')}</span>
              </span>
            </li>
          )}
          {report.tokenUnreadable && (
            <li className="row-item">
              <span className="row-main">
                <span>{t('key.lostToken')}</span>
                <span className="muted small">{t('key.lostTokenHint')}</span>
              </span>
            </li>
          )}
        </ul>
        <p className="muted small">{t('key.kept')}</p>
      </div>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {report.tokenUnreadable && (
          <label>
            {t('token.label')}
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" required />
          </label>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {t('key.restart')}
        </button>
        <ErrorLine error={error} />
      </form>
      <button className="btn link" type="button" disabled={busy} onClick={() => void session.backToUnlock()}>
        {t('key.backToUnlock')}
      </button>
      <CopyErrorDetails />
    </Screen>
  )
}
