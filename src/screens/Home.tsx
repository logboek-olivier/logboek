import { useSession } from '../session'
import type { Store } from '../storage/store'
import { SyncStatusLine } from '../components/SyncStatusLine'

// Tijdelijk hoofdscherm: alleen sync-status en vergrendelen. Wordt vervangen door Vandaag.

export function Home({ store }: { store: Store }) {
  const session = useSession()
  return (
    <main className="app">
      <SyncStatusLine store={store} />
      <h1>Logboek</h1>
      <div className="stack">
        <button className="btn" onClick={() => void store.sync()}>
          Verversen
        </button>
        <button className="btn" onClick={() => session.lock()}>
          Vergrendelen
        </button>
      </div>
    </main>
  )
}
