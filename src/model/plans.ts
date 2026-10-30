import { formatDateRange, formatWeekday } from '../format'
import { LANGS, translate, type Lang } from '../i18n'
import type { Store } from '../storage/store'
import { allTopics, localized } from './curricula'
import type { Undo } from './edit'
import { addDays } from './money'
import { raiseStatus, statusOf } from './students'
import {
  DAY_SLOTS,
  newId,
  type Curriculum,
  type DaySlot,
  type LocalizedText,
  type PlanBlock,
  type PlanGroup,
  type StudentLevel,
  type Student,
  type Topic,
  type WeekPlan,
} from './types'

// Planning: dagen met blokken per dagdeel, met grote thema's (de onderdelen van een cursus) in plaats van losse
// onderwerpen. Een concept wordt zonder netwerk gemaakt uit de cursussen van de groepen: theorie-thema's 's ochtends,
// praktijk-thema's 's middags, thema's met examenkritische onderwerpen eerst, laatste dag herhaling en examen.
// Daarna is alles snel te veranderen: thema aan of uit met een tik, een blok met één tik een dag eerder of later.
// Grof plannen: elke dag een ochtend en een middag; een blok geldt standaard voor alle groepen samen (per cursus), en
// splitst alleen per groep als Olivier dat kiest. Eigen thema's als tekst kunnen erbij; een leeg dagdeel mag.

export const MAX_DAYS = 14
export const MAX_TEXT = 120

export function planEnd(plan: Pick<WeekPlan, 'startDate' | 'dayCount'>): string {
  return addDays(plan.startDate, Math.max(1, plan.dayCount) - 1)
}

export function planDates(startDate: string, dayCount: number): string[] {
  return Array.from({ length: Math.max(1, Math.min(MAX_DAYS, dayCount)) }, (_, i) => addDays(startDate, i))
}

export function livePlans(plans: readonly WeekPlan[]): WeekPlan[] {
  return plans.filter((p) => p.deletedAt === null).sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))
}

/** De planning waar vandaag in valt (bij overlap de laatst begonnen), of null. */
export function activePlan(plans: readonly WeekPlan[], today: string): WeekPlan | null {
  return livePlans(plans).find((p) => p.startDate <= today && today <= planEnd(p)) ?? null
}

/** Lopende en komende planningen eerst, daarna afgelopen. */
export function splitPlans(plans: readonly WeekPlan[], today: string): { current: WeekPlan[]; past: WeekPlan[] } {
  const live = livePlans(plans)
  return {
    current: live.filter((p) => planEnd(p) >= today).reverse(),
    past: live.filter((p) => planEnd(p) < today),
  }
}

export function blocksOn(plan: WeekPlan, date: string): PlanBlock[] {
  const day = plan.days.find((d) => d.date === date)
  return day ? sortBlocks(day.blocks) : []
}

export function sortBlocks(blocks: readonly PlanBlock[]): PlanBlock[] {
  return [...blocks].sort((a, b) => DAY_SLOTS.indexOf(a.slot) - DAY_SLOTS.indexOf(b.slot))
}

// ---------- Concept ----------

export interface DraftInput {
  title: string
  startDate: string
  dayCount: number
  tripId?: string
  groups: PlanGroup[]
}

interface Theme {
  id: string
  topics: Topic[]
  theory: boolean
  critical: boolean
}

function themesOf(course: Curriculum): Theme[] {
  const list = course.groups
    .filter((g) => g.topics.length > 0)
    .map((g) => ({
      id: g.id,
      topics: g.topics,
      theory: g.topics.filter((t) => t.kind === 'theorie').length * 2 > g.topics.length,
      critical: g.topics.some((t) => t.examCritical),
    }))
  return [...list.filter((th) => th.critical), ...list.filter((th) => !th.critical)]
}

/**
 * Grof concept: per cursus één gezamenlijk blok per dagdeel (alle groepen van die cursus samen), met één thema per blok:
 * theorie-thema's 's ochtends, praktijk-thema's 's middags, examenkritische eerst. Zijn er meer thema's van één soort dan
 * dagdelen, dan schuiven ze naar de lege dagdelen van de andere soort, en pas daarna komen er twee in één blok. Een
 * dagdeel zonder thema blijft leeg. Laatste dag: herhaling ('s ochtends) en examen ('s middags).
 */
export function draftPlan(input: DraftInput, curricula: readonly Curriculum[], lang: Lang): WeekPlan {
  const dates = planDates(input.startDate, input.dayCount)
  const reviewDay = dates.length > 1
  const teachDays = reviewDay ? dates.length - 1 : dates.length
  const days = dates.map((date) => ({ date, blocks: [] as PlanBlock[] }))
  const courseIds = [...new Set(input.groups.map((g) => g.curriculumId))]
  for (const courseId of courseIds) {
    const course = curricula.find((c) => c.id === courseId)
    if (!course) continue
    const groupIds = input.groups.filter((g) => g.curriculumId === courseId).map((g) => g.id)
    const themes = themesOf(course)
    // Dagdelen in volgorde: per lesdag ochtend en middag.
    const slots: { day: number; slot: DaySlot; themes: Theme[] }[] = []
    for (let i = 0; i < teachDays; i++) for (const slot of ['ochtend', 'middag'] as const) slots.push({ day: i, slot, themes: [] })
    const place = (list: Theme[], prefer: DaySlot) => {
      for (const th of list) {
        const free = slots.find((x) => x.slot === prefer && x.themes.length === 0) ?? slots.find((x) => x.themes.length === 0)
        if (free) free.themes.push(th)
        else {
          // Alles bezet: bij het blok met de minste thema's (twee in één blok).
          const least = slots.reduce((a, b) => (b.themes.length < a.themes.length ? b : a), slots[0]!)
          least.themes.push(th)
        }
      }
    }
    if (slots.length > 0) {
      place(themes.filter((th) => th.theory), 'ochtend')
      place(themes.filter((th) => !th.theory), 'middag')
    }
    for (const x of slots) if (x.themes.length > 0) days[x.day]!.blocks.push(themeBlock(x.slot, groupIds, x.themes))
    if (reviewDay) {
      const last = days[days.length - 1]!
      const critical = themes.filter((th) => th.critical)
      // Herhaling: de thema's met examenkritische onderwerpen, en daarvan alleen die onderwerpen.
      const review = themeBlock('ochtend', groupIds, critical, translate(lang, 'plan.reviewNote'))
      last.blocks.push({ ...review, topicIds: critical.flatMap((th) => th.topics.filter((t) => t.examCritical).map((t) => t.id)) })
      last.blocks.push({ ...block('middag', groupIds, [], translate(lang, 'plan.examNote')), themeIds: [] })
    }
  }
  // Dagen in volgorde van de dagdelen (ochtend vóór middag), per cursus naast elkaar.
  for (const d of days) d.blocks = sortBlocks(d.blocks)
  return {
    id: newId(),
    title: input.title.trim().slice(0, MAX_TEXT),
    startDate: input.startDate,
    dayCount: dates.length,
    ...(input.tripId ? { tripId: input.tripId } : {}),
    groups: input.groups,
    days,
    updatedAt: '',
    deletedAt: null,
  }
}

function block(slot: DaySlot, groupIds: string[], topicIds: string[], note?: string): PlanBlock {
  return { id: newId(), slot, groupIds, topicIds, ...(note ? { note } : {}) }
}

function themeBlock(slot: DaySlot, groupIds: string[], themes: readonly Theme[], note?: string): PlanBlock {
  return { ...block(slot, groupIds, themes.flatMap((th) => th.topics.map((t) => t.id)), note), themeIds: themes.map((th) => th.id) }
}

export function newGroup(name: string, curriculumId: string, level: StudentLevel = 'beginner'): PlanGroup {
  return { id: newId(), name, curriculumId, level, studentIds: [] }
}

/** "Groep A", "Groep B", … */
export function groupName(index: number, lang: Lang): string {
  return translate(lang, 'plan.groupName', { letter: String.fromCharCode(65 + (index % 26)) })
}

// ---------- Bewerken (puur) ----------

export interface BlockPatch {
  groupIds: string[]
  topicIds: string[]
  /** Thema's (cursusonderdelen); bij een blok met thema's volgen de onderwerpen daaruit. */
  themeIds?: string[]
  /** Eigen thema's als tekst. */
  ownThemes?: string[]
  location?: string
  note?: string
}

export function updateBlock(plan: WeekPlan, blockId: string, patch: BlockPatch): WeekPlan {
  const location = patch.location?.trim().slice(0, MAX_TEXT)
  const note = patch.note?.trim().slice(0, 500)
  return mapBlocks(plan, (b) => {
    if (b.id !== blockId) return b
    const { location: _l, note: _n, themeIds: _t, ownThemes: _o, ...rest } = b
    void [_l, _n, _t, _o]
    const themeIds = patch.themeIds ?? b.themeIds
    const ownThemes = cleanOwnThemes(patch.ownThemes ?? b.ownThemes ?? [])
    return { ...rest, groupIds: patch.groupIds, topicIds: patch.topicIds, ...(themeIds ? { themeIds } : {}), ...(ownThemes.length > 0 ? { ownThemes } : {}), ...(location ? { location } : {}), ...(note ? { note } : {}) }
  })
}

/** Eigen thema's: getrimd, niet leeg, geen dubbele, hoogstens tien van elk MAX_TEXT tekens. */
export function cleanOwnThemes(list: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const text = raw.trim().slice(0, MAX_TEXT)
    if (text && !out.some((x) => x.toLowerCase() === text.toLowerCase())) out.push(text)
  }
  return out.slice(0, 10)
}

/**
 * Een blok per groep: het blok wordt vervangen door één blok per gekozen groep (zelfde dag, dagdeel en inhoud), zodat
 * elke groep apart te bewerken is. Met één groep verandert er niets.
 */
export function splitBlock(plan: WeekPlan, blockId: string, groupIds: readonly string[]): WeekPlan {
  const found = findBlock(plan, blockId)
  if (!found || groupIds.length < 2) return plan
  const parts = groupIds.map((id, i) => ({ ...found.block, id: i === 0 ? found.block.id : newId(), groupIds: [id] }))
  return { ...plan, days: plan.days.map((d) => (d.date === found.date ? { ...d, blocks: d.blocks.flatMap((b) => (b.id === blockId ? parts : [b])) } : d)) }
}

/**
 * Een bewerkt blok toepassen (concept en opgeslagen planning op dezelfde manier): inhoud, dan dag en dagdeel, en bij "per
 * groep" met meer dan één groep één blok per groep.
 */
export function applyBlockEdit(plan: WeekPlan, blockId: string, patch: BlockPatch, date: string, slot: DaySlot, perGroup: boolean): WeekPlan {
  const found = findBlock(plan, blockId)
  if (!found) return plan
  let next = updateBlock(plan, blockId, patch)
  if (date !== found.date || slot !== found.block.slot) next = moveBlock(next, blockId, date, slot)
  return perGroup ? splitBlock(next, blockId, patch.groupIds) : next
}

/** Zet een blok op een andere dag en/of in een ander dagdeel (achteraan dat dagdeel). */
export function moveBlock(plan: WeekPlan, blockId: string, date: string, slot: DaySlot): WeekPlan {
  const found = findBlock(plan, blockId)
  if (!found) return plan
  const moved = { ...found.block, slot }
  return {
    ...plan,
    days: plan.days.map((d) => {
      const without = d.blocks.filter((b) => b.id !== blockId)
      return d.date === date ? { ...d, blocks: [...without, moved] } : { ...d, blocks: without }
    }),
  }
}

/** Een blok met één tik een dag eerder (-1) of later (+1), zelfde dagdeel; aan de rand blijft het staan. */
export function shiftBlock(plan: WeekPlan, blockId: string, delta: -1 | 1): WeekPlan {
  const found = findBlock(plan, blockId)
  if (!found) return plan
  const index = plan.days.findIndex((d) => d.date === found.date)
  const target = plan.days[index + delta]
  return target ? moveBlock(plan, blockId, target.date, found.block.slot) : plan
}

export function addBlock(plan: WeekPlan, date: string, slot: DaySlot, groupIds: string[]): { plan: WeekPlan; blockId: string } {
  // Nieuwe blokken werken met thema's.
  const b: PlanBlock = { ...block(slot, groupIds, []), themeIds: [] }
  return { plan: { ...plan, days: plan.days.map((d) => (d.date === date ? { ...d, blocks: [...d.blocks, b] } : d)) }, blockId: b.id }
}

export function removeBlock(plan: WeekPlan, blockId: string): WeekPlan {
  return { ...plan, days: plan.days.map((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== blockId) })) }
}

export function findBlock(plan: WeekPlan, blockId: string): { date: string; block: PlanBlock } | null {
  for (const d of plan.days) {
    const b = d.blocks.find((x) => x.id === blockId)
    if (b) return { date: d.date, block: b }
  }
  return null
}

/** Andere startdatum of ander aantal dagen: blokken blijven op hun dagnummer; dagen voorbij het einde vervallen. */
export function reschedule(plan: WeekPlan, patch: { title: string; startDate: string; dayCount: number; tripId?: string }): WeekPlan {
  const dates = planDates(patch.startDate, patch.dayCount)
  const { tripId: _t, ...rest } = plan
  void _t
  return {
    ...rest,
    title: patch.title.trim().slice(0, MAX_TEXT),
    startDate: patch.startDate,
    dayCount: dates.length,
    ...(patch.tripId ? { tripId: patch.tripId } : {}),
    days: dates.map((date, i) => ({ date, blocks: plan.days[i]?.blocks ?? [] })),
  }
}

export function updateGroups(plan: WeekPlan, groups: PlanGroup[]): WeekPlan {
  const ids = new Set(groups.map((g) => g.id))
  return mapBlocks({ ...plan, groups }, (b) => ({ ...b, groupIds: b.groupIds.filter((id) => ids.has(id)) }))
}

function mapBlocks(plan: WeekPlan, fn: (b: PlanBlock) => PlanBlock): WeekPlan {
  return { ...plan, days: plan.days.map((d) => ({ ...d, blocks: d.blocks.map(fn) })) }
}

// ---------- Onderwerpen en voortgang ----------

/** Alle onderwerpen van de cursussen van de groepen in een blok (om uit te kiezen). */
export function topicChoices(plan: WeekPlan, groupIds: readonly string[], curricula: readonly Curriculum[]): Topic[] {
  const courseIds = new Set(plan.groups.filter((g) => groupIds.includes(g.id)).map((g) => g.curriculumId))
  return curricula.filter((c) => courseIds.has(c.id)).flatMap(allTopics)
}

export interface ThemeChoice {
  id: string
  title: LocalizedText
  topicIds: string[]
}

/** Alle thema's (cursusonderdelen) van de cursussen van de groepen in een blok. */
export function themeChoices(plan: WeekPlan, groupIds: readonly string[], curricula: readonly Curriculum[]): ThemeChoice[] {
  const courseIds = new Set(plan.groups.filter((g) => groupIds.includes(g.id)).map((g) => g.curriculumId))
  return curricula
    .filter((c) => courseIds.has(c.id))
    .flatMap((c) => c.groups.filter((g) => g.topics.length > 0).map((g) => ({ id: g.id, title: g.title, topicIds: g.topics.map((t) => t.id) })))
}

/** Wat een blok toont: thema's als het die heeft, anders losse onderwerpen. Elk item met zijn onderwerpen. */
export interface PlanItem {
  id: string
  title: string
  topicIds: string[]
  theme: boolean
}

export function blockItems(b: PlanBlock, curricula: readonly Curriculum[], lang: Lang): PlanItem[] {
  // Eigen thema's (tekst) achteraan, zonder onderwerpen om af te vinken.
  const own = (b.ownThemes ?? []).map((title, i) => ({ id: `eigen:${i}`, title, topicIds: [] as string[], theme: true }))
  return [...courseItems(b, curricula, lang), ...own]
}

function courseItems(b: PlanBlock, curricula: readonly Curriculum[], lang: Lang): PlanItem[] {
  if (b.themeIds && b.themeIds.length > 0) {
    const themes = new Map<string, { title: LocalizedText; topicIds: string[] }>()
    for (const c of curricula) for (const g of c.groups) themes.set(g.id, { title: g.title, topicIds: g.topics.map((t) => t.id) })
    return b.themeIds.flatMap((id) => {
      const th = themes.get(id)
      if (!th) return []
      // Bij herhaling alleen de examenkritische onderwerpen van het thema (de onderwerpen in het blok).
      const topicIds = th.topicIds.filter((t) => b.topicIds.includes(t))
      return [{ id, title: localized(th.title, lang), topicIds: topicIds.length > 0 ? topicIds : th.topicIds, theme: true }]
    })
  }
  const topics = topicIndex(curricula)
  return b.topicIds.flatMap((id) => {
    const found = topics.get(id)
    return found ? [{ id, title: localized(found.topic.title, lang), topicIds: [id], theme: false }] : []
  })
}

export function topicIndex(curricula: readonly Curriculum[]): Map<string, { topic: Topic; course: Curriculum }> {
  const map = new Map<string, { topic: Topic; course: Curriculum }>()
  for (const course of curricula) for (const topic of allTopics(course)) map.set(topic.id, { topic, course })
  return map
}

/** Studenten van de groepen in een blok die het onderwerp in hun cursus hebben (actief, niet verwijderd). */
export function studentsFor(plan: WeekPlan, block: PlanBlock, topicCourseId: string, students: readonly Student[]): Student[] {
  const groups = plan.groups.filter((g) => block.groupIds.includes(g.id) && g.curriculumId === topicCourseId)
  const ids = new Set(groups.flatMap((g) => g.studentIds))
  return students.filter((s) => ids.has(s.id) && s.deletedAt === null && !s.archivedAt && s.curriculumId === topicCourseId)
}

/** Geoefend door iedereen in de groep(en)? Null als er geen studenten aan de groep gekoppeld zijn. */
export function topicDone(group: readonly Student[], topicId: string): boolean | null {
  if (group.length === 0) return null
  return group.every((s) => statusOf(s, topicId) !== 'nieuw')
}

/** Alle onderwerpen (van een thema) geoefend door iedereen? */
export function itemDone(group: readonly Student[], topicIds: readonly string[]): boolean | null {
  if (group.length === 0 || topicIds.length === 0) return null
  return topicIds.every((id) => topicDone(group, id))
}

/** Vinkt alle onderwerpen (van een thema) af voor de hele groep. Verlaagt nooit; alleen gewijzigde studenten. */
export function tickItemForGroup(group: readonly Student[], topicIds: readonly string[], now: string): Student[] {
  return group.flatMap((s) => {
    let next = s
    for (const id of topicIds) next = raiseStatus(next, id, 'geoefend', now)
    return next === s ? [] : [next]
  })
}

/** Vinkt een onderwerp af (minstens geoefend) voor de hele groep. Geeft alleen gewijzigde studenten terug. */
export function tickForGroup(group: readonly Student[], topicId: string, now: string): Student[] {
  return group.flatMap((s) => {
    const raised = raiseStatus(s, topicId, 'geoefend', now)
    return raised === s ? [] : [raised]
  })
}

// ---------- Opslaan ----------

export async function savePlan(store: Store, plan: WeekPlan): Promise<void> {
  await store.put('plans.json.enc', { ...plan, updatedAt: new Date().toISOString(), deletedAt: null })
  void store.sync()
}

export async function deletePlan(store: Store, plan: WeekPlan): Promise<Undo> {
  const now = new Date().toISOString()
  await store.put('plans.json.enc', { ...plan, updatedAt: now, deletedAt: now })
  void store.sync()
  return async () => {
    await store.put('plans.json.enc', { ...plan, updatedAt: new Date().toISOString(), deletedAt: null })
    void store.sync()
  }
}

// ---------- Delen ----------

export function slotLabel(slot: DaySlot, lang: Lang): string {
  return translate(lang, slot === 'ochtend' ? 'plan.morning' : slot === 'middag' ? 'plan.afternoon' : 'plan.evening')
}

/** Planning als platte tekst (WhatsApp), in de gekozen taal. Bevat geen studentnamen, alleen groepsnamen. */
export function planText(plan: WeekPlan, curricula: readonly Curriculum[], lang: Lang): string {
  const lines = [plan.title, formatDateRange(plan.startDate, planEnd(plan), lang)]
  for (const day of plan.days) {
    const blocks = sortBlocks(day.blocks)
    if (blocks.length === 0) continue
    lines.push('', capitalize(formatWeekday(day.date, lang)))
    for (const b of blocks) {
      const groups = plan.groups.filter((g) => b.groupIds.includes(g.id)).map((g) => g.name)
      lines.push([slotLabel(b.slot, lang), ...groups, ...(b.location ? [b.location] : [])].join(' · '))
      for (const item of blockItems(b, curricula, lang)) lines.push(`- ${item.title}`)
      if (b.note) lines.push(noteIn(b.note, lang))
    }
  }
  return lines.join('\n')
}

/** De standaardnotities van het concept ("Herhaling", "Examen") volgen de gekozen taal; eigen tekst blijft zoals hij is. */
export function noteIn(note: string, lang: Lang): string {
  for (const key of ['plan.reviewNote', 'plan.examNote'] as const) {
    if (LANGS.some((l) => translate(l, key) === note)) return translate(lang, key)
  }
  return note
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
