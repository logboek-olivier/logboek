import { useCallback, useRef, useState } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import type { Notify } from '../components/EditSheets'
import { SyncStatusLine } from '../components/SyncStatusLine'
import { Toast, type ToastMessage } from '../components/Toast'
import type { Store } from '../storage/store'
import { Money } from './Money'
import { QuickAdd } from './QuickAdd'
import { Sailing } from './Sailing'
import { Settings } from './Settings'
import { Today } from './Today'

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Zeilen · + · Geld · Instellingen.

export function Home({ store }: { store: Store }) {
  const [tab, setTab] = useState<Tab>('vandaag')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const counter = useRef(0)
  const clearToast = useCallback(() => setToast(null), [])

  const notify: Notify = useCallback((text, undo) => {
    counter.current++
    setToast({
      id: counter.current,
      text,
      action: undo ? { label: 'Ongedaan maken', run: () => void undo() } : undefined,
    })
  }, [])

  function select(next: Tab) {
    setTab(next)
    window.scrollTo(0, 0)
  }

  function done(message: string) {
    notify(message)
    select('vandaag')
  }

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} />
      {tab === 'vandaag' && (
        <Today store={store} notify={notify} onSettings={() => select('instellingen')} onAdd={() => select('toevoegen')} />
      )}
      {tab === 'zeilen' && <Sailing store={store} notify={notify} />}
      {tab === 'toevoegen' && <QuickAdd store={store} onDone={done} />}
      {tab === 'geld' && <Money store={store} notify={notify} onAdd={() => select('toevoegen')} />}
      {tab === 'instellingen' && <Settings store={store} notify={notify} />}
      <Toast message={toast} onDone={clearToast} />
      <BottomBar active={tab} onSelect={select} />
    </main>
  )
}
