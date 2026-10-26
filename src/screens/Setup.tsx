import { Anchor, ChevronLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { Icon } from '../components/Icon'
import { isUserMistake, lastError } from '../errors'
import { RECOVERY_WORD_COUNT } from '../crypto/recovery'
import { describeError, MIN_PASSPHRASE_LENGTH, useSession, type PreparedVault } from '../session'

// Eerste keer op een apparaat: nieuw logboek of bestaand logboek koppelen.

interface TokenInfo {
  token: string
  /** Vervaldatum jjjj-mm-dd, of null als onbekend (klassieke token zonder einddatum). */
  expiresAt: string | null
}

type Step =
  | { kind: 'choose' }
  | { kind: 'token'; mode: 'new' | 'link' }
  | { kind: 'passphrase'; token: TokenInfo }
  | { kind: 'words'; token: TokenInfo; vault: PreparedVault }
  | { kind: 'confirm'; token: TokenInfo; vault: PreparedVault; positions: number[] }
  | { kind: 'secret'; token: TokenInfo }

export function Setup() {
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useSession()

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

  if (step.kind === 'choose') {
    return (
      <Screen title="Eerste keer">
        <p className="muted">Kies hoe dit apparaat aan het logboek komt.</p>
        <div className="stack">
          <button className="btn primary" onClick={() => setStep({ kind: 'token', mode: 'new' })}>
            Nieuw logboek
          </button>
          <button className="btn" onClick={() => setStep({ kind: 'token', mode: 'link' })}>
            Bestaand logboek koppelen
          </button>
        </div>
      </Screen>
    )
  }

  if (step.kind === 'token') {
    const check = (token: string) =>
      step.mode === 'new' ? session.checkEmptyRepo(token) : session.checkToken(token)
    return (
      <Screen title={step.mode === 'new' ? 'Nieuw logboek' : 'Logboek koppelen'} onBack={() => setStep({ kind: 'choose' })}>
        <TokenForm
          check={check}
          onDone={(token) => setStep(step.mode === 'new' ? { kind: 'passphrase', token } : { kind: 'secret', token })}
        />
      </Screen>
    )
  }

  if (step.kind === 'passphrase') {
    return (
      <Screen title="Wachtzin kiezen" onBack={() => setStep({ kind: 'token', mode: 'new' })}>
        <PassphraseForm
          busy={busy}
          error={error}
          onSubmit={(passphrase) =>
            run(async () => {
              const vault = await session.prepareVault(passphrase)
              setStep({ kind: 'words', token: step.token, vault })
            })
          }
        />
      </Screen>
    )
  }

  if (step.kind === 'words') {
    // Terug = andere token kiezen; er is nog niets opgeslagen, de sleutels worden dan opnieuw gemaakt.
    return (
      <Screen title="Herstelcode" onBack={() => setStep({ kind: 'token', mode: 'new' })}>
        <p>
          Schrijf deze {RECOVERY_WORD_COUNT} woorden op papier, in deze volgorde. Zonder wachtzin en zonder deze
          woorden is het logboek niet te openen.
        </p>
        <ol className="words">
          {step.vault.recoveryWords.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ol>
        <button
          className="btn primary"
          onClick={() => setStep({ kind: 'confirm', token: step.token, vault: step.vault, positions: pickPositions() })}
        >
          Ik heb ze opgeschreven
        </button>
      </Screen>
    )
  }

  if (step.kind === 'confirm') {
    return (
      <Screen title="Herstelcode controleren" onBack={() => setStep({ kind: 'words', token: step.token, vault: step.vault })}>
        <ConfirmWordsForm
          busy={busy}
          error={error}
          positions={step.positions}
          words={step.vault.recoveryWords}
          onSubmit={() => run(() => session.finishNewVault(step.token.token, step.token.expiresAt, step.vault))}
        />
      </Screen>
    )
  }

  return (
    <Screen title="Logboek koppelen" onBack={() => setStep({ kind: 'token', mode: 'link' })}>
      <SecretForm
        busy={busy}
        error={error}
        submitLabel="Koppelen"
        onSubmit={(secret) => run(() => session.link(step.token.token, step.token.expiresAt, secret))}
      />
    </Screen>
  )
}

function pickPositions(): number[] {
  const all = Array.from({ length: RECOVERY_WORD_COUNT }, (_, i) => i)
  const bytes = crypto.getRandomValues(new Uint8Array(3))
  const picked: number[] = []
  for (const b of bytes) picked.push(...all.splice(b % all.length, 1))
  return picked.sort((a, b) => a - b)
}

export function Screen({
  title,
  onBack,
  children,
}: {
  title: string
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <main className="app">
      {onBack ? (
        <header className="screen-header">
          <button className="btn link" onClick={onBack} aria-label="Terug">
            <Icon icon={ChevronLeft} />
            Terug
          </button>
          <h1>{title}</h1>
        </header>
      ) : (
        <header className="brand">
          <span className="brand-mark">
            <Icon icon={Anchor} />
          </span>
          <h1>{title}</h1>
        </header>
      )}
      <div className="stack">{children}</div>
    </main>
  )
}

/** Foutmelding in gewone taal, met "Kopieer foutdetails" (behalve bij een verkeerd getypte wachtzin of herstelcode). */
export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  const recorded = lastError()
  return (
    <div className="error-block">
      <p className="error" role="alert">
        {error}
      </p>
      {recorded && !isUserMistake(recorded.error) && <CopyErrorDetails />}
    </div>
  )
}

/**
 * Token invoeren in twee stappen: (1) token controleren bij GitHub, (2) vervaldatum bevestigen,
 * vooraf ingevuld als de browser de header github-authentication-token-expiration mocht lezen.
 */
export function TokenForm({
  check,
  onDone,
  submitLabel = 'Verder',
  disabled = false,
}: {
  check: (token: string) => Promise<{ expiresAt: string | null }>
  onDone: (token: TokenInfo) => void
  submitLabel?: string
  /** Bijvoorbeeld zolang de aanroeper nog bezig is met opslaan; voorkomt dubbel tikken. */
  disabled?: boolean
}) {
  const [token, setToken] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [checked, setChecked] = useState(false)
  const [fromHeader, setFromHeader] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = busy || disabled

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (token.trim().length === 0 || blocked) return
    if (checked) {
      // De waarde in het veld is leidend, ook als Olivier hem bewust leegmaakt.
      onDone({ token: token.trim(), expiresAt: expiresAt || null })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await check(token)
      setExpiresAt(result.expiresAt ?? '')
      setFromHeader(result.expiresAt !== null)
      setChecked(true)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="stack">
      <label>
        GitHub-token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => {
            // Andere token: alles van de vorige controle vergeten.
            setToken(e.target.value)
            setChecked(false)
            setExpiresAt('')
            setFromHeader(false)
          }}
          placeholder="github_pat_…"
          required
        />
      </label>
      {!checked && <p className="muted">Fine-grained token met alleen Contents: lezen en schrijven op logboek-data.</p>}
      {checked && (
        <>
          <label>
            Vervaldatum van de token
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>
          <p className="muted">
            {fromHeader
              ? 'Overgenomen van GitHub. De app waarschuwt 30 dagen voor het verlopen.'
              : 'Niet leesbaar van GitHub; vul de datum in die je bij het aanmaken koos, of laat leeg.'}
          </p>
        </>
      )}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={blocked || token.trim().length === 0}>
        {busy ? 'Controleren…' : checked ? submitLabel : 'Controleren'}
      </button>
    </form>
  )
}

function PassphraseForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onSubmit: (passphrase: string) => void
}) {
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const tooShort = first.length > 0 && first.length < MIN_PASSPHRASE_LENGTH
  const mismatch = second.length > 0 && first !== second
  const ok = first.length >= MIN_PASSPHRASE_LENGTH && first === second
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ok) onSubmit(first)
  }
  return (
    <form onSubmit={submit} className="stack">
      <label>
        Wachtzin
        <input type="password" autoComplete="new-password" value={first} onChange={(e) => setFirst(e.target.value)} />
      </label>
      <label>
        Nog een keer
        <input type="password" autoComplete="new-password" value={second} onChange={(e) => setSecond(e.target.value)} />
      </label>
      <p className="muted">Minimaal {MIN_PASSPHRASE_LENGTH} tekens. Een zin van een paar woorden werkt het best.</p>
      {tooShort && <p className="error">Te kort</p>}
      {mismatch && <p className="error">De twee wachtzinnen verschillen</p>}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={busy || !ok}>
        {busy ? 'Sleutels maken…' : 'Verder'}
      </button>
    </form>
  )
}

function ConfirmWordsForm({
  busy,
  error,
  positions,
  words,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  positions: number[]
  words: string[]
  onSubmit: () => void
}) {
  const [typed, setTyped] = useState<string[]>(positions.map(() => ''))
  const [wrong, setWrong] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const allRight = positions.every((p, i) => (typed[i] ?? '').trim().toLowerCase() === words[p])
    setWrong(!allRight)
    if (allRight) onSubmit()
  }
  return (
    <form onSubmit={submit} className="stack">
      <p>Typ drie woorden van de herstelcode.</p>
      {positions.map((p, i) => (
        <label key={p}>
          Woord {p + 1}
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            value={typed[i] ?? ''}
            onChange={(e) => setTyped(typed.map((t, j) => (j === i ? e.target.value : t)))}
          />
        </label>
      ))}
      {wrong && <p className="error">Een of meer woorden kloppen niet</p>}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={busy || typed.some((t) => t.trim() === '')}>
        {busy ? 'Logboek aanmaken…' : 'Logboek aanmaken'}
      </button>
    </form>
  )
}

export function SecretForm({
  busy,
  error,
  submitLabel,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  submitLabel: string
  onSubmit: (secret: { passphrase: string } | { recoveryCode: string }) => void
}) {
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase')
  const [value, setValue] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim().length === 0) return
    onSubmit(mode === 'passphrase' ? { passphrase: value } : { recoveryCode: value })
  }
  return (
    <form onSubmit={submit} className="stack">
      {mode === 'passphrase' ? (
        <label>
          Wachtzin
          <input
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
      ) : (
        <label>
          Herstelcode ({RECOVERY_WORD_COUNT} woorden)
          <textarea rows={4} autoComplete="off" autoCapitalize="none" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      <ErrorLine error={error} />
      <button className="btn primary" type="submit" disabled={busy || value.trim().length === 0}>
        {busy ? 'Bezig…' : submitLabel}
      </button>
      <button
        className="btn link"
        type="button"
        onClick={() => {
          setMode(mode === 'passphrase' ? 'recovery' : 'passphrase')
          setValue('')
        }}
      >
        {mode === 'passphrase' ? 'Herstelcode gebruiken' : 'Wachtzin gebruiken'}
      </button>
    </form>
  )
}
