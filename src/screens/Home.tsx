import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import type { Notify } from '../components/EditSheets'
import { SyncStatusLine, useSyncStatus } from '../components/SyncStatusLine'
import { backfillRates, getRates, loadRates, subscribeRates } from '../model/rates'
import { Toast, type ToastMessage } from '../components/Toast'
import { setScreen } from '../errors'
import { t } from '../i18n'
import type { Store } from '../storage/store'
import type { AddTab } from '../model/types'
import { SCREEN_FILES } from '../screen-files'
import { Money } from './Money'
import { BackToMore, More, type MoreScreen } from './More'
import { QuickAdd, type AddInit } from './QuickAdd'
import { Sailing } from './Sailing'
import { Settings } from './Settings'
import { StudentArchive } from './StudentArchive'
import { ThisWeek } from './ThisWeek'
import { Today } from './Today'
import { Courses } from './Courses'
import { Deadlines } from './Deadlines'
import { Boats } from './Boats'
import { Places } from './Places'
import { Agenda } from './Agenda'
import { Storage } from './Storage'
import { Stats } from './Stats'

// Ontgrendelde app: sync-status bovenaan, onderste balk Vandaag · Deze trip · + · Logboek · Meer.
// Geld, Cursussen, Studentenarchief en Instellingen zitten onder Meer.

type Screen = Tab | MoreScreen

const SCREEN_NAMES: Record<Screen, string> = {
  vandaag: 'Vandaag',
  week: 'Deze trip',
  toevoegen: 'Toevoegen',
  agenda: 'Agenda',
  logboek: 'Logboek',
  meer: 'Meer',
  statistieken: 'Statistieken',
  geld: 'Geld',
  termijnen: 'Termijnen',
  boten: 'Boten',
  plaatsen: 'Plaatsen',
  cursussen: 'Cursussen',
  archief: 'Studentenarchief',
  instellingen: 'Instellingen',
  opslag: 'Opslag',
}


/**
 * Snelkoppeling op het app-icoon (?toevoegen=trip|dag|inkomsten|uitgave): opent Toevoegen op dat tabblad. De parameter
 * verdwijnt direct uit de adresbalk, zodat verversen niet opnieuw Toevoegen opent.
 */
function shortcutTab(): AddTab | null {
  const value = new URLSearchParams(window.location.search).get('toevoegen')
  if (value === null) return null
  window.history.replaceState(null, '', window.location.pathname)
  return value === 'inkomsten' || value === 'uitgave' || value === 'dag' || value === 'trip' ? value : null
}

export function Home({ store }: { store: Store }) {
  const [shortcut] = useState(shortcutTab)
  const [screen, setScreenState] = useState<Screen>(shortcut ? 'toevoegen' : 'vandaag')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [addInit, setAddInit] = useState<AddInit | undefined>(undefined)
  // Het Logboek staat onder Meer en is ook vanuit de Agenda te openen; terug gaat naar waar het vandaan kwam.
  const [logbookFrom, setLogbookFrom] = useState<'meer' | 'agenda'>('meer')
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
    if (next === 'logboek' && screen !== 'agenda') setLogbookFrom('meer')
    setScreenState(next)
    window.scrollTo(0, 0)
  }

  function done(message: string) {
    notify(message)
    select('vandaag')
  }

  const activeTab: Tab =
    screen === 'logboek'
      ? logbookFrom
      : screen === 'statistieken' || screen === 'geld' || screen === 'termijnen' || screen === 'boten' || screen === 'plaatsen' || screen === 'cursussen' || screen === 'archief' || screen === 'instellingen' || screen === 'opslag'
        ? 'meer'
        : screen

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} files={SCREEN_FILES[screen]} onStorage={screen === 'opslag' ? undefined : () => select('opslag')} />
      {screen === 'vandaag' && (
        <Today store={store} notify={notify} onSettings={() => select('instellingen')} onAdd={(init) => {
            select('toevoegen')
            setAddInit(init)
          }} onReminders={() => select('termijnen')} />
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
      {screen === 'agenda' && (
        <Agenda
          store={store}
          notify={notify}
          onAdd={(init) => {
            select('toevoegen')
            setAddInit(init)
          }}
          onLogbook={() => {
            setLogbookFrom('agenda')
            select('logboek')
          }}
        />
      )}
      {screen === 'logboek' && (
        <>
          <BackToMore onBack={() => select(logbookFrom)} to={logbookFrom === 'agenda' ? 'nav.calendar' : 'nav.more'} />
          <Sailing store={store} notify={notify} />
        </>
      )}
      {screen === 'toevoegen' && <QuickAdd key={addInit ? `${addInit.date}-${addInit.tripId ?? ''}-${addInit.from ?? ''}-${addInit.to ?? ''}` : 'nieuw'} store={store} onDone={done} init={addInit} notify={notify} tab={addInit ? 'dag' : (shortcut ?? 'dag')} />}
      {screen === 'meer' && <More onOpen={select} />}
      {screen === 'geld' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Money store={store} notify={notify} onAdd={() => select('toevoegen')} />
        </>
      )}
      {screen === 'termijnen' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Deadlines store={store} notify={notify} onToken={() => select('instellingen')} />
        </>
      )}
      {screen === 'boten' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Boats store={store} notify={notify} />
        </>
      )}
      {screen === 'plaatsen' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Places store={store} notify={notify} />
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
      {screen === 'statistieken' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Stats store={store} />
        </>
      )}
      {screen === 'opslag' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Storage store={store} notify={notify} />
        </>
      )}
      <Toast message={toast} onDone={clearToast} />
      <BottomBar active={activeTab} onSelect={select} />
    </main>
  )
}
