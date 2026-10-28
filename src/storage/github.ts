import { fromBase64, toBase64, type Bytes } from '../crypto/encrypt'

// Enige netwerkbestemming van de app: api.github.com (beveiligingsregel 2).
// Alles wat hier binnenkomt is al versleuteld; deze laag ziet alleen bytes.

export const API_BASE = 'https://api.github.com'
export const DATA_REPO = 'logboek-olivier/logboek-data'
const API_VERSION = '2022-11-28'

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

export class GithubClient {
  /** Vervaldatum van de token (jjjj-mm-dd) als GitHub die in een antwoord meegaf en de browser de header mag lezen. */
  tokenExpiresAt: string | null = null

  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
    private readonly repo: string = DATA_REPO,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        ...init,
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
  async getFile(path: string): Promise<RemoteFile | null> {
    const response = await this.request(`/repos/${this.repo}/contents/${encodePath(path)}`)
    if (response.status === 404 || response.status === 409) return null
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status, 'read')
    const body = await this.json(response)
    if (typeof body.sha !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    const base64 = typeof body.content === 'string' ? body.content.replace(/\s/g, '') : ''
    if (base64.length > 0) return { sha: body.sha, content: this.decode(base64, response.status) }
    // Boven 1 MB geeft de contents-API geen inhoud; dan via de blob-API.
    return { sha: body.sha, content: await this.getBlob(body.sha) }
  }

  private async getBlob(sha: string): Promise<Bytes> {
    const response = await this.request(`/repos/${this.repo}/git/blobs/${sha}`)
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status, 'read')
    const body = await this.json(response)
    if (typeof body.content !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    return this.decode(body.content.replace(/\s/g, ''), response.status)
  }

  /**
   * Schrijft een bestand. `sha` is de laatst bekende SHA (voorwaarde); null bij een nieuw bestand.
   * Bij een conflict (bestand ondertussen gewijzigd of ontstaan) volgt ConflictError.
   */
  async putFile(path: string, content: Bytes, sha: string | null): Promise<string> {
    const response = await this.request(`/repos/${this.repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `sync ${new Date().toISOString()}`,
        content: toBase64(content),
        ...(sha ? { sha } : {}),
      }),
    })
    if (response.status === 409 || response.status === 422) throw new ConflictError(response.status)
    if (!response.ok) throw new GithubError('Schrijven mislukt', response.status, 'write')
    const body = await this.json(response)
    if (!isRecord(body.content) || typeof body.content.sha !== 'string') {
      throw new GithubError('Onverwacht antwoord', response.status)
    }
    return body.content.sha
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
