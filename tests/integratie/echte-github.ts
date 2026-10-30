import { API_BASE, DATA_REPO, type FetchLike } from '../../src/storage/github'

// Integratietest tegen de echte GitHub-API (CI, .github/workflows/test.yml, job "integratie"): met de GITHUB_TOKEN van
// de workflow in een tijdelijke branch van deze repo (logboek, nooit logboek-data: regel 6), met nepdata en een
// testsleutel. De app praat zoals altijd met /repos/logboek-olivier/logboek-data; deze helper zet elk verzoek om naar
// een map in de tijdelijke branch. Zo test de echte API wat de nagebootste niet doet: echte sha's, echte vertraging na
// schrijven, echte conflicten tussen gelijktijdige commits. Na afloop gaat de branch weg.

export const TOKEN = process.env.LOGBOEK_IT_TOKEN ?? ''
export const REPO = process.env.LOGBOEK_IT_REPO ?? 'logboek-olivier/logboek'
const RUN = process.env.LOGBOEK_IT_RUN ?? `lokaal-${Date.now()}`

export interface Target {
  repo: string
  branch: string
  /** Map in de branch waar de nepdata komt te staan. */
  prefix: string
}

export function target(name: string): Target {
  return { repo: REPO, branch: `integratie/${RUN}-${name}`, prefix: `integratie-data/${name}` }
}

/** Zet een verzoek voor logboek-data om naar de tijdelijke branch; andere verzoeken blijven zoals ze zijn. */
export function rewrite(url: string, method: string, body: string | null, t: Target): { url: string; body: string | null } {
  const from = `${API_BASE}/repos/${DATA_REPO}`
  if (!url.startsWith(from)) return { url, body }
  const base = `${API_BASE}/repos/${t.repo}`
  const rest = url.slice(from.length)
  if (rest === '') return { url: base, body }
  const contents = /^\/contents\/([^?]+)(?:\?ref=(.+))?$/.exec(rest)
  if (contents) {
    const path = `${t.prefix}/${contents[1]}`
    if (method === 'GET') return { url: `${base}/contents/${path}?ref=${contents[2] ?? encodeURIComponent(t.branch)}`, body }
    const parsed = JSON.parse(body ?? '{}') as Record<string, unknown>
    return { url: `${base}/contents/${path}`, body: JSON.stringify({ ...parsed, branch: t.branch }) }
  }
  const commits = /^\/commits\?path=([^&]+)(.*)$/.exec(rest)
  if (commits) {
    const path = encodeURIComponent(`${t.prefix}/${decodeURIComponent(commits[1] ?? '')}`)
    return { url: `${base}/commits?path=${path}&sha=${encodeURIComponent(t.branch)}${commits[2] ?? ''}`, body }
  }
  return { url: `${base}${rest}`, body }
}

/** Een fetch voor GithubClient in Node die naar de tijdelijke branch gaat. */
export function branchFetch(t: Target): FetchLike {
  return (input, init) => {
    const method = init.method ?? 'GET'
    const { url, body } = rewrite(input, method, typeof init.body === 'string' ? init.body : null, t)
    return globalThis.fetch(url, { ...init, ...(body !== null ? { body } : {}) })
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`${API_BASE}/repos/${REPO}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
}

/** Maakt de tijdelijke branch vanaf main. */
export async function createBranch(t: Target): Promise<void> {
  const head = await api('/git/ref/heads/main')
  if (!head.ok) throw new Error(`main niet te lezen: ${head.status}`)
  const sha = ((await head.json()) as { object: { sha: string } }).object.sha
  const made = await api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${t.branch}`, sha }) })
  if (!made.ok && made.status !== 422) throw new Error(`branch niet te maken: ${made.status}`)
}

/** Verwijdert de tijdelijke branch (ook als de test faalde). */
export async function deleteBranch(t: Target): Promise<void> {
  await api(`/git/refs/heads/${t.branch}`, { method: 'DELETE' }).catch(() => undefined)
}
