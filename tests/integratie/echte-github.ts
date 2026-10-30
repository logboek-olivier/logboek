import { API_BASE, DATA_REPO, type FetchLike } from '../../src/storage/github'

// Integratietest tegen de echte GitHub-API (CI, .github/workflows/test.yml, job "integratie"): met de GITHUB_TOKEN van
// de workflow in een tijdelijke branch van deze repo (logboek, nooit logboek-data: regel 6), met nepdata en een
// testsleutel. De app praat zoals altijd met /repos/logboek-olivier/logboek-data; deze helper zet elk verzoek om naar
// een map in de tijdelijke branch. Zo test de echte API wat de nagebootste niet doet: echte sha's, echte vertraging na
// schrijven, echte conflicten tussen gelijktijdige commits. Na afloop gaat de branch weg.

export const TOKEN = process.env.LOGBOEK_IT_TOKEN ?? ''
export const REPO = process.env.LOGBOEK_IT_REPO ?? 'logboek-olivier/logboek'
const RUN = process.env.LOGBOEK_IT_RUN ?? `lokaal-${Date.now()}`
// Nooit logboek-data (regel 6): weigeren vóór er één verzoek is.
if (REPO === DATA_REPO || REPO.endsWith('/logboek-data')) throw new Error('De integratietest draait nooit tegen logboek-data')

/** Zoveel verzoeken deed deze test naar GitHub (de token mag er ongeveer 1000 per uur per repo doen). */
export const requestCount = { value: 0 }

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

/** Een verzoek dat na het omzetten nog naar logboek-data zou gaan: nooit versturen. */
export function reachesDataRepo(url: string): boolean {
  return url.includes(`/repos/${DATA_REPO}`)
}

// GitHub heeft naast het aantal verzoeken per uur een "secundaire limiet" op schrijfacties (ongeveer 80 per minuut en
// enkele honderden per uur). Daarboven geeft GitHub 403 met retry-after, ook op lezen. Een integratierun doet honderden
// schrijfacties: daarom houdt de test minstens WRITE_GAP_MS tussen twee schrijfacties, en wacht hij bij een limiet even
// in plaats van rood te worden. Alleen status en wachttijd gaan naar het log, nooit inhoud.
const WRITE_GAP_MS = 1_000
let nextWrite = 0

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wacht tot er weer een schrijfactie mag (lezen wacht nooit). */
export async function paceWrite(method: string): Promise<void> {
  if (method === 'GET' || method === 'HEAD') return
  const now = Date.now()
  const at = Math.max(now, nextWrite)
  nextWrite = at + WRITE_GAP_MS
  if (at > now) await sleep(at - now)
}

/** Een antwoord van de limiet (403/429 met retry-after, geen verzoeken meer over, of "rate limit"): seconden wachten; anders null. */
export async function limitWait(status: number, header: (name: string) => string | null, text: () => Promise<string>): Promise<number | null> {
  if (status !== 403 && status !== 429) return null
  const retry = Number(header('retry-after'))
  if (Number.isFinite(retry) && retry > 0) return retry
  if (header('x-ratelimit-remaining') === '0') return 60
  return /rate limit/i.test(await text().catch(() => '')) ? 60 : null
}

/** Een onverwachte status van GitHub in het log (geen 2xx, en niet 404, 409 of 422 die de app zelf afhandelt). */
export function noteStatus(method: string, status: number): void {
  if (status >= 300 && status !== 404 && status !== 409 && status !== 422) console.log(`GitHub ${method} ${status}`)
}

/** Een fetch voor GithubClient in Node die naar de tijdelijke branch gaat. */
export function branchFetch(t: Target): FetchLike {
  return async (input, init) => {
    const method = init.method ?? 'GET'
    const { url, body } = rewrite(input, method, typeof init.body === 'string' ? init.body : null, t)
    if (reachesDataRepo(url)) throw new Error('Verzoek naar logboek-data geweigerd')
    for (let attempt = 0; ; attempt++) {
      await paceWrite(method)
      requestCount.value++
      // Een herhaling na een limiet zonder de tijdsgrens van de app: die wacht gewoon op dit antwoord.
      const response = await globalThis.fetch(url, { ...init, ...(attempt > 0 ? { signal: null } : {}), ...(body !== null ? { body } : {}) })
      const wait = attempt < 3 ? await limitWait(response.status, (n) => response.headers.get(n), () => response.clone().text()) : null
      if (wait === null) {
        noteStatus(method, response.status)
        return response
      }
      console.log(`GitHub-limiet (${response.status}): ${Math.min(wait, 120)} s wachten`)
      await sleep(Math.min(wait, 120) * 1000)
    }
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  requestCount.value++
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

/** Wacht tot `check` true geeft (GitHub toont net geschreven versies soms pas na een paar seconden). */
export async function eventually(check: () => Promise<boolean>, tries = 6): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** Math.min(i, 3)))
  }
  throw new Error('GitHub liet de verwachte toestand niet zien')
}

/** Verwijdert de tijdelijke branch (ook als de test faalde). */
export async function deleteBranch(t: Target): Promise<void> {
  await api(`/git/refs/heads/${t.branch}`, { method: 'DELETE' }).catch(() => undefined)
}
