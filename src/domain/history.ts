import { sameValue } from '../basis/gelijk'
import { deviceId } from '../storage/device'
import { newId, type CollectionPath, type HistoryChange, type HistoryEntry, type SyncRecord } from '../model/types'

// De geschiedenis (history.json.enc, docs/FUNDERING.md): elke opdracht schrijft in dezelfde transactie één regel met
// per gewijzigd record de velden vooraf en erna. De prullenbak en "Terugzetten" werken hiermee. Na 30 dagen gaat de
// inhoud weg (src/model/trash.ts, `pruneHistory`).

/** Zo lang staat iets in de prullenbak en de geschiedenis. */
export const HISTORY_DAYS = 30

export const HISTORY_PATH = 'history.json.enc' satisfies CollectionPath

/**
 * Opdrachten zonder regel in de geschiedenis: vanzelf (koersen, vaste lasten, archiveren, de omzetting), in bulk
 * (importeren, back-up terugzetten: daar is een eigen ongedaan maken voor), wissen (regel 14: de naam mag nergens blijven
 * staan) en het opruimen van de geschiedenis zelf.
 */
const WITHOUT_HISTORY: ReadonlySet<string> = new Set([
  'test',
  'demoVullen',
  'ongedaanMaken',
  'periodemodelMigreren',
  'studentenArchiveren',
  'studentenWissen',
  'planningImporteren',
  'standenImporteren',
  'backupTerugzetten',
  'geschiedenisOpruimen',
  'instellingenOpslaan',
])

export function keepsHistory(command: string): boolean {
  return !WITHOUT_HISTORY.has(command)
}

/**
 * Bestanden met persoonlijke of gevoelige inhoud (studenten, regel 14; carrière, rekeningen en standen, zie de
 * geschoonde tombstones): de geschiedenis bewaart daar alleen of iets verwijderd of gekoppeld werd, nooit de inhoud.
 * Instellingen en de geschiedenis zelf staan er niet in.
 */
const ONLY_LINKS: ReadonlySet<string> = new Set(['students.json.enc', 'career.json.enc', 'accounts.json.enc', 'balances.json.enc'])
const LINK_FIELDS: ReadonlySet<string> = new Set(['deletedAt', 'archivedAt', 'weekId', 'tripId', 'accountId'])
const SKIPPED: ReadonlySet<string> = new Set(['settings.json.enc', HISTORY_PATH])

const equal = sameValue

/** Eén gewijzigd record als regel: alleen de velden die veranderden (zonder updatedAt). */
export function historyChange(path: CollectionPath, before: SyncRecord | null, after: SyncRecord): HistoryChange | null {
  if (SKIPPED.has(path)) return null
  const allowed = (key: string) => key !== 'updatedAt' && (!ONLY_LINKS.has(path) || LINK_FIELDS.has(key))
  const a = after as unknown as Record<string, unknown>
  // Nieuw: alleen dat het nieuw is (de inhoud staat in het bestand zelf), zodat de geschiedenis klein blijft. Een nieuwe
  // tombstone (een meegeleverde cursus die nooit bewaard was) houdt zijn tijd van verwijderen.
  if (!before) return { path, id: after.id, before: null, after: after.deletedAt ? { deletedAt: after.deletedAt } : {} }
  const b = before as unknown as Record<string, unknown>
  const was: Record<string, unknown> = {}
  const now: Record<string, unknown> = {}
  const unset: string[] = []
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!allowed(key) || equal(b[key], a[key])) continue
    // Een veld dat er vooraf niet was: in `unset` (JSON kent geen undefined; null is een echte waarde).
    if (b[key] === undefined) unset.push(key)
    was[key] = b[key] === undefined ? null : b[key]
    now[key] = a[key] === undefined ? null : a[key]
  }
  if (Object.keys(now).length === 0) return null
  return { path, id: after.id, before: was, after: now, ...(unset.length > 0 ? { unset } : {}) }
}

/** De regel voor een opdracht; null als er niets te bewaren is. */
export function historyEntry(command: string, at: string, written: ReadonlyArray<{ path: CollectionPath; before: SyncRecord | null; after: SyncRecord }>): HistoryEntry | null {
  if (!keepsHistory(command)) return null
  const changes = written.map((w) => historyChange(w.path, w.before, w.after)).filter((c): c is HistoryChange => c !== null)
  if (changes.length === 0) return null
  return { id: newId(), at, command, device: deviceId(), changes, undoneAt: null, updatedAt: at, deletedAt: null }
}

/** Een record dat zoveel later gewijzigd is dan de opdracht die hem maakte, is daarna bewerkt (een opdracht schrijft alles binnen een tel). */
const LATER_MS = 5_000

/**
 * Een record terug zoals vóór de regel: per veld de waarde vooraf, alleen waar nog de waarde erna staat (een latere
 * wijziging blijft staan). Een record dat de regel nieuw maakte, wordt verwijderd. Null: niets terug te zetten.
 */
export function revertChange(
  current: SyncRecord,
  change: HistoryChange,
  now: string,
  /** Hoe een record weggaat (persoonlijke gegevens zonder inhoud, src/domain/tombstone.ts). */
  gone: (path: string, record: SyncRecord, now: string) => SyncRecord = (_path, record, at) => ({ ...record, updatedAt: at, deletedAt: at }),
  /** Tijd van de opdracht: wat hij nieuw maakte en daarna nog gewijzigd werd, blijft staan (een latere bewerking gaat nooit stil verloren). */
  entryAt?: string,
): SyncRecord | null {
  const next: Record<string, unknown> = { ...current }
  if (change.before === null) {
    // Nieuw als tombstone: weer zichtbaar; nieuw: weer weg.
    if (change.after.deletedAt) return current.deletedAt === change.after.deletedAt ? ({ ...current, deletedAt: null, updatedAt: now } as SyncRecord) : null
    if (current.deletedAt !== null) return null
    if (entryAt && Date.parse(current.updatedAt) - Date.parse(entryAt) > LATER_MS) return null
    return gone(change.path, current, now)
  }
  let changed = false
  for (const [key, after] of Object.entries(change.after)) {
    const value = next[key] === undefined ? null : next[key]
    if (!equal(value, after)) continue
    // Vooraf afwezig: weer weg; vooraf null: weer null (bijvoorbeeld doneAt).
    if (change.unset?.includes(key) || change.before[key] === undefined) delete next[key]
    else next[key] = change.before[key]
    changed = true
  }
  // deletedAt hoort altijd te bestaan (null = niet verwijderd).
  if (changed && next.deletedAt === undefined) next.deletedAt = null
  // Begin en eind horen bij elkaar: is er na de opdracht maar één van de twee gewijzigd, dan zou per veld terugzetten
  // een begin na het eind kunnen geven. Dan blijven beide zoals ze nu zijn.
  const [start, end] = [next.startDate, next.endDate]
  if (typeof start === 'string' && typeof end === 'string' && start > end) {
    next.startDate = (current as unknown as Record<string, unknown>).startDate
    next.endDate = (current as unknown as Record<string, unknown>).endDate
  }
  return changed ? ({ ...next, updatedAt: now } as unknown as SyncRecord) : null
}
