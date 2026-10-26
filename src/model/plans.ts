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
  type PlanBlock,
  type PlanGroup,
  type StudentLevel,
  type Student,
  type Topic,
  type WeekPlan,
} from './types'

// Weekplanning: dagen met blokken per dagdeel. Een concept wordt zonder netwerk gemaakt uit de cursussen van de
// groepen: theorie 's ochtends, praktijk 's middags, examenkritisch eerst, beginners rustiger, laatste dag herhaling
// en examen. Alles daarna is met tikken te bewerken.

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

/** Beginners: onderwerpen gelijk verdeeld over alle dagen (kleinste blokken). Verder minstens zoveel per blok,
 *  zodat er aan het eind ruimte overblijft om te oefenen. */
const MIN_PER_BLOCK: Record<StudentLevel, number> = { beginner: 0, gemiddeld: 3, gevorderd: 4 }

function examFirst(topics: readonly Topic[]): Topic[] {
  return [...topics.filter((t) => t.examCritical), ...topics.filter((t) => !t.examCritical)]
}

function chunks<T>(items: readonly T[], days: number, level: StudentLevel): T[][] {
  const size = Math.max(MIN_PER_BLOCK[level], Math.ceil(items.length / days), 1)
  return Array.from({ length: days }, (_, i) => items.slice(i * size, (i + 1) * size))
}

export function draftPlan(input: DraftInput, curricula: readonly Curriculum[], lang: Lang): WeekPlan {
  const dates = planDates(input.startDate, input.dayCount)
  const reviewDay = dates.length > 1
  const teachDays = reviewDay ? dates.length - 1 : dates.length
  const days = dates.map((date) => ({ date, blocks: [] as PlanBlock[] }))
  for (const group of input.groups) {
    const course = curricula.find((c) => c.id === group.curriculumId)
    if (!course) continue
    const topics = allTopics(course)
    const theory = chunks(examFirst(topics.filter((t) => t.kind === 'theorie')), teachDays, group.level)
    const practice = chunks(examFirst(topics.filter((t) => t.kind === 'praktijk')), teachDays, group.level)
    for (let i = 0; i < teachDays; i++) {
      const day = days[i]!
      if (theory[i]!.length > 0) day.blocks.push(block('ochtend', [group.id], theory[i]!.map((t) => t.id)))
      if (practice[i]!.length > 0) day.blocks.push(block('middag', [group.id], practice[i]!.map((t) => t.id)))
    }
    if (reviewDay) {
      const last = days[days.length - 1]!
      const critical = topics.filter((t) => t.examCritical).map((t) => t.id)
      last.blocks.push(block('ochtend', [group.id], critical, translate(lang, 'plan.reviewNote')))
      last.blocks.push(block('middag', [group.id], [], translate(lang, 'plan.examNote')))
    }
  }
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
  location?: string
  note?: string
}

export function updateBlock(plan: WeekPlan, blockId: string, patch: BlockPatch): WeekPlan {
  const location = patch.location?.trim().slice(0, MAX_TEXT)
  const note = patch.note?.trim().slice(0, 500)
  return mapBlocks(plan, (b) => {
    if (b.id !== blockId) return b
    const { location: _l, note: _n, ...rest } = b
    void [_l, _n]
    return { ...rest, groupIds: patch.groupIds, topicIds: patch.topicIds, ...(location ? { location } : {}), ...(note ? { note } : {}) }
  })
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

export function addBlock(plan: WeekPlan, date: string, slot: DaySlot, groupIds: string[]): { plan: WeekPlan; blockId: string } {
  const b = block(slot, groupIds, [])
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
  const topics = topicIndex(curricula)
  const lines = [plan.title, formatDateRange(plan.startDate, planEnd(plan), lang)]
  for (const day of plan.days) {
    const blocks = sortBlocks(day.blocks)
    if (blocks.length === 0) continue
    lines.push('', capitalize(formatWeekday(day.date, lang)))
    for (const b of blocks) {
      const groups = plan.groups.filter((g) => b.groupIds.includes(g.id)).map((g) => g.name)
      lines.push([slotLabel(b.slot, lang), ...groups, ...(b.location ? [b.location] : [])].join(' · '))
      for (const id of b.topicIds) {
        const found = topics.get(id)
        if (found) lines.push(`- ${localized(found.topic.title, lang)}`)
      }
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
