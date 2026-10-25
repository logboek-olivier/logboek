import { useEffect, useMemo, useSyncExternalStore } from 'react'
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
    void session.init()
  }, [session])

  // Vergrendelen na 5 minuten zonder interactie en bij verbergen van de app (beveiligingsregel 10).
  useEffect(() => {
    if (state.phase !== 'unlocked') return
    const touch = () => session.touch()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') session.lock()
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    for (const ev of events) window.addEventListener(ev, touch, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      for (const ev of events) window.removeEventListener(ev, touch)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [session, state.phase])

  let screen: React.ReactNode
  switch (state.phase) {
    case 'loading':
      screen = <main className="app" />
      break
    case 'setup':
      screen = <Setup />
      break
    case 'locked':
      screen = <Unlock />
      break
    case 'unlocked':
      screen = <Home store={state.store} />
      break
  }
  return <SessionContext.Provider value={session}>{screen}</SessionContext.Provider>
}
