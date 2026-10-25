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

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Zeilen · + · Geld, Instellingen via het tandwiel.

export function Home({ store }: { store: Store }) {
  const [tab, setTab] = useState<Tab>('vandaag')
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  function done(message: string) {
    setToast(message)
    setTab('vandaag')
  }

  if (settings) {
    return (
      <main className="app">
        <SyncStatusLine store={store} />
        <Settings onBack={() => setSettings(false)} onDone={setToast} />
        <Toast message={toast} onDone={clearToast} />
      </main>
    )
  }

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} />
      {tab === 'vandaag' && <Today store={store} onSettings={() => setSettings(true)} />}
      {tab === 'zeilen' && <Sailing store={store} />}
      {tab === 'toevoegen' && <QuickAdd store={store} onDone={done} />}
      {tab === 'geld' && <Money store={store} onDone={setToast} />}
      <Toast message={toast} onDone={clearToast} />
      <BottomBar
        tabs={[
          { id: 'vandaag', label: 'Vandaag' },
          { id: 'zeilen', label: 'Zeilen' },
          { id: 'toevoegen', label: '+' },
          { id: 'geld', label: 'Geld' },
        ]}
        active={tab}
        onSelect={setTab}
      />
    </main>
  )
}
