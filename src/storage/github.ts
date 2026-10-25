import { fromBase64, toBase64, type Bytes } from '../crypto/encrypt'

// Enige netwerkbestemming van de app: api.github.com (beveiligingsregel 2).
// Alles wat hier binnenkomt is al versleuteld; deze laag ziet alleen bytes.

export const API_BASE = 'https://api.github.com'
export const DATA_REPO = 'logboek-olivier/logboek-data'
const API_VERSION = '2022-11-28'

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

/** Token ongeldig of geen toegang tot logboek-data. */
export class AuthError extends GithubError {
  constructor(status: number) {
    super('GitHub-token is ongeldig of heeft geen toegang', status)
    this.name = 'AuthError'
  }
}

/** Iemand anders schreef het bestand tussen lezen en schrijven. */
export class ConflictError extends GithubError {
  constructor(status: number) {
    super('Bestand is ondertussen gewijzigd', status)
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

export class GithubClient {
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
    if (response.status === 401 || response.status === 403) throw new AuthError(response.status)
    return response
  }

  /** Controleert dat de token de repo kan lezen. */
  async checkAccess(): Promise<void> {
    const response = await this.request(`/repos/${this.repo}`)
    if (!response.ok) throw new GithubError('Repo logboek-data niet gevonden', response.status)
  }

  /** Haalt een bestand op; null als het niet bestaat. */
  async getFile(path: string): Promise<RemoteFile | null> {
    const response = await this.request(`/repos/${this.repo}/contents/${encodePath(path)}`)
    if (response.status === 404) return null
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status)
    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.sha !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    const base64 = typeof body.content === 'string' ? body.content.replace(/\s/g, '') : ''
    if (base64.length > 0) return { sha: body.sha, content: fromBase64(base64) }
    // Boven 1 MB geeft de contents-API geen inhoud; dan via de blob-API.
    return { sha: body.sha, content: await this.getBlob(body.sha) }
  }

  private async getBlob(sha: string): Promise<Bytes> {
    const response = await this.request(`/repos/${this.repo}/git/blobs/${sha}`)
    if (!response.ok) throw new GithubError('Lezen mislukt', response.status)
    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.content !== 'string') throw new GithubError('Onverwacht antwoord', response.status)
    return fromBase64(body.content.replace(/\s/g, ''))
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
    if (!response.ok) throw new GithubError('Schrijven mislukt', response.status)
    const body: unknown = await response.json()
    if (!isRecord(body) || !isRecord(body.content) || typeof body.content.sha !== 'string') {
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
