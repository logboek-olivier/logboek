import { useState } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import { SyncStatusLine } from '../components/SyncStatusLine'
import { useSession } from '../session'
import type { Store } from '../storage/store'
import { Sailing } from './Sailing'

// Ontgrendelde app: sync-status bovenaan, onderste balk. Vandaag is nog tijdelijk (alleen Vergrendelen).

export function Home({ store }: { store: Store }) {
  const session = useSession()
  const [tab, setTab] = useState<Tab>('vandaag')
  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} />
      {tab === 'zeilen' ? (
        <Sailing store={store} />
      ) : (
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
      <BottomBar
        tabs={[
          { id: 'vandaag', label: 'Vandaag' },
          { id: 'zeilen', label: 'Zeilen' },
        ]}
        active={tab}
        onSelect={setTab}
      />
    </main>
  )
}
