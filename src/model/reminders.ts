import type { Tx } from '../domain/tx'
import { newId, type Reminder, type ReminderKind, type ReminderRepeat } from './types'
import { addDays, nowIso } from '../basis/datum'

// Termijnen: deadlines ("Vliegticket boeken, uiterlijk over 3 weken") en vervaldatums ("Pinpas verloopt over een jaar")
// samen, met de vervaldatum van de token en de start van de volgende trip erbij. Vandaag toont de eerstvolgende.

/** Snelle keuzes bij toevoegen: over 1 week, 3 weken, 1 maand, 3 maanden, 1 jaar. */
export const QUICK_OFFSETS = [
  { key: 'week1', days: 7 },
  { key: 'weeks3', days: 21 },
  { key: 'month1', months: 1 },
  { key: 'months3', months: 3 },
  { key: 'year1', months: 12 },
] as const

export type QuickOffset = (typeof QUICK_OFFSETS)[number]

/** Datum over een snelle keuze; maanden op dezelfde dag van de maand (31 januari + 1 maand = 28/29 februari). */
export function dateAfter(today: string, offset: QuickOffset): string {
  if ('days' in offset) return addDays(today, offset.days)
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const total = m - 1 + offset.months
  const year = y + Math.floor(total / 12)
  const month = total % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export interface DueItem {
  /** Id van de termijn; ontbreekt bij de token en de volgende trip. */
  id?: string
  title: string
  date: string
  kind: ReminderKind | 'trip'
  source: 'eigen' | 'token' | 'trip' | 'document' | 'career'
  repeat?: ReminderRepeat
}

/** Openstaande termijnen plus token en volgende trip, eerstvolgende eerst (verlopen bovenaan). */
export function dueItems(reminders: readonly Reminder[], extra: readonly DueItem[]): DueItem[] {
  const own: DueItem[] = reminders
    .filter((r) => r.deletedAt === null && !r.doneAt)
    .map((r) => ({ id: r.id, title: r.title, date: r.date, kind: r.kind, source: 'eigen', ...(r.repeat ? { repeat: r.repeat } : {}) }))
  return [...own, ...extra].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)))
}

export function doneReminders(reminders: readonly Reminder[]): Reminder[] {
  return reminders.filter((r) => r.deletedAt === null && !!r.doneAt).sort((a, b) => (a.doneAt! < b.doneAt! ? 1 : -1))
}

export interface ReminderInput {
  title: string
  date: string
  kind: ReminderKind
  note: string
  repeat?: ReminderRepeat
}

export async function saveReminder(store: Tx, input: ReminderInput, existing?: Reminder): Promise<Reminder> {
  const record: Reminder = {
    id: existing?.id ?? newId(),
    title: input.title.trim().slice(0, 120),
    date: input.date,
    kind: input.kind,
    doneAt: existing?.doneAt ?? null,
    ...(input.note.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
    ...(input.repeat ? { repeat: input.repeat } : {}),
    updatedAt: nowIso(),
    deletedAt: null,
  }
  await store.put('reminders.json.enc', record)
  return record
}

/** De volgende keer van een terugkerende termijn (zelfde dag van de maand, of de laatste dag). */
export function nextOccurrence(reminder: Pick<Reminder, 'date' | 'repeat'>): string {
  return dateAfter(reminder.date, reminder.repeat === 'jaarlijks' ? { key: 'year1', months: 12 } : { key: 'month1', months: 1 })
}

/**
 * Afronden of weer openzetten, met ongedaan maken. Een terugkerende termijn blijft open en schuift naar de volgende
 * keer.
 */
export async function setDone(store: Tx, reminder: Reminder, done: boolean, today: string): Promise<void> {
  const next = done && reminder.repeat ? { date: nextOccurrence(reminder), doneAt: null } : { doneAt: done ? today : null }
  await store.put('reminders.json.enc', { ...reminder, ...next, updatedAt: nowIso() })
}
