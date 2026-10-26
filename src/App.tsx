import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ErrorBoundary, installGlobalErrorHandlers, UnhandledErrorBar } from './components/ErrorBoundary'
import { Loading } from './components/Loading'
import { setScreen } from './errors'
import { UpdateBar } from './components/UpdateBar'
import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { Unlock } from './screens/Unlock'
import { Session, SessionContext } from './session'

export function App() {
  const session = useMemo(() => new Session(), [])
  const state = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
  )

  useEffect(() => {
    installGlobalErrorHandlers()
    void session.init()
  }, [session])

  // Vergrendelen na 5 minuten zonder gebruik (beveiligingsregel 10). Verbergen vergrendelt niet meer: dan wordt
  // het laatste gebruik opgeslagen, en bij terugkomen telt of de 5 minuten om zijn.
  useEffect(() => {
    if (state.phase !== 'unlocked') return
    const touch = () => session.touch()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') session.flushActivity()
      else session.checkExpiry()
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    for (const ev of events) window.addEventListener(ev, touch, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onVisibility)
    // Teruggezet uit de back/forward-cache: timers stonden stil, dus direct controleren.
    const onPageShow = () => session.checkExpiry()
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pagehide', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      for (const ev of events) window.removeEventListener(ev, touch)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [session, state.phase])

  setScreen({ loading: 'Laden', setup: 'Eerste keer', locked: 'Ontgrendelen', unlocked: 'Vandaag' }[state.phase])
  let screen: React.ReactNode
  switch (state.phase) {
    case 'loading':
      screen = <Loading />
      break
    case 'setup':
      screen = <Setup />
      break
    case 'locked':
      screen = <Unlock fingerprint={state.fingerprint} />
      break
    case 'unlocked':
      screen = <Home store={state.store} />
      break
  }
  return (
    <SessionContext.Provider value={session}>
      <UpdateBar />
      <UnhandledErrorBar />
      <ErrorBoundary>{screen}</ErrorBoundary>
    </SessionContext.Provider>
  )
}
