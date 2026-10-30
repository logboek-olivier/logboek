import { APP_VERSION, BUILD_DATE, COMMIT } from '../build-info'

// Eén schrijver over versies heen. Elke pagina die start (laden of herladen), noteert zijn build in localStorage, die
// alle vensters van deze origin delen (het Chrome-tabblad en de geïnstalleerde app). Een venster dat ouder is dan de
// laatst gestarte build (het bleef op de achtergrond bevroren staan, of werd na een update nog niet herladen), schrijft
// niets meer naar GitHub en vraagt "Werk de app bij": de sync slaat dan over, en elke schrijfactie naar GitHub (ook vanuit
// herstellen, wachtzin wijzigen of de eerste keer) wordt vlak voor het versturen geweigerd. Een pagina die start, noteert
// zichzelf altijd: wordt er ooit een
// oudere versie uitgerold, dan start die gewoon als de geldende en sluit niemand zich buiten.

const KEY = 'logboek-gestarte-build'

/** De build van deze pagina, zoals in de commitberichten (in tests in te stellen met ownBuildForTests). */
let own = { build: `${APP_VERSION}+${COMMIT}`, date: BUILD_DATE }

/** Alleen voor tests: alsof deze pagina deze build is (zonder bouwdatum is er geen bewaking). */
export function ownBuildForTests(build: string, date: string): void {
  own = { build, date }
}

interface Started {
  build: string
  date: string
}

function read(): Started | null {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    return typeof r.build === 'string' && typeof r.date === 'string' ? { build: r.build, date: r.date } : null
  } catch {
    return null
  }
}

/** Bij het starten van de pagina: deze build is nu de geldende. Zonder bouwdatum (tests, dev) niets. */
export function noteStartedBuild(build = own.build, date = own.date): void {
  if (!date) return
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ build, date }))
  } catch {
    // Geen localStorage: dan geen bewaking over vensters heen.
  }
}

/**
 * Is er na deze pagina een nieuwere build gestart (in een ander venster of na een update)? Dan hoort dit venster niet
 * meer te schrijven. Een andere build van hetzelfde moment of ouder telt niet.
 */
export function newerBuildStarted(build = own.build, date = own.date): boolean {
  if (!date) return false
  const started = read()
  if (!started || started.build === build) return false
  const theirs = Date.parse(started.date)
  const mine = Date.parse(date)
  return Number.isFinite(theirs) && Number.isFinite(mine) && theirs > mine
}
