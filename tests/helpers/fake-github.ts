import type { FetchLike } from '../../src/storage/github'

// Nagebootste api.github.com (contents-API) in het geheugen. Houdt elk request bij, zodat tests kunnen
// controleren dat er nooit onversleutelde inhoud over de lijn gaat.

export interface LoggedRequest {
  method: string
  url: string
  body: string | null
}

interface StoredFile {
  sha: string
  content: string
}

const REPO = 'logboek-olivier/logboek-data'

export class FakeGithub {
  readonly files = new Map<string, StoredFile>()
  /** sha → base64, voor de blob-API. */
  readonly blobs = new Map<string, string>()
  readonly requests: LoggedRequest[] = []
  offline = false
  /** Antwoordstatus voor elk request, bijvoorbeeld 401 om een ongeldige token na te bootsen. */
  forceStatus: number | null = null
  forceHeaders: Record<string, string> = {}
  /** Statussen van alle antwoorden, in volgorde. */
  readonly statuses: number[] = []
  /** Wordt vóór elk request afgewacht; handig om een sync op te houden. */
  gate: Promise<void> | null = null
  /** Wordt vlak vóór elke PUT aangeroepen; handig om een gelijktijdige schrijver na te bootsen. */
  beforePut: ((path: string) => void) | null = null
  private shaCounter = 0

  /** Schrijft direct in de nagebootste repo, zoals een ander apparaat dat zou doen. */
  write(path: string, base64: string): string {
    const sha = `sha-${++this.shaCounter}`
    this.files.set(path, { sha, content: base64 })
    this.blobs.set(sha, base64)
    return sha
  }

  readonly fetch: FetchLike = async (url, init) => {
    if (this.gate) await this.gate
    const response = await this.handle(url, init)
    this.statuses.push(response.status)
    return response
  }

  private async handle(url: string, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? init.body : null
    this.requests.push({ method, url, body })
    if (this.offline) throw new TypeError('Failed to fetch')
    if (this.forceStatus !== null) return json(this.forceStatus, { message: 'nagebootste fout' }, this.forceHeaders)
    const headers = init.headers as Record<string, string>
    if (!headers.Authorization?.startsWith('Bearer ')) return json(401, { message: 'Requires authentication' })

    const prefix = `https://api.github.com/repos/${REPO}`
    if (!url.startsWith(prefix)) return json(404, { message: 'Not Found' })
    const rest = url.slice(prefix.length)
    if (rest === '') return json(200, { full_name: REPO })

    const blob = /^\/git\/blobs\/(.+)$/.exec(rest)
    if (blob && method === 'GET') {
      const content = this.blobs.get(blob[1] ?? '')
      return content !== undefined ? json(200, { sha: blob[1], content, encoding: 'base64' }) : json(404, {})
    }

    const contents = /^\/contents\/(.+)$/.exec(rest)
    if (!contents) return json(404, { message: 'Not Found' })
    const path = decodeURIComponent(contents[1] ?? '')
    const file = this.files.get(path)

    if (method === 'GET') {
      if (!file) return json(404, { message: 'Not Found' })
      return json(200, { sha: file.sha, content: `${file.content}\n`, encoding: 'base64', size: 1 })
    }
    if (method === 'PUT') {
      const parsed: unknown = body ? JSON.parse(body) : {}
      const req = parsed as { message?: string; content?: string; sha?: string }
      if (typeof req.content !== 'string' || typeof req.message !== 'string') return json(422, {})
      this.beforePut?.(path)
      const current = this.files.get(path)
      if (current && req.sha !== current.sha) return json(409, { message: 'is at ... but expected ...' })
      if (!current && req.sha) return json(422, { message: 'sha wasn’t supplied' })
      const sha = this.write(path, req.content)
      return json(current ? 200 : 201, { content: { sha, path }, commit: { message: req.message } })
    }
    return json(405, {})
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}
