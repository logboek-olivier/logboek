import { updates, useUpdateAvailable } from '../updates'
import { t } from '../i18n'

/** Balk bovenaan zodra een nieuwe versie klaarstaat. Herladen gebeurt alleen op verzoek. */
export function UpdateBar() {
  const available = useUpdateAvailable()
  if (!available) return null
  return (
    <div className="update-bar" role="status">
      <span>{t('update.available')}</span>
      <button className="btn link" onClick={() => updates.reload()}>
        {t('update.reload')}
      </button>
    </div>
  )
}
