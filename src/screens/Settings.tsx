import { useEffect, useState, type FormEvent } from 'react'
import { describeError, MIN_PASSPHRASE_LENGTH, useSession } from '../session'
import { ErrorLine, TokenForm } from './Setup'
import { FINGERPRINT_LABEL } from './Unlock'

// Instellingen: vergrendelen, wachtzin wijzigen, herstelcode tonen, vingerafdruk aan/uit, token vervangen, back-up.

type Panel = 'none' | 'passphrase' | 'recovery' | 'fingerprint' | 'token' | 'backup'

export function Settings({ onBack, onDone }: { onBack: () => void; onDone: (message: string) => void }) {
  const session = useSession()
  const [panel, setPanel] = useState<Panel>('none')
  const [fingerprintPossible, setFingerprintPossible] = useState(false)
  const [fingerprintOn, setFingerprintOn] = useState(false)

  useEffect(() => {
    void session.fingerprintPossible().then(setFingerprintPossible)
    void session.hasFingerprint().then(setFingerprintOn)
  }, [session])

  const toggle = (p: Panel) => setPanel(panel === p ? 'none' : p)

  return (
    <section className="stack">
      <header className="screen-header">
        <button className="btn link" onClick={onBack}>
          ‹ Vandaag
        </button>
        <h1>Instellingen</h1>
      </header>

      <button className="btn" onClick={() => session.lock()}>
        Vergrendelen
      </button>

      <button className="btn" aria-expanded={panel === 'passphrase'} onClick={() => toggle('passphrase')}>
        Wachtzin wijzigen
      </button>
      {panel === 'passphrase' && (
        <ChangePassphrase
          onDone={() => {
            setPanel('none')
            onDone('Wachtzin gewijzigd')
          }}
        />
      )}

      <button className="btn" aria-expanded={panel === 'recovery'} onClick={() => toggle('recovery')}>
        Herstelcode tonen
      </button>
      {panel === 'recovery' && <RevealRecovery />}

      {(fingerprintPossible || fingerprintOn) && (
        <>
          <button className="btn" aria-expanded={panel === 'fingerprint'} onClick={() => toggle('fingerprint')}>
            {FINGERPRINT_LABEL} {fingerprintOn ? 'uitzetten' : 'aanzetten'}
          </button>
          {panel === 'fingerprint' && (
            <Fingerprint
              enabled={fingerprintOn}
              onDone={(on) => {
                setFingerprintOn(on)
                setPanel('none')
                onDone(on ? `${FINGERPRINT_LABEL} aan` : `${FINGERPRINT_LABEL} uit`)
              }}
            />
          )}
        </>
      )}

      <button className="btn" aria-expanded={panel === 'token'} onClick={() => toggle('token')}>
        Token vervangen
      </button>
      {panel === 'token' && (
        <ReplaceToken
          onDone={() => {
            setPanel('none')
            onDone('Token vervangen')
          }}
        />
      )}

      <button className="btn" aria-expanded={panel === 'backup'} onClick={() => toggle('backup')}>
        Back-up maken
      </button>
      {panel === 'backup' && <Backup />}
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
    <form className="stack panel" onSubmit={submit}>
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
      <div className="panel">
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
    <form className="stack panel" onSubmit={submit}>
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
      <div className="stack panel">
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
    <form className="stack panel" onSubmit={submit}>
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
    <div className="stack panel">
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
    <div className="stack panel">
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
