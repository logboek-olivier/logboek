import { useCallback, useRef, useState } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import type { Notify } from '../components/EditSheets'
import { SyncStatusLine } from '../components/SyncStatusLine'
import { Toast, type ToastMessage } from '../components/Toast'
import { setScreen } from '../errors'
import { t } from '../i18n'
import type { Store } from '../storage/store'
import { Money } from './Money'
import { BackToMore, More, type MoreScreen } from './More'
import { QuickAdd } from './QuickAdd'
import { Sailing } from './Sailing'
import { Settings } from './Settings'
import { StudentArchive } from './StudentArchive'
import { ThisWeek } from './ThisWeek'
import { Today } from './Today'
import { Courses } from './Courses'

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Deze week · + · Logboek · Meer.
// Geld, Cursussen, Studentenarchief en Instellingen zitten onder Meer.

type Screen = Tab | MoreScreen

const SCREEN_NAMES: Record<Screen, string> = {
  vandaag: 'Vandaag',
  week: 'Deze week',
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

  function select(next: Screen) {
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
      {screen === 'week' && <ThisWeek store={store} notify={notify} />}
      {screen === 'logboek' && <Sailing store={store} notify={notify} />}
      {screen === 'toevoegen' && <QuickAdd store={store} onDone={done} />}
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
