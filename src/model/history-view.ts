import { HISTORY_DAYS, HISTORY_PATH } from '../domain/history'
import type { Reader } from '../domain/tx'
import { active } from './derive'
import type { CollectionPath, HistoryChange, HistoryEntry } from './types'

// Meer → Geschiedenis (en per dag en per periode): wat de opdrachten van de laatste 30 dagen veranderden, nieuwste
// eerst, met "Terugzetten" (src/domain/prullenbak.ts, restoreEntry). Alles uit history.json.enc; leest alleen.

export interface HistoryRow {
  entry: HistoryEntry
  /** Per gewijzigd record: wat het is, en wat er gebeurde. */
  changes: HistoryLine[]
}

export interface HistoryLine {
  path: CollectionPath
  /** Het record zoals het nu is (of de tombstone); kan ontbreken op dit apparaat. */
  record: Record<string, unknown> | null
  what: 'nieuw' | 'verwijderd' | 'teruggezet' | 'gewijzigd'
  /** Gewijzigde velden (zonder deletedAt). */
  fields: string[]
}

export interface HistoryFilter {
  /** Alleen wat een periode raakt: de trip of periode aan land zelf, of wat eraan hangt. */
  periodId?: string
  /** Alleen wat een dag raakt: een gelogde dag, geld of een agendadag op die datum, of een periode die hem bevat. */
  date?: string
}

const DAY_MS = 86_400_000

function value(record: Record<string, unknown> | null, change: HistoryChange, key: string): unknown {
  return record?.[key] ?? change.after[key] ?? change.before?.[key]
}

function line(reader: Reader, change: HistoryChange): HistoryLine {
  const record = (reader.get(change.path as CollectionPath).find((r) => r.id === change.id) as unknown as Record<string, unknown> | undefined) ?? null
  const fields = Object.keys(change.after).filter((k) => k !== 'deletedAt')
  const deleted = typeof change.after.deletedAt === 'string' && (change.before === null || !change.before.deletedAt)
  const undeleted = change.before !== null && typeof change.before.deletedAt === 'string' && change.after.deletedAt === null
  const what = change.before === null ? 'nieuw' : deleted ? 'verwijderd' : undeleted ? 'teruggezet' : 'gewijzigd'
  return { path: change.path as CollectionPath, record, what, fields }
}

function touchesPeriod(line: HistoryLine, change: HistoryChange, periodId: string): boolean {
  if ((line.path === 'trips.json.enc' || line.path === 'periods.json.enc') && change.id === periodId) return true
  for (const key of ['tripId', 'weekId'] as const) {
    if (value(line.record, change, key) === periodId) return true
    if (change.before?.[key] === periodId || change.after[key] === periodId) return true
  }
  return false
}

function touchesDate(line: HistoryLine, change: HistoryChange, date: string): boolean {
  const own = value(line.record, change, 'date')
  if (own === date || change.before?.date === date || change.after.date === date) return true
  const start = value(line.record, change, 'startDate')
  const end = value(line.record, change, 'endDate')
  return (line.path === 'trips.json.enc' || line.path === 'periods.json.enc') && typeof start === 'string' && typeof end === 'string' && start <= date && date <= end
}

/** De geschiedenis van de laatste 30 dagen, nieuwste eerst; opgeruimde regels (zonder inhoud) staan er niet in. */
export function historyRows(reader: Reader, filter: HistoryFilter = {}, now = new Date().toISOString()): HistoryRow[] {
  return active(reader.get(HISTORY_PATH))
    .filter((e) => e.changes.length > 0 && Date.parse(now) - Date.parse(e.at) <= HISTORY_DAYS * DAY_MS)
    .map((entry) => ({ entry, changes: entry.changes.map((c) => line(reader, c)) }))
    .filter((row) => {
      if (filter.periodId && !row.entry.changes.some((c, i) => touchesPeriod(row.changes[i]!, c, filter.periodId!))) return false
      if (filter.date && !row.entry.changes.some((c, i) => touchesDate(row.changes[i]!, c, filter.date!))) return false
      return true
    })
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at))
}

/** Kan deze regel nog terug? Niet als hij al teruggezet is. */
export function canRevert(entry: HistoryEntry): boolean {
  return !entry.undoneAt && entry.changes.length > 0
}

