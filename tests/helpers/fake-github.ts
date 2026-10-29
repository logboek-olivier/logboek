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
  /** Repo zonder commits: GitHub antwoordt op GET contents met 409 "Git Repository is empty." tot de eerste PUT. */
  emptyRepo = false
  /** Wordt vlak vóór elke PUT aangeroepen; handig om een gelijktijdige schrijver na te bootsen. */
  beforePut: ((path: string) => void) | null = null
  /**
   * Na een PUT geeft GitHub soms nog even de vorige versie terug (lezen vlak na schrijven, of een gecachet antwoord).
   * Zolang dit aantal > 0 is, krijgt elke GET van een net geschreven pad de versie van vóór de PUT.
   */
  staleReadsAfterPut = 0
  private readonly stale = new Map<string, { file: StoredFile; remaining: number }>()
  /** Zoveel GET's van dit pad geven nog 404, ook als het bestand bestaat (GitHub loopt even achter na een schrijfactie). */
  readonly notFoundReads = new Map<string, number>()
  /** Wordt na elke geslaagde PUT aangeroepen (pad en nieuwe SHA). */
  afterPut: ((path: string, sha: string) => void) | null = null
  /** De commits-API geeft een fout (de rest werkt gewoon). */
  failCommits = false
  /** Commitberichten per pad, nieuwste laatst (voor de commits-API). */
  readonly commits = new Map<string, string[]>()
  private shaCounter = 0

  /** Schrijft direct in de nagebootste repo, zoals een ander apparaat dat zou doen (standaard met een oud commitbericht). */
  write(path: string, base64: string, message = 'sync 2026-01-01T00:00:00.000Z'): string {
    const sha = `sha-${++this.shaCounter}`
    this.files.set(path, { sha, content: base64 })
    this.blobs.set(sha, base64)
    this.commits.set(path, [...(this.commits.get(path) ?? []), message])
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
    if (rest === '') return json(200, { full_name: REPO }, this.forceHeaders)

    const blob = /^\/git\/blobs\/(.+)$/.exec(rest)
    if (blob && method === 'GET') {
      const content = this.blobs.get(blob[1] ?? '')
      return content !== undefined ? json(200, { sha: blob[1], content, encoding: 'base64' }) : json(404, {})
    }

    const commits = /^\/commits\?path=([^&]+)/.exec(rest)
    if (commits && method === 'GET') {
      if (this.failCommits) return json(500, { message: 'nagebootste fout' })
      const list = this.commits.get(decodeURIComponent(commits[1] ?? '')) ?? []
      return json(200, list.length > 0 ? [{ sha: `c-${list.length}`, commit: { message: list.at(-1) } }] : [])
    }

    const contents = /^\/contents\/(.+)$/.exec(rest)
    if (!contents) return json(404, { message: 'Not Found' })
    const path = decodeURIComponent(contents[1] ?? '')
    const file = this.files.get(path)

    if (method === 'GET') {
      if (this.emptyRepo && this.files.size === 0) return json(409, { message: 'Git Repository is empty.' })
      const hidden = this.notFoundReads.get(path) ?? 0
      if (hidden > 0) {
        this.notFoundReads.set(path, hidden - 1)
        return json(404, { message: 'Not Found' })
      }
      const old = this.stale.get(path)
      if (old && old.remaining > 0) {
        old.remaining--
        return json(200, { sha: old.file.sha, content: `${old.file.content}\n`, encoding: 'base64', size: 1 })
      }
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
      if (current && this.staleReadsAfterPut > 0) this.stale.set(path, { file: current, remaining: this.staleReadsAfterPut })
      const sha = this.write(path, req.content, req.message)
      this.afterPut?.(path, sha)
      return json(current ? 200 : 201, { content: { sha, path }, commit: { message: req.message } })
    }
    if (method === 'DELETE') {
      const req = (body ? JSON.parse(body) : {}) as { message?: string; sha?: string }
      if (typeof req.message !== 'string' || typeof req.sha !== 'string') return json(422, {})
      if (!file) return json(404, { message: 'Not Found' })
      if (req.sha !== file.sha) return json(409, { message: 'is at ... but expected ...' })
      this.files.delete(path)
      return json(200, { content: null, commit: { message: req.message } })
    }
    return json(405, {})
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}
