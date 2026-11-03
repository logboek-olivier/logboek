import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BottomBar, type Tab } from '../components/BottomBar'
import { useIsDemo } from '../components/DemoBar'
import type { Notify } from '../components/EditSheets'
import { SyncStatusLine, useSyncStatus } from '../components/SyncStatusLine'
import { getRates, loadRates } from '../model/rates'
import { Toast, type ToastMessage } from '../components/Toast'
import { recordError, setScreen } from '../errors'
import { onBack, useBack } from '../back'
import { onNavigate } from '../navigation'
import { t } from '../i18n'
import type { Store } from '../storage/store'
import { type AddTab } from '../model/types'
import { currentSettings } from '../model/settings'
import { SCREEN_FILES } from '../screen-files'
import { lazyComponent } from '../lazy'
import { BackToMore, More, type MoreScreen } from './More'
import type { AddInit } from './QuickAdd'
import { Today } from './Today'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { todayIso } from '../basis/datum'
import { organisationsFrom, setOrganisations } from '../basis/organisatie'
import { setCurriculumPacks } from '../model/curricula'
import { useCollection } from '../components/useCollection'

// Vandaag laadt direct; de andere schermen pas als ze geopend worden (src/lazy.ts), zodat de app snel opent.
const Money = lazyComponent(() => import('./Money').then((m) => m.Money))
const QuickAdd = lazyComponent(() => import('./QuickAdd').then((m) => m.QuickAdd))
const MoneyConversionScreen = lazyComponent(() => import('../components/MoneyConversion').then((m) => m.MoneyConversionScreen))
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
const Vault = lazyComponent(() => import('./Vault').then((m) => m.Vault))
const Career = lazyComponent(() => import('./Career').then((m) => m.Career))
const Accounts = lazyComponent(() => import('./Accounts').then((m) => m.Accounts))
const Agenda = lazyComponent(() => import('./Agenda').then((m) => m.Agenda))
const Storage = lazyComponent(() => import('./Storage').then((m) => m.Storage))
const Stats = lazyComponent(() => import('./Stats').then((m) => m.Stats))
const Review = lazyComponent(() => import('./Review').then((m) => m.Review))
const Trash = lazyComponent(() => import('./Trash').then((m) => m.Trash))
const HistoryScreen = lazyComponent(() => import('./History').then((m) => m.History))
const Periods = lazyComponent(() => import('./Periods').then((m) => m.Periods))

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
  kluis: 'Kluis',
  carriere: 'Carrière',
  rekeningen: 'Rekeningen',
  cursussen: 'Cursussen',
  archief: 'Studentenarchief',
  instellingen: 'Instellingen',
  opslag: 'Opslag',
  nakijken: 'Nakijken',
  prullenbak: 'Prullenbak',
  geschiedenis: 'Geschiedenis',
  periodes: 'Periodes',
}


/**
 * Snelkoppeling op het app-icoon (?toevoegen=trip|dag|inkomsten|uitgave|skill): opent Toevoegen op dat tabblad. De parameter
 * verdwijnt direct uit de adresbalk, zodat verversen niet opnieuw Toevoegen opent.
 */
function shortcutTab(): AddTab | null {
  const value = new URLSearchParams(window.location.search).get('toevoegen')
  if (value === null) return null
  window.history.replaceState(window.history.state, '', window.location.pathname)
  return value === 'inkomsten' || value === 'uitgave' || value === 'dag' || value === 'trip' || value === 'skill' ? value : null
}

export function Home({ store }: { store: Store }) {
  // Organisaties en cursuspakketten van dit logboek (src/basis/organisatie.ts): vóór de schermen, bij elke wijziging.
  const settingsRecords = useCollection(store, 'settings.json.enc')
  useMemo(() => {
    const settings = currentSettings(settingsRecords)
    setOrganisations(organisationsFrom(settings))
    setCurriculumPacks(Array.isArray(settings.curriculumPacks) ? settings.curriculumPacks : settings.startedEmpty ? [] : null)
  }, [settingsRecords])
  const [shortcut] = useState(shortcutTab)
  const [screen, setScreenState] = useState<Screen>('vandaag')
  const screenNow = useRef(screen)
  screenNow.current = screen
  const [toast, setToast] = useState<ToastMessage | null>(null)
  // Toevoegen is een laag over het scherm waar Olivier was: dat scherm (met open bladen) blijft staan, en na Opslaan of
  // terug is hij er weer (CLAUDE.md, Schermen: Toevoegen).
  const [adding, setAdding] = useState<{ init?: AddInit; tab: AddTab; key: number } | null>(shortcut ? { tab: shortcut, key: 0 } : null)
  const scrollBefore = useRef(0)
  // Het Logboek staat onder Meer en is ook vanuit de Agenda te openen; terug gaat naar waar het vandaan kwam.
  const [logbookFrom, setLogbookFrom] = useState<'meer' | 'agenda'>('meer')
  const counter = useRef(0)
  const clearToast = useCallback(() => setToast(null), [])
  // De checklist van een student, geopend vanuit het tripoverzicht (src/navigation.ts).
  const [archiveStudent, setArchiveStudent] = useState<string | undefined>(undefined)
  useEffect(
    () =>
      onNavigate((target) => {
        if (target.kind === 'toevoegen') {
          openAdd(target.init, target.tab)
          return
        }
        if (target.kind === 'opslag' || target.kind === 'nakijken' || target.kind === 'geld') {
          if (screenNow.current !== target.kind) remember(screenNow.current)
          setScreenState(target.kind)
          window.scrollTo(0, 0)
          return
        }
        if (screenNow.current !== 'archief') remember(screenNow.current)
        setArchiveStudent(target.studentId)
        setScreenState('archief')
        window.scrollTo(0, 0)
      }),
    [],
  )

  const notify: Notify = useCallback((text, undo, options) => {
    counter.current++
    setToast({
      id: counter.current,
      text,
      action: undo ? { label: t('common.undo'), run: () => void undo() } : undefined,
      long: options?.long,
    })
  }, [])

  setScreen(SCREEN_NAMES[adding ? 'toevoegen' : screen])

  // Wisselkoersen (public/rates.json, zelfde origin) één keer per sessie laden. Bedragen worden ermee omgerekend bij het
  // tonen; de app schrijft ze nooit vanzelf bij bestaande transacties.
  const status = useSyncStatus(store)
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
  // Periodemodel: de agenda en het geld één keer omzetten, na de eerste geslaagde sync (src/model/migrate-periods.ts).
  const migrating = useRef(false)
  useEffect(() => {
    if (migrating.current || demo || !store.hasSynced()) return
    migrating.current = true
    // De opdrachten pas laden als ze nodig zijn (snel openen: alleen Vandaag laadt direct).
    void Promise.all([import('../domain/agenda'), import('../domain/prullenbak')])
      .then(async ([agenda, prullenbak]) => {
        // Alleen een noodzakelijke omzetting van het dataformaat (één keer) en opruimen na 30 dagen (regel 14). Verder
        // verandert de app niets zonder een tik (CLAUDE.md, uitgangspunt 5).
        await agenda.periodemodelMigreren(store)
        // Na 30 dagen definitief: de geschiedenis en de prullenbak verliezen hun inhoud.
        await prullenbak.geschiedenisOpruimen(store)
      })
      .catch((error: unknown) => {
        recordError(error)
        // De proef op een kopie zag dat een automatische stap een koppeling of regel zou breken: er is niets geschreven
        // (src/domain/relaties.ts). Dat staat in beeld, met de foutdetails; pas de volgende sessie opnieuw (geen lus).
        if (error instanceof Error && (error.name === 'RelationError' || error.name === 'InvariantError')) {
          setBlocked(true)
          return
        }
        // Lukt het nu niet om een andere reden (bijvoorbeeld vergrendeld), dan de volgende keer opnieuw.
        migrating.current = false
      })
  }, [store, status, demo])
  const [blocked, setBlocked] = useState(false)
  // Geld omzetten (eenmalig na de update, src/domain/geld-omzetten.ts): na de eerste geslaagde sync één keer per sessie
  // het scherm, met "Later". Geld toont het tot het geld omgezet is. Pas na een tik verandert er iets.
  const conversionAsked = useRef(false)
  const [conversion, setConversion] = useState(false)
  useEffect(() => {
    if (conversionAsked.current || demo || !store.hasSynced()) return
    conversionAsked.current = true
    void import('../domain/geld-omzetten')
      .then((m) => {
        if (m.needsMoneyConversion(store)) setConversion(true)
      })
      .catch(recordError)
  }, [store, status, demo])

  // De weg terug voor de terugknop van Android (src/back.ts): de schermen waar Olivier vandaan kwam, elk een stap terug.
  // Vandaag is het begin; teruggaan naar het vorige scherm (ook met "‹ Meer") haalt het van de weg af.
  const trail = useRef<{ screen: Screen; off: () => void }[]>([])

  function show(next: Screen) {
    setArchiveStudent(undefined)
    setScreenState(next)
    window.scrollTo(0, 0)
  }

  function remember(from: Screen) {
    const entry = { screen: from, off: () => {} }
    entry.off = onBack(() => {
      trail.current = trail.current.filter((e) => e !== entry)
      show(entry.screen)
    })
    trail.current.push(entry)
    while (trail.current.length > 20) trail.current.shift()!.off()
  }

  function select(next: Screen) {
    if (next === 'toevoegen') {
      openAdd()
      return
    }
    // Een tabblad kiezen terwijl Toevoegen open is: Toevoegen gaat dicht, zonder op te slaan.
    setAdding(null)
    if (next === 'logboek' && screen !== 'agenda') setLogbookFrom('meer')
    if (next === 'vandaag') {
      for (const entry of trail.current) entry.off()
      trail.current = []
    } else if (trail.current.at(-1)?.screen === next) trail.current.pop()!.off()
    else if (next !== screen) remember(screen)
    show(next)
  }

  function openAdd(init?: AddInit, tab: AddTab = 'dag') {
    scrollBefore.current = window.scrollY
    setAdding({ init, tab: init ? 'dag' : tab, key: ++counter.current })
    window.scrollTo(0, 0)
  }

  // Na Opslaan, of terug (ook de terugknop van Android): weer op het scherm en de plek waar Olivier was.
  function closeAdd() {
    setAdding(null)
    const y = scrollBefore.current
    requestAnimationFrame(() => window.scrollTo(0, y))
  }
  useBack(!!adding, closeAdd)
  // Een open blad eronder zet de pagina vast (body.sheet-open); Toevoegen moet wel kunnen scrollen.
  useEffect(() => {
    document.body.classList.toggle('adding', !!adding)
  }, [adding])

  function done(message: string) {
    notify(message)
    closeAdd()
  }

  const activeTab: Tab = adding
    ? 'toevoegen'
    : screen === 'logboek'
      ? logbookFrom
      : screen === 'statistieken' || screen === 'doelen' || screen === 'carriere' || screen === 'rekeningen' || screen === 'kluis' || screen === 'geld' || screen === 'termijnen' || screen === 'boten' || screen === 'plaatsen' || screen === 'kaarten' || screen === 'cursussen' || screen === 'archief' || screen === 'instellingen' || screen === 'opslag' || screen === 'nakijken' || screen === 'periodes' || screen === 'prullenbak' || screen === 'geschiedenis'
        ? 'meer'
        : screen

  return (
    <main className="app with-bar">
      <SyncStatusLine store={store} files={SCREEN_FILES[adding ? 'toevoegen' : screen]} onStorage={screen === 'opslag' && !adding ? undefined : () => select('opslag')} />
      {blocked && (
        <div className="notice auto-blocked" role="alert">
          <p>{t('auto.blocked')}</p>
          <CopyErrorDetails />
          <button type="button" className="btn link small" onClick={() => setBlocked(false)}>
            {t('common.close')}
          </button>
        </div>
      )}
      {conversion && !adding && (
        <section className="add-layer">
          <Suspense fallback={<ScreenLoading />}>
            <MoneyConversionScreen store={store} notify={notify} onLater={() => setConversion(false)} />
          </Suspense>
        </section>
      )}
      {adding && (
        <section className="add-layer">
          <BackToMore onBack={closeAdd} to="common.back" />
          <Suspense fallback={<ScreenLoading />}>
            <QuickAdd key={adding.key} store={store} onDone={done} init={adding.init} notify={notify} tab={adding.tab} />
          </Suspense>
        </section>
      )}
      <Suspense fallback={<ScreenLoading />}>
      <div className="screen" hidden={!!adding || conversion}>
      {screen === 'vandaag' && (
        <Today store={store} notify={notify} onSettings={() => select('instellingen')} onAdd={(init) => openAdd(init)} onReminders={() => select('termijnen')} onReview={() => select('nakijken')} />
      )}
      {screen === 'week' && (
        <ThisWeek
          store={store}
          notify={notify}
        />
      )}
      {screen === 'agenda' && (
        <Agenda
          store={store}
          notify={notify}
          onAdd={(init) => openAdd(init)}
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
      {screen === 'meer' && <More store={store} onOpen={select} />}
      {screen === 'geld' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Money store={store} notify={notify} onAdd={() => openAdd(undefined, 'inkomsten')} />
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
      {screen === 'carriere' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Career store={store} notify={notify} />
        </>
      )}
      {screen === 'rekeningen' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Accounts store={store} notify={notify} />
        </>
      )}
      {screen === 'kluis' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Vault store={store} notify={notify} />
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
      {screen === 'periodes' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Periods
            store={store}
            notify={notify}
          />
        </>
      )}
      {screen === 'nakijken' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Review store={store} notify={notify} />
        </>
      )}
      {screen === 'geschiedenis' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <HistoryScreen store={store} notify={notify} />
        </>
      )}
      {screen === 'prullenbak' && (
        <>
          <BackToMore onBack={() => select('meer')} />
          <Trash store={store} notify={notify} />
        </>
      )}
      </div>
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
