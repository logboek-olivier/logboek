import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { ErrorBoundary, installGlobalErrorHandlers, UnhandledErrorBar } from './components/ErrorBoundary'
import { Loading } from './components/Loading'
import { setScreen } from './errors'
import { t, useLang } from './i18n'
import { UpdateBar } from './components/UpdateBar'
import { setBusyCheck, setUrgentCheck, updates } from './updates'
import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { KeyMismatch, Repair } from './screens/KeyProblem'
import { Unlock } from './screens/Unlock'
import { Session, SessionContext } from './session'
import { demoPhase, demoStore, startDemo, stopDemo, subscribeDemo } from './demo'
import { DemoBar } from './components/DemoBar'

export function App() {
  const session = useMemo(() => new Session(), [])
  useEffect(() => {
    setBusyCheck(() => session.isBusy())
    // Op een herstel- of sleutelscherm wordt een nieuwe versie direct actief.
    setUrgentCheck(() => ['repair', 'mismatch'].includes(session.getState().phase))
  }, [session])
  // De hele app tekent opnieuw als de taal wisselt (teksten en notatie volgen de taal).
  const lang = useLang()
  const state = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
  )

  // Staat er al een nieuwe versie klaar als een herstel- of sleutelscherm opent: direct laden.
  useEffect(() => {
    if ((state.phase === 'repair' || state.phase === 'mismatch') && updates.isAvailable() && !session.isBusy()) updates.reload()
  }, [session, state.phase])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // De demo hoort bij een ontgrendelde sessie: vergrendelen (ook na 5 minuten, ook halverwege het starten) stopt de
  // demo. Herladen tijdens de demo (nieuwe versie, omlaag trekken): de demo start opnieuw, nooit het eigen logboek.
  const demoState = useSyncExternalStore(subscribeDemo, demoPhase)
  const demo = demoState === 'aan' ? demoStore() : null
  useEffect(() => {
    if (state.phase === 'loading') return
    if (state.phase !== 'unlocked') {
      if (demoState !== 'uit') void stopDemo()
      return
    }
    if (demoState === 'start') void startDemo().catch(() => undefined)
  }, [state.phase, demoState])
  // Na de demo: de eigen Store kon tijdens de demo niet bij GitHub (geen verbinding); stoppen is een actie van
  // Olivier, dus dan één keer synchroniseren.
  const wasDemo = useRef(false)
  useEffect(() => {
    if (demo) wasDemo.current = true
    else if (wasDemo.current) {
      wasDemo.current = false
      if (state.phase === 'unlocked') void state.store.sync()
    }
  }, [demo, state])

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

  setScreen({ loading: 'Laden', setup: 'Eerste keer', locked: 'Ontgrendelen', unlocked: 'Vandaag', mismatch: 'Sleutel past niet', repair: 'Logboek herstellen' }[state.phase])
  let screen: React.ReactNode
  switch (state.phase) {
    case 'loading':
      screen = state.blocked ? <Loading text={t('common.blockedByOtherPage')} /> : <Loading />
      break
    case 'setup':
      screen = <Setup />
      break
    case 'locked':
      screen = <Unlock fingerprint={state.fingerprint} />
      break
    case 'unlocked':
      // Demomodus: een eigen Home op de voorbeelddata (de eigen Store blijft open, maar wordt niet getoond).
      screen = demo ? (
        <>
          <DemoBar />
          <Home key="demo" store={demo} />
        </>
      ) : demoState === 'start' ? (
        // De demo start (ook na herladen): tot hij klaar is niets van de eigen gegevens tonen.
        <Loading text={t('demo.starting')} />
      ) : (
        <Home key="eigen" store={state.store} />
      )
      break
    case 'mismatch':
      screen = <KeyMismatch where={state.where} metaRestorable={state.metaRestorable === true} />
      break
    case 'repair':
      screen = <Repair report={state.report} needsSecret={state.needsSecret} />
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
