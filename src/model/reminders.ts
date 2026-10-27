import type { Store } from '../storage/store'
import type { Undo } from './edit'
import { addDays } from './money'
import { newId, nowIso, type Reminder, type ReminderKind } from './types'

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
  source: 'eigen' | 'token' | 'trip'
}

/** Openstaande termijnen plus token en volgende trip, eerstvolgende eerst (verlopen bovenaan). */
export function dueItems(reminders: readonly Reminder[], extra: readonly DueItem[]): DueItem[] {
  const own: DueItem[] = reminders
    .filter((r) => r.deletedAt === null && !r.doneAt)
    .map((r) => ({ id: r.id, title: r.title, date: r.date, kind: r.kind, source: 'eigen' }))
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
}

export async function saveReminder(store: Store, input: ReminderInput, existing?: Reminder): Promise<Reminder> {
  const record: Reminder = {
    id: existing?.id ?? newId(),
    title: input.title.trim().slice(0, 120),
    date: input.date,
    kind: input.kind,
    doneAt: existing?.doneAt ?? null,
    ...(input.note.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
    updatedAt: nowIso(),
    deletedAt: null,
  }
  await store.put('reminders.json.enc', record)
  void store.sync()
  return record
}

/** Afronden of weer openzetten, met ongedaan maken. */
export async function setDone(store: Store, reminder: Reminder, done: boolean, today: string): Promise<Undo> {
  const before = reminder
  await store.put('reminders.json.enc', { ...reminder, doneAt: done ? today : null, updatedAt: nowIso() })
  void store.sync()
  return async () => {
    await store.put('reminders.json.enc', { ...before, updatedAt: nowIso() })
    void store.sync()
  }
}
