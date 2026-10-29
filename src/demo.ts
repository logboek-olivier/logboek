import { deleteDB } from 'idb'
import { demoData, type DemoData } from './demo/data'
import { getLang, setLang, type Lang } from './i18n'
import { COLLECTION_PATHS, todayIso, type CollectionPath } from './model/types'
import { blockNetwork, GithubClient } from './storage/github'
import { openLogboekDb, type Db } from './storage/idb'
import { forgetStorageLog } from './storage/storage-log'
import { Store } from './storage/store'
import { exclusive } from './storage/writer'

// Demomodus (Instellingen → Demomodus): de app draait op verzonnen voorbeelddata, standaard in het Engels, om hem te
// laten zien. Harde regels:
// - Niets van of naar GitHub: de demo-Store synct nooit (`demo`), zijn GitHub-client heeft geen netwerk, en zolang de
//   demo loopt blokkeert `blockNetwork` élk verzoek naar api.github.com, ook van de eigen Store (die blijft open), en
//   breekt het verzoeken af die nog onderweg waren.
// - De echte lokale data wordt niet aangeraakt: de demo heeft een eigen IndexedDB (`logboek-demo`) en een eigen,
//   willekeurige sleutel in het geheugen; bij stoppen wordt die database gewist.
// - Uitzetten brengt direct de eigen data en de eigen taal terug (de taalkeuze in localStorage verandert niet).
// - Herladen tijdens de demo (een nieuwe versie, omlaag trekken) opent niet het eigen logboek: een markering in
//   sessionStorage laat de app de demo opnieuw starten (src/App.tsx). Vergrendelen stopt de demo en de markering.

export const DEMO_DB = 'logboek-demo'
const WANTED_KEY = 'logboek-demo-actief'

/** Alleen de demo-database; de eigen database heeft een andere naam en wordt hier nooit genoemd. */
async function deleteDemoDb(): Promise<void> {
  await deleteDB(DEMO_DB)
  forgetStorageLog(DEMO_DB)
}

async function seed<P extends CollectionPath>(store: Store, data: DemoData, path: P): Promise<void> {
  const records = data[path]
  if (records && records.length > 0) await store.putMany(path, records)
}

let networkAttempts = 0

/** Hoe vaak de GitHub-client van de demo iets probeerde te versturen (tests: altijd 0, want de demo-Store synct nooit). */
export function demoNetworkAttempts(): number {
  return networkAttempts
}

/** Een GitHub-client zonder netwerk: elk verzoek mislukt direct, zonder fetch. */
function offlineClient(): GithubClient {
  return new GithubClient('demo', () => {
    networkAttempts++
    return Promise.reject(new Error('demo: geen netwerk'))
  }, 'demo/demo')
}

interface DemoState {
  store: Store
  db: Db
  previousLang: Lang
}

let state: DemoState | null = null
let starting: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeDemo(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** De Store van de demo, of null als de demo niet loopt. */
export function demoStore(): Store | null {
  return state?.store ?? null
}

export function isDemo(): boolean {
  return state !== null
}

/** uit, start (gevraagd, nog niet klaar, ook na herladen) of aan; voor de weergave in App. */
export function demoPhase(): 'uit' | 'start' | 'aan' {
  return state ? 'aan' : demoWanted() ? 'start' : 'uit'
}

/** null = in dit venster nog niet gezet: dan geldt sessionStorage (na herladen tijdens de demo). */
let wanted: boolean | null = null

/** Moet de demo lopen (ook na herladen in dit tabblad)? */
export function demoWanted(): boolean {
  if (wanted !== null) return wanted
  try {
    return globalThis.sessionStorage?.getItem(WANTED_KEY) === '1'
  } catch {
    return false
  }
}

function setWanted(on: boolean): void {
  wanted = on
  try {
    if (on) globalThis.sessionStorage?.setItem(WANTED_KEY, '1')
    else globalThis.sessionStorage?.removeItem(WANTED_KEY)
  } catch {
    // Geen sessionStorage: dan stopt de demo bij herladen (en vraagt de app gewoon de wachtzin of hervat de sessie).
  }
  emit()
}

/** Demo starten: netwerk naar GitHub dicht, verse demo-database met voorbeelddata, Engels. */
export function startDemo(today: string = todayIso()): Promise<void> {
  if (state) return Promise.resolve()
  if (starting) return starting
  setWanted(true)
  blockNetwork(true)
  starting = (async () => {
    let db: Db | null = null
    let store: Store | null = null
    try {
      await deleteDemoDb()
      db = await openLogboekDb(DEMO_DB)
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      store = await Store.open(db, key, offlineClient(), null, { demo: true })
      const data = demoData(today)
      for (const path of COLLECTION_PATHS) await seed(store, data, path)
      // Intussen gestopt (vergrendeld): niet alsnog beginnen.
      if (!demoWanted()) throw new Error('demo gestopt')
      state = { store, db, previousLang: getLang() }
      setLang('en', false)
      emit()
    } catch (error) {
      store?.lock()
      db?.close()
      setWanted(false)
      blockNetwork(false)
      throw error
    }
  })().finally(() => {
    starting = null
  })
  return starting
}

/** Demo stoppen: eigen taal terug, demo-database weg, netwerk weer open. */
export async function stopDemo(): Promise<void> {
  setWanted(false)
  if (starting) await starting.catch(() => undefined)
  const current = state
  if (!current) {
    blockNetwork(false)
    emit()
    return
  }
  state = null
  // Een opslag in de demo die nog bezig is eerst laten afmaken (één schrijver), dan de demo-Store dicht (die heeft hoe
  // dan ook geen netwerk), dan het netwerk weer open voor de eigen Store, en pas dan de eigen gegevens en taal terug.
  await exclusive(DEMO_DB, 'lokaal', async () => undefined).catch(() => undefined)
  current.store.lock()
  blockNetwork(false)
  setLang(current.previousLang, false)
  emit()
  current.db.close()
  await deleteDemoDb().catch(() => undefined)
}
