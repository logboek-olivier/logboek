import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import { useIsDemo } from '../components/DemoBar'
import type { Notify } from '../components/EditSheets'
import { SyncStatusLine, useSyncStatus } from '../components/SyncStatusLine'
import { backfillRates, getRates, loadRates, subscribeRates } from '../model/rates'
import { Toast, type ToastMessage } from '../components/Toast'
import { setScreen } from '../errors'
import { onNavigate } from '../navigation'
import { t } from '../i18n'
import type { Store } from '../storage/store'
import { todayIso, type AddTab } from '../model/types'
import { currentSettings } from '../model/settings'
import { SCREEN_FILES } from '../screen-files'
import { lazyComponent } from '../lazy'
import { BackToMore, More, type MoreScreen } from './More'
import type { AddInit } from './QuickAdd'
import { Today } from './Today'

// Vandaag laadt direct; de andere schermen pas als ze geopend worden (src/lazy.ts), zodat de app snel opent.
const Money = lazyComponent(() => import('./Money').then((m) => m.Money))
const QuickAdd = lazyComponent(() => import('./QuickAdd').then((m) => m.QuickAdd))
const Sailing = lazyComponent(() => import('./Sailing').then((m) => m.Sailing))
const Settings = lazyComponent(() => import('./Settings').then((m) => m.Settings))
const StudentArchive = lazyComponent(() => import('./StudentArchive').then((m) => m.StudentArchive))
const ThisWeek = lazyComponent(() => import('./ThisWeek').then((m) => m.ThisWeek))
const Courses = lazyComponent(() => import('./Courses').then((m) => m.Courses))
const Deadlines = lazyComponent(() => import('./Deadlines').then((m) => m.Deadlines))
const Boats = lazyComponent(() => import('./Boats').then((m) => m.Boats))
const Places = lazyComponent(() => import('./Places').then((m) => m.Places))
const Maps = lazyComponent(() => import('./Maps').then((m) => m.Maps))
const Goals = lazyComponent(() => import('./Goals').then((m) => m.Goals))
const Agenda = lazyComponent(() => import('./Agenda').then((m) => m.Agenda))
const Storage = lazyComponent(() => import('./Storage').then((m) => m.Storage))
const Stats = lazyComponent(() => import('./Stats').then((m) => m.Stats))

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
  kaarten: 'Kaarten',
  doelen: 'Doelen',
  cursussen: 'Cursussen',
  archief: 'Studentenarchief',
  instellingen: 'Instellingen',
  opslag: 'Opslag',
}


/**
 * Snelkoppeling op het app-icoon (?toevoegen=trip|dag|inkomsten|uitgave|skill): opent Toevoegen op dat tabblad. De parameter
 * verdwijnt direct uit de adresbalk, zodat verversen niet opnieuw Toevoegen opent.
 */
function shortcutTab(): AddTab | null {
  const value = new URLSearchParams(window.location.search).get('toevoegen')
  if (value === null) return null
  window.history.replaceState(null, '', window.location.pathname)
  return value === 'inkomsten' || value === 'uitgave' || value === 'dag' || value === 'trip' || value === 'skill' ? value : null
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
  // De checklist van een student, geopend vanuit het tripoverzicht (src/navigation.ts).
  const [archiveStudent, setArchiveStudent] = useState<string | undefined>(undefined)
  useEffect(
    () =>
      onNavigate((target) => {
        setArchiveStudent(target.studentId)
        setScreenState('archief')
        window.scrollTo(0, 0)
      }),
    [],
  )

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
  // Het vaargebied van de lopende trip vanzelf offline zetten (Meer → Kaarten), op de achtergrond; niet in de demo.
  const demo = useIsDemo()
  const tripsVersion = store.list('trips.json.enc').length + store.list('legs.json.enc').length
  useEffect(() => {
    if (demo) return
    // De gegevens nu lezen, nu de sessie open is: na het laden van de module kan de Store al vergrendeld zijn.
    let input: Parameters<typeof import('../model/offline-maps').offlineActiveTrip>
    try {
      input = [store.list('trips.json.enc'), store.list('legs.json.enc'), store.list('places.json.enc'), currentSettings(store.list('settings.json.enc')), todayIso()]
    } catch {
      return
    }
    void import('../model/offline-maps')
      .then((m) => m.offlineActiveTrip(...input))
      .catch(() => {
        // Kaarten offline zetten is een extraatje: een mislukte poging komt de volgende sessie terug.
      })
  }, [store, demo, tripsVersion])
  useEffect(() => {
    if (backfilled.current || !rates || !store.hasSynced()) return
    backfilled.current = true
    void backfillRates(store, rates)
  }, [store, rates, status])

  function select(next: Screen) {
    if (next !== 'toevoegen') setAddInit(undefined)
    setArchiveStudent(undefined)
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
      : screen === 'statistieken' || screen === 'doelen' || screen === 'geld' || screen === 'termijnen' || screen === 'boten' || screen === 'plaatsen' || screen === 'kaarten' || screen === 'cursussen' || screen === 'archief' || screen === 'instellingen' || screen === 'opslag'
        ? 'meer'
        : screen

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} files={SCREEN_FILES[screen]} onStorage={screen === 'opslag' ? undefined : () => select('opslag')} />
      <Suspense fallback={<ScreenLoading />}>
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
      {screen === 'doelen' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Goals store={store} notify={notify} />
        </>
      )}
      {screen === 'kaarten' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Maps />
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
          <StudentArchive key={archiveStudent ?? 'lijst'} store={store} notify={notify} openStudentId={archiveStudent} />
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
      </Suspense>
      <Toast message={toast} onDone={clearToast} />
      <BottomBar active={activeTab} onSelect={select} />
    </main>
  )
}

/** Een scherm dat nog laadt (meestal korter dan een tel): een rustig vlak, geen spinner die knippert. */
function ScreenLoading() {
  return <div className="screen-loading" aria-busy="true" />
}
