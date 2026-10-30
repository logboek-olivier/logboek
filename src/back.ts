import { useEffect, useRef, useSyncExternalStore } from 'react'

// De terugknop en het terugveeggebaar van Android: altijd één stap terug in de app, nooit onverwacht afsluiten.
//
// Elke open stap (een onderblad, een scherm in een scherm zoals een cursus of planning, een vorig scherm of tabblad)
// heeft één eigen item in de geschiedenis, plus één "bewaker" eronder. Terug haalt het bovenste item weg en sluit de
// bovenste stap. Sluit een stap op een andere manier (Opslaan, het kruisje, een tabblad), dan haalt de app zijn item
// zelf weg. Is er niets meer open en gaat de bewaker weg (Vandaag zonder blad, of het ontgrendelscherm), dan staat er
// "Nog een keer terug om te sluiten": pas nog een keer terug verlaat de app; een tik zet de bewaker terug.
//
// Een item komt er alleen bij als er iets opengaat, nooit als antwoord op terug: Chrome slaat bij de terugknop items
// over die een pagina zonder tik ertussen toevoegt, en dan zou de app na twee keer snel terug toch sluiten.

/** Een stap terug sluiten. */
export type BackHandler = () => void

interface Level {
  close: BackHandler
}

/** De open stappen, onderste eerst; de bovenste sluit bij terug. */
const levels: Level[] = []
const STATE_KEY = 'logboekTerug'

let installed = false
/** Hoeveel items van de app boven het eerste item staan (0 = geen bewaker). */
let depth = 0
/** Een eigen history.go loopt nog (het popstate daarvan is geen terug van Olivier). */
let going = false
/** "Nog een keer terug om te sluiten" staat in beeld; de bewaker is weg. */
let armed = false
let scheduled = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function depthOf(state: unknown): number {
  const value = (state as Record<string, unknown> | null)?.[STATE_KEY]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

/** De geschiedenis gelijk trekken met de open stappen: items erbij (na het openen) of eraf (na sluiten in de app). */
function sync(): void {
  scheduled = false
  if (!installed || going) return
  const want = (armed ? 0 : 1) + levels.length
  if (want > depth) {
    for (let d = depth + 1; d <= want; d++) window.history.pushState({ [STATE_KEY]: d }, '')
    depth = want
  } else if (want < depth) {
    going = true
    window.history.go(want - depth)
  }
}

function schedule(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(sync)
}

/** Een stap aanmelden die bij terug sluit; geeft een functie die hem weer afmeldt (na sluiten in de app). */
export function onBack(close: BackHandler): () => void {
  const level: Level = { close }
  levels.push(level)
  if (armed) {
    armed = false
    emit()
  }
  schedule()
  return () => {
    const i = levels.indexOf(level)
    if (i < 0) return
    levels.splice(i, 1)
    schedule()
  }
}

/** Zolang `active`: terug roept `close` aan (een open blad, een scherm in een scherm). */
export function useBack(active: boolean, close: () => void): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!active) return
    return onBack(() => latest.current())
  }, [active])
}

/** Staat "Nog een keer terug om te sluiten" nu in beeld? */
export function useExitHint(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => armed,
  )
}

function onPopState(event: PopStateEvent): void {
  const now = depthOf(event.state)
  if (going) {
    // Het eigen history.go is klaar; daarna opnieuw gelijk trekken (er kan intussen iets veranderd zijn).
    going = false
    depth = now
    sync()
    return
  }
  if (now >= depth) {
    depth = now
    sync()
    return
  }
  // Terug: zoveel stappen als er items weg zijn (normaal één), de bovenste eerst. Een stap die terug sloot, telt niet
  // meer mee, ook als zijn afmelden pas later komt.
  let steps = depth - now
  depth = now
  while (steps > 0 && levels.length > 0) {
    steps--
    levels.pop()!.close()
  }
  if (now === 0) {
    armed = true
    emit()
  }
}

/** Na een tik of toets: de melding weg en de bewaker terug (een tik mag een item toevoegen). */
function onActivity(): void {
  if (!armed) return
  armed = false
  emit()
  schedule()
}

/** Eén keer bij het starten: de bewaker in de geschiedenis en het luisteren naar terug. */
export function installBack(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  depth = depthOf(window.history.state)
  window.addEventListener('popstate', onPopState)
  window.addEventListener('pointerup', onActivity, { capture: true })
  window.addEventListener('keydown', onActivity, { capture: true })
  sync()
}
