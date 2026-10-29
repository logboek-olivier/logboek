import { APP_VERSION, COMMIT } from '../build-info'
import { fromBase64, toBase64, type Bytes } from '../crypto/encrypt'
import { deviceId } from './device'

// Enige netwerkbestemming van de app: api.github.com (beveiligingsregel 2).
// Alles wat hier binnenkomt is al versleuteld; deze laag ziet alleen bytes.

export const API_BASE = 'https://api.github.com'
export const DATA_REPO = 'logboek-olivier/logboek-data'
const API_VERSION = '2022-11-28'
/** Een verzoek dat zo lang niets oplevert, telt als geen verbinding (anders blijft een sync op zee eeuwig hangen). */
const REQUEST_TIMEOUT_MS = 60_000
/** Een documentbestand uit de kluis (tot 20 MB, als base64 ruim 27 MB) krijgt langer. */
export const DOCUMENT_TIMEOUT_MS = 5 * 60_000

/** Soort GitHub-fout; de app toont hiervoor een vertaalde melding (zie describeError). */
export type GithubErrorCode = 'auth' | 'conflict' | 'rateLimit' | 'repoNotFound' | 'read' | 'write' | 'unexpected'

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: GithubErrorCode = 'unexpected',
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

/** Token ongeldig of geen toegang tot logboek-data. */
export class AuthError extends GithubError {
  constructor(status: number) {
    super('GitHub-token is ongeldig of heeft geen toegang', status, 'auth')
    this.name = 'AuthError'
  }
}

/** Iemand anders schreef het bestand tussen lezen en schrijven. */
export class ConflictError extends GithubError {
  constructor(status: number) {
    super('Bestand is ondertussen gewijzigd', status, 'conflict')
    this.name = 'ConflictError'
  }
}

/** Geen verbinding (fetch zelf faalde). */
export class NetworkError extends Error {
  constructor() {
    super('Geen verbinding')
    this.name = 'NetworkError'
  }
}

export interface RemoteFile {
  sha: string
  content: Bytes
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Een fine-grained token is 'github_pat_' plus base62; een klassieke token 'ghp_'. Alleen vorm, geen netwerk. */
export function looksLikeToken(token: string): boolean {
  return /^(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})$/.test(token.trim())
}

const EXPIRATION_HEADER = 'github-authentication-token-expiration'

/** "2026-11-24 12:00:00 UTC" of een ISO-tijd → jjjj-mm-dd; onleesbaar → null. */
export function parseExpirationHeader(value: string | null): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** De versie van deze build in commitberichten: versie uit package.json plus de korte commit-hash. */
export const BUILD = `${APP_VERSION}+${COMMIT}`

/**
 * Commitbericht in logboek-data: "sync <ISO-tijd> v<versie> d<apparaat-id>" (regel 9). Geen inhoud, geen namen: alleen
 * wanneer, welke versie van de app en welk apparaat (een willekeurig id), zodat na een storing te zien is wie schreef.
 */
export function commitMessage(now: Date = new Date(), build: string = BUILD, device: string = deviceId()): string {
  return `sync ${now.toISOString()} v${build} d${device}`
}

/** Wie een bestand het laatst schreef, uit het commitbericht. Oudere berichten ("sync <tijd>") hebben geen versie of apparaat. */
export interface CommitInfo {
  at: string | null
  version: string | null
  device: string | null
}

export function parseCommitMessage(message: string): CommitInfo {
  const m = /^sync (\S+)(?: v(\S+))?(?: d([0-9a-f]{8}))?\s*$/.exec(message.trim())
  if (!m) return { at: null, version: null, device: null }
  return { at: m[1] ?? null, version: m[2] ?? null, device: m[3] ?? null }
}

// Demomodus (src/demo.ts): zolang die loopt, gaat er geen enkel verzoek naar GitHub, van geen enkele client (ook niet
// van de eigen Store, die open blijft). Het verzoek komt niet eens bij fetch; de app ziet "geen verbinding".
let networkBlocked = false
// Verzoeken die al onderweg waren toen de blokkade begon, worden afgebroken (de app ziet "geen verbinding").
let blockController = new AbortController()

export function blockNetwork(on: boolean): void {
  if (on && !networkBlocked) blockController.abort()
  if (!on && networkBlocked) blockController = new AbortController()
  networkBlocked = on
}

export function isNetworkBlocked(): boolean {
  return networkBlocked
}

/** Stopt na 60 seconden (een documentbestand na 5 minuten), en direct als de demo begint (als de browser beide signalen kan combineren). */
function requestSignal(timeoutMs: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  if (typeof AbortSignal.any !== 'function') return timeout
  return AbortSignal.any(timeout ? [timeout, blockController.signal] : [blockController.signal])
}

export class GithubClient {
  /** Vervaldatum van de token (jjjj-mm-dd) als GitHub die in een antwoord meegaf en de browser de header mag lezen. */
  tokenExpiresAt: string | null = null

  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
    private readonly repo: string = DATA_REPO,
  ) {}

  private async request(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
    if (networkBlocked) throw new NetworkError()
    let response: Response
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        ...init,
        signal: requestSignal(timeoutMs),
        // Nooit uit de browsercache: GitHub stuurt max-age=60 mee, en een oudere versie van een net hersteld bestand
        // liet de app denken dat het nog onleesbaar was.
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
    } catch {
      throw new NetworkError()
    }
    const expiration = parseExpirationHeader(response.headers.get(EXPIRATION_HEADER))
    if (expiration) this.tokenExpiresAt = expiration
    if (response.status === 401) throw new AuthError(401)
    if (response.status === 403) {
      // Een 403 met uitgeputte rate limit is geen tokenfout.
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        throw new GithubError('GitHub-limiet bereikt; probeer later opnieuw', 403, 'rateLimit')
      }
      throw new AuthError(403)
    }
    return response
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new GithubError('Onverwacht antwoord', response.status)
    }
    if (!isRecord(body)) throw new GithubError('Onverwacht antwoord', response.status)
    return body
  }

  private decode(base64: string, status: number): Bytes {
    try {
      return fromBase64(base64)
    } catch {
      throw new GithubError('Onverwacht antwoord', status)
    }
  }

  /** Controleert dat de token de repo kan lezen. Geeft de vervaldatum van de token als die leesbaar is. */
  async checkAccess(): Promise<{ expiresAt: string | null }> {
    const response = await this.request(`/repos/${this.repo}`)
    if (!response.ok) throw new GithubError('Repo logboek-data niet gevonden', response.status, 'repoNotFound')
    return { expiresAt: this.tokenExpiresAt }
  }

  /** Haalt een bestand op; null als het niet bestaat. Een repo zonder commits geeft 404 of 409: ook "bestaat niet". */
  async getFile(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<RemoteFile | null> {
    const response = await this.request(`/repos/${this.repo}/contents/${encodePath(path)}`, {}, timeoutMs)
    if (response.status === 404 || response.status === 409) return null
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status, 'read')
    const body = await this.json(response)
    if (typeof body.sha !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    const base64 = typeof body.content === 'string' ? body.content.replace(/\s/g, '') : ''
    if (base64.length > 0) return { sha: body.sha, content: this.decode(base64, response.status) }
    // Boven 1 MB geeft de contents-API geen inhoud; dan via de blob-API.
    return { sha: body.sha, content: await this.getBlob(body.sha, timeoutMs) }
  }

  /** Alleen de SHA van een bestand (zonder de inhoud van een groot bestand op te halen); null als het niet bestaat. */
  async fileSha(path: string): Promise<string | null> {
    const response = await this.request(`/repos/${this.repo}/contents/${encodePath(path)}`)
    if (response.status === 404 || response.status === 409) return null
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status, 'read')
    const body = await this.json(response)
    if (typeof body.sha !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    return body.sha
  }

  private async getBlob(sha: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Bytes> {
    const response = await this.request(`/repos/${this.repo}/git/blobs/${sha}`, {}, timeoutMs)
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status, 'read')
    const body = await this.json(response)
    if (typeof body.content !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    return this.decode(body.content.replace(/\s/g, ''), response.status)
  }

  /**
   * De laatste commit die dit bestand raakte (voor Meer → Opslag: welke versie en welk apparaat schreef). Null als er
   * geen is; een fout of een antwoord dat er anders uitziet, geeft ook null (de controle zelf gaat door).
   */
  async lastCommit(path: string): Promise<CommitInfo | null> {
    const response = await this.request(`/repos/${this.repo}/commits?path=${encodeURIComponent(path)}&per_page=1`)
    if (!response.ok) return null
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return null
    }
    const first = Array.isArray(body) ? (body[0] as unknown) : null
    const commit = isRecord(first) && isRecord(first.commit) ? first.commit : null
    return commit && typeof commit.message === 'string' ? parseCommitMessage(commit.message) : null
  }

  /**
   * Schrijft een bestand. `sha` is de laatst bekende SHA (voorwaarde); null bij een nieuw bestand.
   * Bij een conflict (bestand ondertussen gewijzigd of ontstaan) volgt ConflictError.
   */
  async putFile(path: string, content: Bytes, sha: string | null, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
    const response = await this.request(
      `/repos/${this.repo}/contents/${encodePath(path)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: commitMessage(),
          content: toBase64(content),
          ...(sha ? { sha } : {}),
        }),
      },
      timeoutMs,
    )
    if (response.status === 409 || response.status === 422) throw new ConflictError(response.status)
    if (!response.ok) throw new GithubError('Schrijven mislukt', response.status, 'write')
    const body = await this.json(response)
    if (!isRecord(body.content) || typeof body.content.sha !== 'string') {
      throw new GithubError('Onverwacht antwoord', response.status)
    }
    return body.content.sha
  }

  /**
   * Verwijdert een bestand, met de SHA als voorwaarde (alleen voor documentbestanden van verwijderde documenten). Een
   * bestand dat er al niet meer staat, is goed; bij een conflict volgt ConflictError. De geschiedenis van de repo
   * houdt de versleutelde oude versie.
   */
  async deleteFile(path: string, sha: string): Promise<void> {
    const response = await this.request(`/repos/${this.repo}/contents/${encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: commitMessage(), sha }),
    })
    if (response.status === 404) return
    if (response.status === 409 || response.status === 422) throw new ConflictError(response.status)
    if (!response.ok) throw new GithubError('Schrijven mislukt', response.status, 'write')
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
