import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import type { Notify } from '../components/EditSheets'
import { SyncStatusLine, useSyncStatus } from '../components/SyncStatusLine'
import { backfillRates, getRates, loadRates, subscribeRates } from '../model/rates'
import { Toast, type ToastMessage } from '../components/Toast'
import { setScreen } from '../errors'
import { t } from '../i18n'
import type { Store } from '../storage/store'
import { Money } from './Money'
import { BackToMore, More, type MoreScreen } from './More'
import { QuickAdd, type AddInit } from './QuickAdd'
import { Sailing } from './Sailing'
import { Settings } from './Settings'
import { StudentArchive } from './StudentArchive'
import { ThisWeek } from './ThisWeek'
import { Today } from './Today'
import { Courses } from './Courses'

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Deze trip · + · Logboek · Meer.
// Geld, Cursussen, Studentenarchief en Instellingen zitten onder Meer.

type Screen = Tab | MoreScreen

const SCREEN_NAMES: Record<Screen, string> = {
  vandaag: 'Vandaag',
  week: 'Deze trip',
  toevoegen: 'Toevoegen',
  logboek: 'Logboek',
  meer: 'Meer',
  geld: 'Geld',
  cursussen: 'Cursussen',
  archief: 'Studentenarchief',
  instellingen: 'Instellingen',
}


export function Home({ store }: { store: Store }) {
  const [screen, setScreenState] = useState<Screen>('vandaag')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [addInit, setAddInit] = useState<AddInit | undefined>(undefined)
  const counter = useRef(0)
  const clearToast = useCallback(() => setToast(null), [])

  const notify: Notify = useCallback((text, undo) => {
    counter.current++
    setToast({
      id: counter.current,
      text,
      action: undo ? { label: t('common.undo'), run: () => void undo() } : undefined,
    })
  }, [])

  setScreen(SCREEN_NAMES[screen])

  // Wisselkoersen (public/rates.json, zelfde origin) één keer per sessie laden; de gebruikte koers opslaan bij
  // transacties zodra die definitief is, pas na een geslaagde sync.
  const status = useSyncStatus(store)
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const backfilled = useRef(false)
  useEffect(() => {
    if (!getRates()) void loadRates()
  }, [])
  useEffect(() => {
    if (backfilled.current || !rates || !store.hasSynced()) return
    backfilled.current = true
    void backfillRates(store, rates)
  }, [store, rates, status])

  function select(next: Screen) {
    if (next !== 'toevoegen') setAddInit(undefined)
    setScreenState(next)
    window.scrollTo(0, 0)
  }

  function done(message: string) {
    notify(message)
    select('vandaag')
  }

  const activeTab: Tab = screen === 'geld' || screen === 'cursussen' || screen === 'archief' || screen === 'instellingen' ? 'meer' : screen

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} />
      {screen === 'vandaag' && (
        <Today store={store} notify={notify} onSettings={() => select('instellingen')} onAdd={() => select('toevoegen')} />
      )}
      {screen === 'week' && (
        <ThisWeek
          store={store}
          notify={notify}
          onAddDay={(init) => {
            select('toevoegen')
            setAddInit(init)
          }}
        />
      )}
      {screen === 'logboek' && <Sailing store={store} notify={notify} />}
      {screen === 'toevoegen' && <QuickAdd key={addInit ? `${addInit.date}-${addInit.tripId ?? ''}` : 'nieuw'} store={store} onDone={done} init={addInit} />}
      {screen === 'meer' && <More onOpen={select} />}
      {screen === 'geld' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Money store={store} notify={notify} onAdd={() => select('toevoegen')} />
        </>
      )}
      {screen === 'cursussen' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Courses store={store} notify={notify} />
        </>
      )}
      {screen === 'archief' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <StudentArchive store={store} notify={notify} />
        </>
      )}
      {screen === 'instellingen' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Settings store={store} notify={notify} />
        </>
      )}
      <Toast message={toast} onDone={clearToast} />
      <BottomBar active={activeTab} onSelect={select} />
    </main>
  )
}
