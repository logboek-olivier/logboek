import { useEffect, useState } from 'react'
import { describeError, useSession } from '../session'
import { ErrorLine, Screen, SecretForm } from './Setup'

// Ontgrendelen: wachtzin of herstelcode; vingerafdruk als die op dit apparaat is ingesteld. Niets anders zichtbaar.

export function Unlock({ fingerprint }: { fingerprint: boolean }) {
  const session = useSession()
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

  // Met vingerafdruk ingesteld: direct vragen bij openen.
  useEffect(() => {
    if (!fingerprint) return
    setBusy(true)
    setError(null)
    session
      .unlockWithFingerprint()
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => setBusy(false))
  }, [fingerprint, session])

  return (
    <Screen title="Logboek">
      {fingerprint && (
        <div className="stack">
          <button className="btn primary" disabled={busy} onClick={() => void run(() => session.unlockWithFingerprint())}>
            Vingerafdruk
          </button>
          <ErrorLine error={error} />
          <p className="muted">Of met de wachtzin:</p>
        </div>
      )}
      <SecretForm
        busy={busy}
        error={fingerprint ? null : error}
        submitLabel="Ontgrendelen"
        onSubmit={(secret) => void run(() => session.unlockLocal(secret))}
      />
    </Screen>
  )
}
