import { APP_VERSION, BUILD_DATE, COMMIT } from './build-info'

// Foutdetails om in een cloud-sessie te plakken: app-versie, scherm, foutcode en stacktrace. Nooit inhoud zoals
// bedragen, plaatsen of namen (beveiligingsregel 9): meldingen worden geschoond, tekst tussen aanhalingstekens en
// getallen met decimalen vallen weg, en de stack bevat alleen bestandsnamen en regelnummers van de app.

let currentScreen = 'Laden'
let last: { error: unknown; screen: string; at: string } | null = null
const listeners = new Set<() => void>()

/** Naam van het zichtbare scherm, voor de foutdetails. */
export function setScreen(name: string): void {
  currentScreen = name
}

export function recordError(error: unknown): void {
  last = { error, screen: currentScreen, at: new Date().toISOString() }
  for (const l of listeners) l()
}

export function clearError(): void {
  last = null
  for (const l of listeners) l()
}

export function lastError(): { error: unknown; screen: string; at: string } | null {
  return last
}

export function subscribeErrors(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Foutcode: naam van de fout, met HTTP-status als die er is (bijvoorbeeld "GithubError 422"). */
export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status
    return typeof status === 'number' ? `${error.name} ${status}` : error.name
  }
  return typeof error
}

/** Haalt mogelijke inhoud uit een melding of stackregel. */
export function sanitize(text: string): string {
  return text
    .replace(/"[^"\n]*"/g, '"…"')
    .replace(/'([^'\n]*)'/g, (whole, inner: string) => (/^[A-Za-z_$][\w$]{0,40}$/.test(inner) ? whole : "'…'"))
    .replace(/`[^`\n]*`/g, '`…`')
    .replace(/\d+[.,]\d+/g, '#')
    .slice(0, 300)
}

function stackFrames(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return []
  return error.stack
    .split('\n')
    .filter((line) => /^\s*at\s/.test(line) || /@.+:\d+:\d+\s*$/.test(line))
    .slice(0, 15)
    .map((line) => `  ${sanitize(line.trim())}`)
}

/** Alleen browser- en systeemversie, geen andere details van het apparaat. */
function browser(userAgent: string): string {
  const chrome = /(Chrome|Firefox|Version)\/(\d+)/.exec(userAgent)
  const os = [/Android \d+/, /iPhone OS \d+/, /Windows NT [\d.]+/, /Mac OS X [\d_]+/, /Linux/].map((r) => r.exec(userAgent)).find(Boolean)
  const name = chrome ? `${chrome[1] === 'Version' ? 'Safari' : chrome[1]} ${chrome[2]}` : 'onbekend'
  return `${name}${os ? ` / ${os[0]}` : ''}`
}

export function errorReport(error: unknown, screen: string, at: string, userAgent = globalThis.navigator?.userAgent ?? ''): string {
  const message = error instanceof Error ? sanitize(error.message) : ''
  const lines = [
    'Logboek-foutdetails',
    `Versie: ${APP_VERSION} (${COMMIT}${BUILD_DATE ? `, gebouwd ${BUILD_DATE.slice(0, 10)}` : ''})`,
    `Scherm: ${screen}`,
    `Tijd: ${at}`,
    `Foutcode: ${errorCode(error)}`,
  ]
  if (message) lines.push(`Melding: ${message}`)
  lines.push(`Browser: ${browser(userAgent)}`)
  const frames = stackFrames(error)
  if (frames.length > 0) lines.push('Stack:', ...frames)
  return lines.join('\n')
}

/** Fouten die alleen betekenen dat Olivier iets verkeerd typte; daar hoort geen knop "Kopieer foutdetails" bij. */
export function isUserMistake(error: unknown): boolean {
  return error instanceof Error && (error.name === 'WrongSecretError' || error.name === 'RecoveryCodeError')
}
