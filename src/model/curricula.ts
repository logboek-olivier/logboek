import type { Lang } from '../i18n'
import type { Tx } from '../domain/tx'
import { SEED_CURRICULA } from './seed-curricula'
import { CURRICULUM_BODIES, newId, type Curriculum, type CurriculumBody, type LocalizedText, type Topic, type TopicGroup, type TopicKind } from './types'

// Curricula: meegeleverde cursussen (in de code) plus opgeslagen cursussen (curricula.json.enc).
// Een opgeslagen record met hetzelfde id vervangt de meegeleverde versie; een tombstone verbergt hem.
// Alle bewerkingen geven een nieuwe Curriculum terug; `saveCurriculum` slaat op en synct.

export const SEED_IDS = new Set(SEED_CURRICULA.map((c) => c.id))

/** Zichtbare cursussen: opgeslagen (niet verwijderd) plus meegeleverde die niet opgeslagen of verwijderd zijn. */
export function effectiveCurricula(stored: readonly Curriculum[]): Curriculum[] {
  const byId = new Map(stored.map((c) => [c.id, c]))
  const result: Curriculum[] = []
  for (const seed of SEED_CURRICULA) {
    const own = byId.get(seed.id)
    if (!own) result.push(seed)
    else if (own.deletedAt === null) result.push(own)
  }
  for (const c of stored) if (!SEED_IDS.has(c.id) && c.deletedAt === null) result.push(c)
  return result
}

/** Tekst in de gevraagde taal; leeg → de andere taal. */
export function localized(text: LocalizedText, lang: Lang): string {
  const own = text[lang].trim()
  return own || text[lang === 'nl' ? 'en' : 'nl'].trim()
}

export function courseLabel(c: Curriculum, lang: Lang): string {
  const name = localized(c.name, lang)
  if (c.body === 'eigen') return name
  return c.courseCode && !name.includes(c.courseCode) ? `${c.body} ${c.courseCode} ${name}` : `${c.body} ${name}`
}

export function topicCount(c: Curriculum): number {
  return c.groups.reduce((n, g) => n + g.topics.length, 0)
}

export function allTopics(c: Curriculum): Topic[] {
  return c.groups.flatMap((g) => g.topics)
}

/** Groepeert cursussen per bond, in vaste volgorde. */
export function byBody(list: readonly Curriculum[]): { body: CurriculumBody; curricula: Curriculum[] }[] {
  return CURRICULUM_BODIES.map((body) => ({ body, curricula: list.filter((c) => c.body === body) })).filter((g) => g.curricula.length > 0)
}

export async function saveCurriculum(store: Tx, curriculum: Curriculum): Promise<void> {
  await store.put('curricula.json.enc', { ...curriculum, updatedAt: new Date().toISOString(), deletedAt: null })
}

/** Verwijdert een cursus (ook een meegeleverde: dan een tombstone met hetzelfde id). Geeft ongedaan maken terug. */
export async function deleteCurriculum(store: Tx, curriculum: Curriculum): Promise<void> {
  const now = new Date().toISOString()
  await store.put('curricula.json.enc', { ...curriculum, updatedAt: now, deletedAt: now })
}

export function newCurriculum(body: CurriculumBody, courseCode: string, name: LocalizedText): Curriculum {
  return { id: newId(), body, courseCode: courseCode.trim(), name: trimText(name), groups: [], source: 'eigen', updatedAt: '', deletedAt: null }
}

// ---------- Bewerkingen (puur) ----------

export function renameCourse(c: Curriculum, patch: { body: CurriculumBody; courseCode: string; name: LocalizedText }): Curriculum {
  return { ...c, body: patch.body, courseCode: patch.courseCode.trim(), name: trimText(patch.name) }
}

export function addGroup(c: Curriculum, title: LocalizedText): Curriculum {
  return { ...c, groups: [...c.groups, { id: newId(), title: trimText(title), topics: [] }] }
}

export function updateGroup(c: Curriculum, groupId: string, title: LocalizedText): Curriculum {
  return { ...c, groups: c.groups.map((g) => (g.id === groupId ? { ...g, title: trimText(title) } : g)) }
}

export function removeGroup(c: Curriculum, groupId: string): Curriculum {
  return { ...c, groups: c.groups.filter((g) => g.id !== groupId) }
}

export function moveGroup(c: Curriculum, groupId: string, delta: -1 | 1): Curriculum {
  return { ...c, groups: move(c.groups, c.groups.findIndex((g) => g.id === groupId), delta) }
}

export interface TopicInput {
  title: LocalizedText
  kind: TopicKind
  examCritical: boolean
}

export function addTopic(c: Curriculum, groupId: string, input: TopicInput): Curriculum {
  const topic: Topic = { id: newId(), title: trimText(input.title), kind: input.kind, examCritical: input.examCritical }
  return { ...c, groups: c.groups.map((g) => (g.id === groupId ? { ...g, topics: [...g.topics, topic] } : g)) }
}

/** Werkt een onderwerp bij en zet het eventueel in een andere groep (achteraan). */
export function updateTopic(c: Curriculum, topicId: string, input: TopicInput, groupId?: string): Curriculum {
  const current = allTopics(c).find((t) => t.id === topicId)
  if (!current) return c
  const next: Topic = { ...current, title: trimText(input.title), kind: input.kind, examCritical: input.examCritical }
  const from = c.groups.find((g) => g.topics.some((t) => t.id === topicId))
  if (!groupId || groupId === from?.id) {
    return { ...c, groups: c.groups.map((g) => ({ ...g, topics: g.topics.map((t) => (t.id === topicId ? next : t)) })) }
  }
  return {
    ...c,
    groups: c.groups.map((g) =>
      g.id === groupId ? { ...g, topics: [...g.topics, next] } : { ...g, topics: g.topics.filter((t) => t.id !== topicId) },
    ),
  }
}

export function removeTopic(c: Curriculum, topicId: string): Curriculum {
  return { ...c, groups: c.groups.map((g) => ({ ...g, topics: g.topics.filter((t) => t.id !== topicId) })) }
}

export function moveTopic(c: Curriculum, topicId: string, delta: -1 | 1): Curriculum {
  return {
    ...c,
    groups: c.groups.map((g) => {
      const i = g.topics.findIndex((t) => t.id === topicId)
      return i < 0 ? g : { ...g, topics: move(g.topics, i, delta) }
    }),
  }
}

function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

function trimText(text: LocalizedText): LocalizedText {
  return { nl: text.nl.trim().slice(0, MAX_TEXT), en: text.en.trim().slice(0, MAX_TEXT) }
}

// ---------- Import en export (JSON) ----------

export const EXPORT_FORMAT = 'logboek-curriculum'
const MAX_TEXT = 200
const MAX_GROUPS = 100
const MAX_TOPICS = 1000

export class CurriculumFileError extends Error {
  constructor() {
    super('Ongeldig curriculum-bestand')
    this.name = 'CurriculumFileError'
  }
}

/** Een cursus als JSON-bestand om te delen. Bevat geen studentgegevens, alleen de cursusopbouw. */
export function exportCurriculum(c: Curriculum): string {
  const { id: _id, updatedAt: _u, deletedAt: _d, source: _s, ...content } = c
  void [_id, _u, _d, _s]
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, curriculum: content }, null, 2)
}

export function exportFileName(c: Curriculum): string {
  const base = `${c.body} ${c.courseCode || c.name.en || c.name.nl}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base || 'curriculum'}.json`
}

/** Leest een geëxporteerd curriculum; altijd nieuwe id's, zodat een import nooit een bestaande cursus overschrijft. */
export function importCurriculum(text: string): Curriculum {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CurriculumFileError()
  }
  if (!isObject(raw) || raw.format !== EXPORT_FORMAT || raw.version !== 1 || !isObject(raw.curriculum)) throw new CurriculumFileError()
  const c = raw.curriculum
  const body = CURRICULUM_BODIES.includes(c.body as CurriculumBody) ? (c.body as CurriculumBody) : null
  const name = text2(c.name)
  if (!body || !name || typeof c.courseCode !== 'string' || !Array.isArray(c.groups) || c.groups.length > MAX_GROUPS) {
    throw new CurriculumFileError()
  }
  let count = 0
  const groups: TopicGroup[] = c.groups.map((g: unknown) => {
    if (!isObject(g) || !Array.isArray(g.topics)) throw new CurriculumFileError()
    const title = text2(g.title)
    if (!title) throw new CurriculumFileError()
    const topics: Topic[] = g.topics.map((t: unknown) => {
      if (!isObject(t) || (t.kind !== 'theorie' && t.kind !== 'praktijk') || typeof t.examCritical !== 'boolean') throw new CurriculumFileError()
      const topicTitle = text2(t.title)
      if (!topicTitle) throw new CurriculumFileError()
      if (++count > MAX_TOPICS) throw new CurriculumFileError()
      return { id: newId(), title: topicTitle, kind: t.kind, examCritical: t.examCritical }
    })
    return { id: newId(), title, topics }
  })
  return { id: newId(), body, courseCode: c.courseCode.trim().slice(0, MAX_TEXT), name, groups, source: 'eigen', updatedAt: '', deletedAt: null }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text2(v: unknown): LocalizedText | null {
  if (!isObject(v) || typeof v.nl !== 'string' || typeof v.en !== 'string') return null
  const t = trimText({ nl: v.nl, en: v.en })
  return t.nl || t.en ? t : null
}
