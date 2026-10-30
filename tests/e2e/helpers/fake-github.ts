import type { Page } from '@playwright/test'

// Nagebootste api.github.com voor Playwright. Zelfde regels als tests/helpers/fake-github.ts,
// maar via page.route, zodat de app in de browser nooit de echte API raakt.

const REPO = 'logboek-olivier/logboek-data'

export interface E2eGithub {
  files: Map<string, { sha: string; content: string; message?: string }>
  requests: { method: string; url: string; body: string | null }[]
  /** true = elk request mislukt alsof er geen verbinding is. */
  offline: boolean
  /** Waarde van de header github-authentication-token-expiration, of null om die weg te laten. */
  tokenExpiration: string | null
  /** Repo zonder commits: 409 op GET contents tot de eerste PUT. */
  emptyRepo: boolean
  /** Elk antwoord krijgt deze status (bijvoorbeeld 401). */
  forceStatus: number | null
  /**
   * Na een PUT geeft GitHub soms nog even de vorige versie terug (lezen vlak na schrijven). Zoveel GET's van een net
   * geschreven pad krijgen de versie van vóór de PUT.
   */
  staleReadsAfterPut: number
}

export function newGithub(partial: Partial<E2eGithub> = {}): E2eGithub {
  return { files: new Map(), requests: [], offline: false, tokenExpiration: null, emptyRepo: false, forceStatus: null, staleReadsAfterPut: 0, ...partial }
}

export async function mockGithub(page: Page, initial?: E2eGithub): Promise<E2eGithub> {
  const github: E2eGithub = initial ?? newGithub()
  let counter = github.files.size
  const stale = new Map<string, { file: { sha: string; content: string }; remaining: number }>()
  // Elke geschreven versie per pad (voor de commits-API, ?ref= en de blob-API), nieuwste laatst.
  const history = new Map<string, { commit: string; sha: string; content: string; message: string }[]>()
  const blobOf = (sha: string) => {
    for (const versions of history.values()) for (const v of versions) if (v.sha === sha) return v.content
    for (const f of github.files.values()) if (f.sha === sha) return f.content
    return undefined
  }
  /** De versies van een pad, met de huidige erbij als die buiten de app is gezet (een test die files.set gebruikt). */
  const versionsOf = (path: string) => {
    const versions = [...(history.get(path) ?? [])]
    const file = github.files.get(path)
    if (file && versions.at(-1)?.sha !== file.sha) versions.push({ commit: `c-${file.sha}`, sha: file.sha, content: file.content, message: file.message ?? 'sync 2026-01-01T00:00:00.000Z' })
    return versions
  }
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request()
    const url = request.url()
    const method = request.method()
    const body = request.postData()
    github.requests.push({ method, url, body })
    if (github.offline) return route.abort('internetdisconnected')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Access-Control-Expose-Headers': 'github-authentication-token-expiration',
    }
    if (github.tokenExpiration) headers['github-authentication-token-expiration'] = github.tokenExpiration
    const json = (status: number, data: unknown) => route.fulfill({ status, headers, body: JSON.stringify(data) })
    if (github.forceStatus !== null) return json(github.forceStatus, { message: 'nagebootst' })
    if (!request.headers()['authorization']?.startsWith('Bearer ')) return json(401, {})
    const prefix = `https://api.github.com/repos/${REPO}`
    if (!url.startsWith(prefix)) return json(404, {})
    const rest = url.slice(prefix.length)
    if (rest === '') return json(200, { full_name: REPO })
    const commits = /^\/commits\?path=([^&]+)(?:&per_page=(\d+))?/.exec(rest)
    if (commits && method === 'GET') {
      const versions = versionsOf(decodeURIComponent(commits[1] ?? '')).reverse().slice(0, Number(commits[2] ?? 30))
      return json(200, versions.map((v) => ({ sha: v.commit, commit: { message: v.message, committer: { date: '2026-10-29T12:00:00Z' } } })))
    }
    const blob = /^\/git\/blobs\/(.+)$/.exec(rest)
    if (blob && method === 'GET') {
      const content = blobOf(blob[1] ?? '')
      return content !== undefined ? json(200, { sha: blob[1], content, encoding: 'base64' }) : json(404, {})
    }
    const m = /^\/contents\/([^?]+)(?:\?ref=(.+))?$/.exec(rest)
    if (!m) return json(404, {})
    const path = decodeURIComponent(m[1] ?? '')
    if (m[2] !== undefined && method === 'GET') {
      const version = versionsOf(path).find((v) => v.commit === decodeURIComponent(m[2]!))
      return version ? json(200, { sha: version.sha, content: version.content, encoding: 'base64' }) : json(404, {})
    }
    const file = github.files.get(path)
    if (method === 'GET') {
      if (github.emptyRepo && github.files.size === 0) return json(409, { message: 'Git Repository is empty.' })
      const old = stale.get(path)
      if (old && old.remaining > 0) {
        old.remaining--
        return json(200, { sha: old.file.sha, content: old.file.content, encoding: 'base64' })
      }
      return file ? json(200, { sha: file.sha, content: file.content, encoding: 'base64' }) : json(404, {})
    }
    if (method === 'PUT') {
      const req = JSON.parse(body ?? '{}') as { content?: string; sha?: string; message?: string }
      if (file && req.sha !== file.sha) return json(409, {})
      if (!file && req.sha) return json(422, {})
      const sha = `sha-${++counter}`
      if (file && github.staleReadsAfterPut > 0) stale.set(path, { file, remaining: github.staleReadsAfterPut })
      const previous = versionsOf(path)
      github.files.set(path, { sha, content: req.content ?? '', ...(req.message ? { message: req.message } : {}) })
      history.set(path, [...previous, { commit: `c-${sha}`, sha, content: req.content ?? '', message: req.message ?? '' }])
      return json(file ? 200 : 201, { content: { sha, path } })
    }
    if (method === 'DELETE') {
      const req = JSON.parse(body ?? '{}') as { sha?: string }
      if (!file) return json(404, {})
      if (req.sha !== file.sha) return json(409, {})
      github.files.delete(path)
      return json(200, { content: null })
    }
    return json(405, {})
  })
  return github
}
