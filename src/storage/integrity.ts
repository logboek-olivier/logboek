import type { Bytes } from '../crypto/encrypt'

// Controle of GitHub (of iets daartussen) precies de bytes teruggaf die bij een sha horen. Git noemt een bestand naar
// de SHA-1 van "blob <lengte>\0<inhoud>"; de contents-API geeft die sha mee. Klopt de ontvangen inhoud niet met de sha,
// dan is het antwoord niet te vertrouwen (een tussenliggende cache, een afgekapt antwoord) en haalt de app de inhoud
// opnieuw op via de blob-API, die per sha onveranderlijk is. Zonder inhoud in logs: alleen pad, tijd en soort.

const encoder = new TextEncoder()

/** Een git-sha zoals GitHub die geeft (40 hexadecimale tekens); tests met nagebootste sha's slaan de controle over. */
export function isGitSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/.test(sha)
}

/** De git-blob-sha van deze bytes: SHA-1 van "blob <lengte>\0<inhoud>", hexadecimaal. */
export async function gitBlobSha(bytes: Bytes): Promise<string> {
  const header = encoder.encode(`blob ${bytes.length}\0`)
  const all = new Uint8Array(header.length + bytes.length)
  all.set(header)
  all.set(bytes, header.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Klopt `bytes` met `sha`? Een sha die geen git-sha is (nagebootst in tests), telt als in orde. */
export async function matchesSha(bytes: Bytes, sha: string): Promise<boolean> {
  return !isGitSha(sha) || (await gitBlobSha(bytes)) === sha
}

/** Wat er niet klopte: bij lezen (opnieuw opgehaald via de blob-API, wel of niet gelukt) of bij schrijven. */
export interface IntegrityEvent {
  at: string
  path: string
  phase: 'lezen' | 'schrijven'
  /** Bij lezen: de blob-API gaf daarna wel de juiste inhoud. */
  repaired: boolean
}

const events: IntegrityEvent[] = []
const listeners = new Set<(event: IntegrityEvent) => void>()

export function recordIntegrity(event: IntegrityEvent): void {
  events.push(event)
  if (events.length > 20) events.shift()
  for (const l of listeners) l(event)
}

export function integrityEvents(): readonly IntegrityEvent[] {
  return events
}

export function onIntegrity(listener: (event: IntegrityEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
