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
    const commits = /^\/commits\?path=([^&]+)/.exec(rest)
    if (commits && method === 'GET') {
      const last = github.files.get(decodeURIComponent(commits[1] ?? ''))
      return json(200, last ? [{ sha: `c-${last.sha}`, commit: { message: last.message ?? 'sync 2026-01-01T00:00:00.000Z' } }] : [])
    }
    const m = /^\/contents\/(.+)$/.exec(rest)
    if (!m) return json(404, {})
    const path = decodeURIComponent(m[1] ?? '')
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
      github.files.set(path, { sha, content: req.content ?? '', ...(req.message ? { message: req.message } : {}) })
      return json(file ? 200 : 201, { content: { sha, path } })
    }
    return json(405, {})
  })
  return github
}
