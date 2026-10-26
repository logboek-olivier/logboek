import { ChevronDown, ChevronRight, Cloud, Download, Target, Fingerprint as FingerprintIcon, Info, KeyRound, Lock, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { GoalSheet, type Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { APP_VERSION, BUILD_DATE, COMMIT } from '../build-info'
import { formatDate, formatNm } from '../format'
import { currentSettings, yearGoal } from '../model/settings'
import type { Store } from '../storage/store'
import { describeError, MIN_PASSPHRASE_LENGTH, useSession } from '../session'
import { ErrorLine, TokenForm } from './Setup'
import { FINGERPRINT_LABEL } from './Unlock'

// Instellingen: vergrendelen, wachtzin wijzigen, herstelcode tonen, vingerafdruk aan/uit, token vervangen, back-up.

type Panel = 'none' | 'passphrase' | 'recovery' | 'fingerprint' | 'token' | 'backup'

export function Settings({ store, notify }: { store: Store; notify: Notify }) {
  const onDone = (message: string) => notify(message)
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [goalOpen, setGoalOpen] = useState(false)
  const session = useSession()
  const [panel, setPanel] = useState<Panel>('none')
  const [fingerprintPossible, setFingerprintPossible] = useState(false)
  const [fingerprintOn, setFingerprintOn] = useState(false)

  useEffect(() => {
    void session.fingerprintPossible().then(setFingerprintPossible)
    void session.hasFingerprint().then(setFingerprintOn)
  }, [session])

  const toggle = (p: Panel) => setPanel(panel === p ? 'none' : p)
  const row = (p: Exclude<Panel, 'none'>, icon: LucideIcon, label: string, content: ReactNode) => (
    <li>
      <button className="settings-row" aria-expanded={panel === p} onClick={() => toggle(p)}>
        <Icon icon={icon} />
        <span className="row-main">{label}</span>
        <Icon icon={ChevronDown} className="chevron" />
      </button>
      {panel === p && <div className="settings-panel">{content}</div>}
    </li>
  )

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>Instellingen</h1>
      </header>

      <ul className="rows">
        <li>
          <button className="settings-row" onClick={() => session.lock()}>
            <Icon icon={Lock} />
            <span className="row-main">Vergrendelen</span>
          </button>
        </li>
      </ul>

      <div className="section">
        <h2>Logboek</h2>
        <ul className="rows">
          <li>
            <button className="settings-row" onClick={() => setGoalOpen(true)}>
              <Icon icon={Target} />
              <span className="row-main">Jaardoel</span>
              <span className="muted">{formatNm(yearGoal(settings))}</span>
              <Icon icon={ChevronRight} className="chevron" />
            </button>
          </li>
        </ul>
      </div>
      {goalOpen && <GoalSheet store={store} current={yearGoal(settings)} onClose={() => setGoalOpen(false)} notify={notify} />}

      <div className="section">
        <h2>Beveiliging</h2>
        <ul className="rows">
          {row(
            'passphrase',
            KeyRound,
            'Wachtzin wijzigen',
            <ChangePassphrase
              onDone={() => {
                setPanel('none')
                onDone('Wachtzin gewijzigd')
              }}
            />,
          )}
          {row('recovery', ShieldCheck, 'Herstelcode tonen', <RevealRecovery />)}
          {(fingerprintPossible || fingerprintOn) &&
            row(
              'fingerprint',
              FingerprintIcon,
              `${FINGERPRINT_LABEL} ${fingerprintOn ? 'uitzetten' : 'aanzetten'}`,
              <Fingerprint
                enabled={fingerprintOn}
                onDone={(on) => {
                  setFingerprintOn(on)
                  setPanel('none')
                  onDone(on ? `${FINGERPRINT_LABEL} aan` : `${FINGERPRINT_LABEL} uit`)
                }}
              />,
            )}
        </ul>
      </div>

      <div className="section">
        <h2>Opslag</h2>
        <ul className="rows">
          {row(
            'token',
            Cloud,
            'Token vervangen',
            <ReplaceToken
              onDone={() => {
                setPanel('none')
                onDone('Token vervangen')
              }}
            />,
          )}
          {row('backup', Download, 'Back-up maken', <Backup />)}
        </ul>
      </div>

      <div className="section">
        <h2>Over</h2>
        <ul className="rows">
          <li className="row-item">
            <Icon icon={Info} />
            <dl className="about">
              <dt>Versie</dt>
              <dd className="num">{APP_VERSION}</dd>
              <dt>Gebouwd</dt>
              <dd className="num">{BUILD_DATE ? formatDate(BUILD_DATE.slice(0, 10)) : 'onbekend'}</dd>
              <dt>Commit</dt>
              <dd className="num">
                <code>{COMMIT}</code>
              </dd>
            </dl>
          </li>
        </ul>
      </div>
    </section>
  )
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function ChangePassphrase({ onDone }: { onDone: () => void }) {
  const session = useSession()
  const { busy, error, run } = useAction()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const ok = current.length > 0 && next.length >= MIN_PASSPHRASE_LENGTH && next === again
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ok) void run(async () => {
      await session.changePassphrase(current, next)
      onDone()
    })
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Huidige wachtzin
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>
        Nieuwe wachtzin
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label>
        Nog een keer
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {next.length > 0 && next.length < MIN_PASSPHRASE_LENGTH && <p className="error">Te kort (minimaal {MIN_PASSPHRASE_LENGTH} tekens)</p>}
      {again.length > 0 && next !== again && <p className="error">De twee wachtzinnen verschillen</p>}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={!ok || busy}>
        {busy ? 'Wijzigen…' : 'Wijzigen'}
      </button>
    </form>
  )
}

function RevealRecovery() {
  const session = useSession()
  const { busy, error, run } = useAction()
  const [passphrase, setPassphrase] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => setWords(await session.revealRecovery(passphrase)))
  }
  if (words) {
    return (
      <div className="stack">
        <ol className="words">
          {words.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ol>
        <button className="btn" onClick={() => setWords(null)}>
          Verbergen
        </button>
      </div>
    )
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Wachtzin
        <input type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </label>
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={passphrase.length === 0 || busy}>
        {busy ? 'Controleren…' : 'Tonen'}
      </button>
    </form>
  )
}

function Fingerprint({ enabled, onDone }: { enabled: boolean; onDone: (on: boolean) => void }) {
  const session = useSession()
  const { busy, error, run } = useAction()
  const [passphrase, setPassphrase] = useState('')
  if (enabled) {
    return (
      <div className="stack">
        <p className="muted">Daarna is alleen de wachtzin nog mogelijk op dit apparaat.</p>
        <ErrorLine error={error} />
        <button
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await session.disableFingerprint()
              onDone(false)
            })
          }
        >
          Uitzetten
        </button>
      </div>
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await session.enableFingerprint(passphrase)
      onDone(true)
    })
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted">
        Bevestig met de wachtzin; daarna vraagt het apparaat om de vingerafdruk. Android accepteert ook de pincode of
        het patroon van de schermvergrendeling.
      </p>
      <label>
        Wachtzin
        <input type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </label>
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={passphrase.length === 0 || busy}>
        {busy ? 'Bezig…' : 'Aanzetten'}
      </button>
    </form>
  )
}

function ReplaceToken({ onDone }: { onDone: () => void }) {
  const session = useSession()
  const { busy, error, run } = useAction()
  return (
    <div className="stack">
      <TokenForm
        check={(token) => session.checkToken(token)}
        submitLabel={busy ? 'Vervangen…' : 'Vervangen'}
        disabled={busy}
        onDone={({ token, expiresAt }) =>
          void run(async () => {
            await session.replaceToken(token, expiresAt)
            onDone()
          })
        }
      />
      <ErrorLine error={error} />
    </div>
  )
}

/** Back-up van logboek-data op een eigen computer. De app doet hiervoor geen netwerkverkeer; dit is alleen tekst. */
function Backup() {
  return (
    <div className="stack">
      <p className="muted">
        De versleutelde data staat in de GitHub-repo <code>logboek-data</code>. Een kopie op de laptop maak en ververs je
        in PowerShell (eenmalig clonen, daarna bijwerken):
      </p>
      <pre className="code">{`git clone https://github.com/logboek-olivier/logboek-data.git
cd logboek-data
git pull`}</pre>
      <p className="muted">
        De bestanden zijn zonder wachtzin of herstelcode niet te lezen. Bewaar de herstelcode op papier, niet naast de
        kopie.
      </p>
    </div>
  )
}
