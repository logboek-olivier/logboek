import { useEffect, useRef, useState } from 'react'
import { describeError, useSession } from '../session'
import { ErrorLine, Screen, SecretForm } from './Setup'

// Ontgrendelen: wachtzin of herstelcode; vingerafdruk als die op dit apparaat is ingesteld. Niets anders zichtbaar.

/** WebAuthn met userVerification 'required' accepteert op Android ook de pincode of het patroon van het toestel. */
export const FINGERPRINT_LABEL = 'Vingerafdruk of schermvergrendeling'

export function Unlock({ fingerprint }: { fingerprint: boolean }) {
  const session = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fingerprintFailed, setFingerprintFailed] = useState(false)
  const inFlight = useRef<AbortController | null>(null)

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

  function askFingerprint() {
    if (inFlight.current) return
    const controller = new AbortController()
    inFlight.current = controller
    setBusy(true)
    setError(null)
    session
      .unlockWithFingerprint(controller.signal)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(describeError(e))
        setFingerprintFailed(true)
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null
        setBusy(false)
      })
  }

  // Met vingerafdruk ingesteld: direct vragen bij openen, maar pas als de app zichtbaar is
  // (na vergrendelen door verbergen weigert de browser een verzoek uit een verborgen document).
  useEffect(() => {
    if (!fingerprint) return
    const start = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', start)
        askFingerprint()
      }
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      document.removeEventListener('visibilitychange', start)
      inFlight.current?.abort()
      inFlight.current = null
    }
  }, [fingerprint]) // alleen bij mount/unmount en als de vlag wisselt

  return (
    <Screen title="Logboek">
      {fingerprint && (
        <div className="stack">
          <button className="btn primary" disabled={busy} onClick={askFingerprint}>
            {FINGERPRINT_LABEL}
          </button>
          <ErrorLine error={error} />
          {fingerprintFailed && (
            <button className="btn link" type="button" onClick={() => void session.disableFingerprint()}>
              {FINGERPRINT_LABEL} op dit apparaat uitzetten (daarna alleen wachtzin)
            </button>
          )}
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
