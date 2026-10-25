import type { Page } from '@playwright/test'

// Nagebootste api.github.com voor Playwright. Zelfde regels als tests/helpers/fake-github.ts,
// maar via page.route, zodat de app in de browser nooit de echte API raakt.

const REPO = 'logboek-olivier/logboek-data'

export interface E2eGithub {
  files: Map<string, { sha: string; content: string }>
  requests: { method: string; url: string; body: string | null }[]
}

export async function mockGithub(page: Page, initial?: E2eGithub): Promise<E2eGithub> {
  const github: E2eGithub = initial ?? { files: new Map(), requests: [] }
  let counter = github.files.size
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request()
    const url = request.url()
    const method = request.method()
    const body = request.postData()
    github.requests.push({ method, url, body })
    const json = (status: number, data: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (!request.headers()['authorization']?.startsWith('Bearer ')) return json(401, {})
    const prefix = `https://api.github.com/repos/${REPO}`
    if (!url.startsWith(prefix)) return json(404, {})
    const rest = url.slice(prefix.length)
    if (rest === '') return json(200, { full_name: REPO })
    const m = /^\/contents\/(.+)$/.exec(rest)
    if (!m) return json(404, {})
    const path = decodeURIComponent(m[1] ?? '')
    const file = github.files.get(path)
    if (method === 'GET') {
      return file ? json(200, { sha: file.sha, content: file.content, encoding: 'base64' }) : json(404, {})
    }
    if (method === 'PUT') {
      const req = JSON.parse(body ?? '{}') as { content?: string; sha?: string }
      if (file && req.sha !== file.sha) return json(409, {})
      if (!file && req.sha) return json(422, {})
      const sha = `sha-${++counter}`
      github.files.set(path, { sha, content: req.content ?? '' })
      return json(file ? 200 : 201, { content: { sha, path } })
    }
    return json(405, {})
  })
  return github
}
