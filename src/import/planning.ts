import { t } from '../i18n'
import { datesBetween, followTrip, type CalendarIndex } from '../model/calendar'
import { suggestType, weekFields, MAX_WEEK_DAYS, type WeekInput } from '../model/weeks'
import { DAY_TYPES, newId, ORGANISATIONS, WEEK_TYPES, type CalendarDay, type DayType, type Organisation, type Trip, type WeekType } from '../model/types'
import type { Lang } from '../i18n'
import type { Store } from '../storage/store'
import { withSalaryDefault } from '../model/salary'
import { currentSettings } from '../model/settings'
import { FileFormatError, readRowSources, type SheetCell } from './rows'

// Planning importeren uit CSV (of Excel) met de kolommen start, eind, soort, naam, type, organisatie, boot, gebied,
// notitie. Datums jjjj-mm-dd; soort = werk|rust|reis|thuis|onbeschikbaar|optie; type = het triptype bij werk. Werk wordt een trip,
// de andere soorten zelf ingestelde dagen. Eerst een voorbeeld met wat er gemaakt wordt en overlappingen met wat er
// al staat; overlappende regels worden alleen meegenomen als Olivier dat per regel aanzet. Meldingen noemen rijnummer
// en kolom, nooit de inhoud van een cel (regel 9).

export type PlanKind = Exclude<DayType, 'beschikbaar'>
const PLAN_KINDS: readonly PlanKind[] = DAY_TYPES.filter((d): d is PlanKind => d !== 'beschikbaar')

export interface PlanningRow {
  row: number
  start: string
  end: string
  kind: PlanKind
  name: string
  type?: WeekType
  organisation?: Organisation
  boat: string
  area: string
  note: string
}

const COLUMNS = {
  start: ['start', 'begin', 'van', 'from'],
  end: ['eind', 'einde', 'end', 'tot', 'to'],
  kind: ['soort', 'dagsoort', 'kind'],
  name: ['naam', 'name'],
  type: ['type', 'triptype'],
  organisation: ['organisatie', 'organisation', 'organization'],
  boat: ['boot', 'boat'],
  area: ['gebied', 'area'],
  note: ['notitie', 'note', 'notes'],
} as const

type Column = keyof typeof COLUMNS

const KIND_ALIASES: Record<string, PlanKind> = { work: 'werk', rest: 'rust', travel: 'reis', home: 'thuis', option: 'optie', unavailable: 'onbeschikbaar', 'niet beschikbaar': 'onbeschikbaar', bezet: 'onbeschikbaar', busy: 'onbeschikbaar' }

function norm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function slug(value: string): string {
  return norm(value).replace(/[\s_]+/g, '-')
}

function cellDate(cell: SheetCell | undefined): string | null {
  if (!cell) return null
  if (cell.isoDate) return cell.isoDate
  const text = cell.text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDate(text)
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)
  if (dmy) return validDate(`${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`)
  return null
}

function validDate(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

export class PlanningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanningError'
  }
}

/** Leest het bestand; stopt bij de eerste fout met rijnummer en kolom. */
export function parsePlanning(bytes: Uint8Array): PlanningRow[] {
  let sheets
  try {
    sheets = readRowSources(bytes).sheets
  } catch (error) {
    if (error instanceof FileFormatError) throw new PlanningError(error.message)
    throw error
  }
  for (const rows of sheets) {
    const headerIndex = rows.findIndex((r) => r.cells.some((c) => (COLUMNS.start as readonly string[]).includes(norm(c.text))) && r.cells.some((c) => (COLUMNS.end as readonly string[]).includes(norm(c.text))))
    if (headerIndex === -1) continue
    const header = rows[headerIndex]!.cells.map((c) => norm(c.text))
    const col = {} as Record<Column, number>
    for (const key of Object.keys(COLUMNS) as Column[]) col[key] = header.findIndex((h) => (COLUMNS[key] as readonly string[]).includes(h))
    if (col.kind === -1) throw new PlanningError(t('planning.missingColumn', { column: 'soort' }))
    const out: PlanningRow[] = []
    for (const r of rows.slice(headerIndex + 1)) {
      const cell = (key: Column) => (col[key] === -1 ? undefined : r.cells[col[key]])
      const text = (key: Column) => (cell(key)?.text ?? '').trim()
      if (r.cells.every((c) => c.text.trim() === '')) continue
      const start = cellDate(cell('start'))
      if (!start) throw new PlanningError(t('planning.badDate', { row: r.number, column: 'start' }))
      const end = text('end') === '' ? start : cellDate(cell('end'))
      if (!end) throw new PlanningError(t('planning.badDate', { row: r.number, column: 'eind' }))
      if (end < start) throw new PlanningError(t('planning.endBeforeStart', { row: r.number }))
      const rawKind = norm(text('kind'))
      const kind = (PLAN_KINDS as readonly string[]).includes(rawKind) ? (rawKind as PlanKind) : KIND_ALIASES[rawKind]
      if (!kind) throw new PlanningError(t('planning.badKind', { row: r.number }))
      const rawType = slug(text('type'))
      if (rawType && !(WEEK_TYPES as readonly string[]).includes(rawType)) throw new PlanningError(t('planning.badType', { row: r.number }))
      const rawOrg = slug(text('organisation'))
      if (rawOrg && !(ORGANISATIONS as readonly string[]).includes(rawOrg)) throw new PlanningError(t('planning.badOrganisation', { row: r.number }))
      if (kind === 'werk' && datesBetween(start, end).length > MAX_WEEK_DAYS) throw new PlanningError(t('planning.tooLong', { row: r.number, max: MAX_WEEK_DAYS }))
      out.push({
        row: r.number,
        start,
        end,
        kind,
        name: text('name').slice(0, 120),
        ...(rawType ? { type: rawType as WeekType } : {}),
        ...(rawOrg ? { organisation: rawOrg as Organisation } : {}),
        boat: text('boat').slice(0, 120),
        area: text('area').slice(0, 120),
        note: text('note').slice(0, 500),
      })
    }
    if (out.length === 0) throw new PlanningError(t('planning.empty'))
    return out
  }
  throw new PlanningError(t('planning.noHeader'))
}

export interface PlanItem {
  row: PlanningRow
  /** Werk wordt een trip; de andere soorten worden zelf ingestelde dagen. */
  creates: 'trip' | 'days'
  days: number
  /** Bestaande trips die in dezelfde periode vallen. */
  overlapTrips: string[]
  /** Dagen die al een eigen instelling hebben (bij werk: ook dagen in een bestaande trip). */
  overlapDays: number
  /** Precies deze trip staat er al (zelfde naam en startdatum): standaard overslaan. */
  duplicate: boolean
}

/** Het voorbeeld: wat er gemaakt wordt en wat overlapt. Schrijft niets. */
export function planImport(rows: readonly PlanningRow[], index: CalendarIndex): PlanItem[] {
  return rows.map((row) => {
    const dates = datesBetween(row.start, row.end)
    const overlapping = index.views.filter((v) => v.startDate <= row.end && row.start <= v.endDate)
    const ownDays = dates.filter((d) => index.own.has(d)).length
    const tripDays = dates.filter((d) => overlapping.some((v) => v.startDate <= d && d <= v.endDate)).length
    const duplicate = row.kind === 'werk' && overlapping.some((v) => v.startDate === row.start && v.trip.name.trim().toLowerCase() === (row.name || '').trim().toLowerCase())
    return {
      row,
      creates: row.kind === 'werk' ? 'trip' : 'days',
      days: dates.length,
      overlapTrips: overlapping.map((v) => v.trip.name),
      overlapDays: row.kind === 'werk' ? ownDays : Math.max(ownDays, tripDays),
      duplicate,
    }
  })
}

export function hasOverlap(item: PlanItem): boolean {
  return item.duplicate || item.overlapTrips.length > 0 || item.overlapDays > 0
}

/**
 * Importeren: regels zonder overlap altijd, overlappende alleen als hun rijnummer in `include` staat. Niets bestaands
 * wordt overschreven: een trip komt ernaast, zelf ingestelde dagen alleen bij aangezette regels.
 */
export async function applyPlan(store: Store, items: readonly PlanItem[], include: ReadonlySet<number>, lang: Lang): Promise<{ trips: number; days: number }> {
  const settings = currentSettings(store.list('settings.json.enc'))
  const now = new Date().toISOString()
  const trips: Trip[] = []
  const days = new Map<string, CalendarDay>()
  for (const item of items) {
    if (hasOverlap(item) && !include.has(item.row.row)) continue
    const { row } = item
    if (row.kind === 'werk') {
      const input: WeekInput = {
        name: row.name,
        type: row.type ?? suggestType(row.name),
        startDate: row.start,
        dayCount: datesBetween(row.start, row.end).length,
        boat: row.boat,
        boatModel: '',
        boatLengthFt: null,
        base: '',
        charter: '',
        area: row.area,
        ...(row.organisation ? { organisation: row.organisation } : {}),
        participants: [],
        note: row.note,
      }
      // Een werkregel met organisatie krijgt het standaardsalaris van die organisatie.
      trips.push(withSalaryDefault({ id: newId(), ...weekFields(input, lang), updatedAt: now, deletedAt: null }, settings))
    } else {
      for (const date of datesBetween(row.start, row.end)) {
        // Bij onbeschikbaar is de notitie de reden (die alleen Olivier ziet, nooit in een gedeelde PDF).
        const text = row.note ? (row.kind === 'onbeschikbaar' ? { reason: row.note.slice(0, 200) } : { note: row.note }) : {}
        days.set(date, { id: `dag:${date}`, date, type: row.kind, ...text, updatedAt: now, deletedAt: null })
      }
    }
  }
  if (days.size > 0) await store.putMany('calendar.json.enc', [...days.values()])
  if (trips.length > 0) {
    await store.putMany('trips.json.enc', trips)
    // Een aangezette werkregel over zelf ingestelde dagen: de agenda volgt de nieuwe trip.
    for (const trip of trips) await followTrip(store, trip.id, null, { start: trip.startDate!, end: trip.endDate! })
  }
  void store.sync()
  return { trips: trips.length, days: days.size }
}
