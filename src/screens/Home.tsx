import { useCallback, useState } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import { SyncStatusLine } from '../components/SyncStatusLine'
import { Toast } from '../components/Toast'
import type { Store } from '../storage/store'
import { Money } from './Money'
import { QuickAdd } from './QuickAdd'
import { Sailing } from './Sailing'
import { Settings } from './Settings'
import { Today } from './Today'

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Zeilen · + · Geld · Instellingen.

export function Home({ store }: { store: Store }) {
  const [tab, setTab] = useState<Tab>('vandaag')
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  function select(next: Tab) {
    setTab(next)
    window.scrollTo(0, 0)
  }

  function done(message: string) {
    setToast(message)
    select('vandaag')
  }

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} />
      {tab === 'vandaag' && <Today store={store} onSettings={() => select('instellingen')} onAdd={() => select('toevoegen')} />}
      {tab === 'zeilen' && <Sailing store={store} />}
      {tab === 'toevoegen' && <QuickAdd store={store} onDone={done} />}
      {tab === 'geld' && <Money store={store} onDone={setToast} onAdd={() => select('toevoegen')} />}
      {tab === 'instellingen' && <Settings onDone={setToast} />}
      <Toast message={toast} onDone={clearToast} />
      <BottomBar active={tab} onSelect={select} />
    </main>
  )
}
