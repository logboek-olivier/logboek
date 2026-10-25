import { useCallback, useState } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import { SyncStatusLine } from '../components/SyncStatusLine'
import { Toast } from '../components/Toast'
import { useSession } from '../session'
import type { Store } from '../storage/store'
import { Money } from './Money'
import { QuickAdd } from './QuickAdd'
import { Sailing } from './Sailing'

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Zeilen · + · Geld.
// Vandaag is nog tijdelijk (alleen Verversen en Vergrendelen).

export function Home({ store }: { store: Store }) {
  const session = useSession()
  const [tab, setTab] = useState<Tab>('vandaag')
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  function done(message: string) {
    setToast(message)
    setTab('vandaag')
  }

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} />
      {tab === 'zeilen' && <Sailing store={store} />}
      {tab === 'toevoegen' && <QuickAdd store={store} onDone={done} />}
      {tab === 'geld' && <Money store={store} onDone={setToast} />}
      {tab === 'vandaag' && (
        <section className="stack">
          <h1>Logboek</h1>
          <button className="btn" onClick={() => void store.sync()}>
            Verversen
          </button>
          <button className="btn" onClick={() => session.lock()}>
            Vergrendelen
          </button>
        </section>
      )}
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
