import { useState } from 'react'
import { describeError, useSession } from '../session'
import { Screen, SecretForm } from './Setup'

// Ontgrendelen: wachtzin of herstelcode. Niets anders zichtbaar.

export function Unlock() {
  const session = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Screen title="Logboek">
      <SecretForm
        busy={busy}
        error={error}
        submitLabel="Ontgrendelen"
        onSubmit={async (secret) => {
          setBusy(true)
          setError(null)
          try {
            await session.unlockLocal(secret)
          } catch (e) {
            setError(describeError(e))
          } finally {
            setBusy(false)
          }
        }}
      />
    </Screen>
  )
}
