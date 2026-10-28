import { TriangleAlert } from 'lucide-react'
import { Component, useSyncExternalStore, type ReactNode } from 'react'
import { clearError, lastError, recordError, subscribeErrors } from '../errors'
import { CopyErrorDetails } from './ErrorDetails'
import { Icon } from './Icon'
import { t } from '../i18n'
import { markCrashed } from '../updates'

/** Vangt een fout tijdens tekenen: geen wit scherm, maar een melding met foutdetails en Herladen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: unknown) {
    recordError(error)
    markCrashed()
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <main className="app">
        <div className="crash">
          <Icon icon={TriangleAlert} />
          <h1>{t('error.generic')}</h1>
          <p className="muted">{t('error.crashSafe')}</p>
          <CopyErrorDetails />
          <button className="btn primary" onClick={() => window.location.reload()}>
            {t('update.reload')}
          </button>
        </div>
      </main>
    )
  }
}

let unhandled = false
let installed = false

/** Onverwachte fouten buiten React (bijvoorbeeld een mislukte promise) vastleggen en melden. */
export function installGlobalErrorHandlers(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => {
    // Bekende onschuldige browsermelding.
    if (String(e.message).includes('ResizeObserver')) return
    unhandled = true
    recordError(e.error ?? new Error('Scriptfout'))
  })
  window.addEventListener('unhandledrejection', (e) => {
    unhandled = true
    recordError(e.reason)
  })
}

/** Balk bovenaan na een onverwachte fout, met "Kopieer foutdetails". */
export function UnhandledErrorBar() {
  const recorded = useSyncExternalStore(subscribeErrors, lastError)
  if (!unhandled || !recorded) return null
  return (
    <div className="error-bar" role="alert">
      <span>{t('error.generic')}</span>
      <CopyErrorDetails />
      <button
        className="btn link small"
        onClick={() => {
          unhandled = false
          clearError()
        }}
      >
        {t('common.close')}
      </button>
    </div>
  )
}
