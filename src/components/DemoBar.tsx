import { Presentation, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { isDemo, stopDemo, subscribeDemo } from '../demo'
import { t } from '../i18n'
import { Icon } from './Icon'

/** Duidelijk bovenaan zolang de demo loopt, met één tik terug naar de eigen gegevens. */
export function DemoBar() {
  // Zolang de balk staat, schuiven de vaste maandkoppen eronder (body.demo-on in app.css).
  useEffect(() => {
    document.body.classList.add('demo-on')
    return () => document.body.classList.remove('demo-on')
  }, [])
  return (
    <div className="demo-bar">
      <Icon icon={Presentation} />
      <span className="grow">{t('demo.bar')}</span>
      <button type="button" className="btn small" onClick={() => void stopDemo()}>
        <Icon icon={X} />
        {t('demo.stop')}
      </button>
    </div>
  )
}

/** Loopt de demo? Dan zijn onderdelen die over de eigen gegevens of het eigen GitHub gaan verborgen. */
export function useIsDemo(): boolean {
  return useSyncExternalStore(subscribeDemo, isDemo)
}
