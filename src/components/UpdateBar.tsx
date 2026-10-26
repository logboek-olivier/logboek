import { updates, useUpdateAvailable } from '../updates'

/** Balk bovenaan zodra een nieuwe versie klaarstaat. Herladen gebeurt alleen op verzoek. */
export function UpdateBar() {
  const available = useUpdateAvailable()
  if (!available) return null
  return (
    <div className="update-bar" role="status">
      <span>Nieuwe versie beschikbaar</span>
      <button className="btn link" onClick={() => updates.reload()}>
        Herladen
      </button>
    </div>
  )
}
