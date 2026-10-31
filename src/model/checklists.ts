import type { Lang } from '../i18n'
import type { Tx } from '../domain/tx'
import { localized } from './curricula'
import { SEED_CHECKLISTS } from './seed-checklists'
import { newId, type Checklist, type Trip, type WeekType } from './types'
import { nowIso } from '../basis/datum'

// Vaste checklists (checklists.json.enc): meegeleverde lijsten plus eigen of bewerkte. Per trip af te vinken (de
// vinkjes staan op de trip, `checks`); als sjabloon te bewerken (zelfde id, geldt voor alle trips).

const SEED_IDS = new Set(SEED_CHECKLISTS.map((c) => c.id))

/** Zichtbare lijsten: opgeslagen (niet verwijderd) plus meegeleverde die niet opgeslagen of verwijderd zijn. */
export function effectiveChecklists(stored: readonly Checklist[]): Checklist[] {
  const byId = new Map(stored.map((c) => [c.id, c]))
  const result: Checklist[] = []
  for (const seed of SEED_CHECKLISTS) {
    const own = byId.get(seed.id)
    if (!own) result.push(seed)
    else if (own.deletedAt === null) result.push(own)
  }
  for (const c of stored) if (!SEED_IDS.has(c.id) && c.deletedAt === null) result.push(c)
  return result
}

/** De lijsten voor een soort trip (lijsten zonder soort gelden altijd). */
export function checklistsFor(all: readonly Checklist[], type: WeekType): Checklist[] {
  return all.filter((c) => !c.tripTypes?.length || c.tripTypes.includes(type))
}

export function checkedItems(trip: Trip, list: Checklist): Set<string> {
  const own = new Set(list.items.map((i) => i.id))
  return new Set((trip.checks?.[list.id] ?? []).filter((id) => own.has(id)))
}

/** Een punt aan- of uitvinken op de trip. */
export async function toggleCheck(store: Tx, trip: Trip, listId: string, itemId: string): Promise<void> {
  const current = store.get('trips.json.enc').find((t) => t.id === trip.id) ?? trip
  const ticked = new Set(current.checks?.[listId] ?? [])
  if (ticked.has(itemId)) ticked.delete(itemId)
  else ticked.add(itemId)
  await store.put('trips.json.enc', { ...current, checks: { ...(current.checks ?? {}), [listId]: [...ticked] }, updatedAt: nowIso() })
}

export interface ChecklistEdit {
  title: string
  /** Bestaande punten houden hun id; nieuwe punten hebben geen id. */
  items: { id?: string; text: string }[]
}

/**
 * Sjabloon opslaan: de tekst in de huidige taal wordt bijgewerkt; nieuwe punten krijgen de tekst in beide talen.
 * Lege punten vallen weg.
 */
export async function saveChecklist(store: Tx, list: Checklist, edit: ChecklistEdit, lang: Lang): Promise<void> {
  const other: Lang = lang === 'nl' ? 'en' : 'nl'
  const items = edit.items
    .map((i) => ({ ...i, text: i.text.trim().slice(0, 200) }))
    .filter((i) => i.text !== '')
    .map((i) => {
      const old = i.id ? list.items.find((x) => x.id === i.id) : undefined
      if (!old) return { id: newId(), text: { nl: i.text, en: i.text } }
      if (localized(old.text, lang) === i.text) return old
      return { id: old.id, text: { ...old.text, [lang]: i.text, [other]: old.text[other] || i.text } as Checklist['title'] }
    })
  const title = edit.title.trim().slice(0, 120)
  const next: Checklist = {
    ...list,
    title: title && title !== localized(list.title, lang) ? { ...list.title, [lang]: title } : list.title,
    items,
    updatedAt: nowIso(),
  }
  await store.put('checklists.json.enc', next)
}

/** Nieuwe eigen lijst voor deze soort trip. */
export async function addChecklist(store: Tx, title: string, type: WeekType): Promise<Checklist> {
  const list: Checklist = { id: newId(), title: { nl: title.trim(), en: title.trim() }, items: [], tripTypes: [type], source: 'eigen', updatedAt: nowIso(), deletedAt: null }
  await store.put('checklists.json.enc', list)
  return list
}

/** Lijst verwijderen (een meegeleverde lijst wordt verborgen), met ongedaan maken. */
export async function deleteChecklist(store: Tx, list: Checklist): Promise<void> {
  const now = nowIso()
  await store.put('checklists.json.enc', { ...list, updatedAt: now, deletedAt: now })
}
