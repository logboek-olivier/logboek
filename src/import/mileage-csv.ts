import { tripShip } from '../model/boats'
import { summarize, type SailingSummary } from '../model/derive'
import { formatMonthName } from '../format'
import { t } from '../i18n'
import { roleLabel } from '../i18n/labels'
import { newId, ROLES, type Leg, type Role, type Trip } from '../model/types'
import { FileFormatError, readRowSources, type FileKind, type SheetCell, type SheetRow } from './rows'

// Import van de mijlenregistratie: het Excel-bestand (.xlsx) zelf of een export als CSV.
// Zonder bibliotheek voor CSV; voor Excel alleen fflate om uit te pakken (zie xlsx.ts).
// Meldingen noemen rijnummer en kolom, nooit de inhoud van een cel (beveiligingsregel 9).

export { parseCsv, detectDelimiter } from './csv'

export class ImportError extends Error {
  constructor(
    message: string,
    readonly row: number | null = null,
  ) {
    super(row === null ? message : t('import.row', { row, message }))
    this.name = 'ImportError'
  }
}

export interface ImportResult {
  trips: Trip[]
  legs: Leg[]
  summary: SailingSummary
  /** Meldingen per rijnummer voor het controlescherm. Nooit inhoud van cellen. */
  warnings: string[]
  kind: FileKind
}

const ROLE_MAP: Record<string, Role> = {
  schipper: 'schipper',
  skipper: 'schipper',
  'co-schipper': 'co-schipper',
  coschipper: 'co-schipper',
  'co-skipper': 'co-schipper',
  bemanningslid: 'bemanningslid',
  bemanning: 'bemanningslid',
  trainee: 'trainee',
  instructeur: 'instructeur',
  instructor: 'instructeur',
  crew: 'bemanningslid',
}

const roleList = () => ROLES.map((r) => roleLabel(r)).join(', ')

interface Columns {
  date: number
  fromPlace: number
  fromCountry: number
  toPlace: number
  toCountry: number
  role: number
  boat: number
  skipper: number
  coSkipper: number
  wind: number
  inland: number
  sea: number
  tidal: number
  night: number
  notes: number
}

const HEADER_KEYS: Record<keyof Columns, string> = {
  date: 'datum',
  fromPlace: 'van (plaats)',
  fromCountry: 'van (land)',
  toPlace: 'naar (plaats)',
  toCountry: 'naar (land)',
  role: 'rol',
  boat: 'schip',
  skipper: 'schipper/trainer',
  coSkipper: 'co-schipper',
  wind: 'wind',
  inland: 'binnenwater',
  sea: 'zee',
  tidal: 'zee (getij',
  night: 'nacht',
  notes: 'bijzonderheden',
}

/** Kolomnamen zoals in Oliviers kopregel, voor meldingen. */
const COLUMN_LABELS: Record<keyof Columns, string> = {
  date: 'Datum',
  fromPlace: 'Van (plaats)',
  fromCountry: 'Van (land)',
  toPlace: 'Naar (plaats)',
  toCountry: 'Naar (land)',
  role: 'Rol',
  boat: 'Schip',
  skipper: 'Schipper/trainer',
  coSkipper: 'Co-schipper (flot.leider)',
  wind: 'Wind (bft)',
  inland: 'Binnenwater',
  sea: 'Zee',
  tidal: 'Zee (getijnavigatie)',
  night: 'Nacht-uren',
  notes: 'Bijzonderheden',
}

/** Leest een gekozen bestand (CSV of .xlsx), herkend aan de inhoud. */
export function parseMileageFile(bytes: Uint8Array, now: string = new Date().toISOString()): ImportResult {
  let source: ReturnType<typeof readRowSources>
  try {
    source = readRowSources(bytes)
  } catch (error) {
    if (error instanceof FileFormatError) throw new ImportError(error.message)
    throw error
  }
  // Eerste werkblad met een kopregel; bij Oliviers bestand is dat "Sheet1" (het tweede blad is de rollenlijst).
  const sheet = source.sheets.find((rows) => findHeader(rows) >= 0)
  if (!sheet) throw new ImportError(noHeaderMessage(source.kind))
  return { ...parseMileageRows(sheet, now), kind: source.kind }
}

/** Voor tests en oudere aanroepen: CSV als tekst. */
export function parseMileageCsv(text: string, now: string = new Date().toISOString()): ImportResult {
  return parseMileageFile(new TextEncoder().encode(text), now)
}

function noHeaderMessage(kind: FileKind): string {
  return t(kind === 'xlsx' ? 'import.noHeaderXlsx' : 'import.noHeaderCsv')
}

function findHeader(rows: readonly SheetRow[]): number {
  return rows.findIndex((r) => {
    const first = r.cells.find((c) => c.text.trim() !== '')
    return first !== undefined && first.text.trim().toLowerCase() === 'datum'
  })
}

export function parseMileageRows(rows: readonly SheetRow[], now: string): Omit<ImportResult, 'kind'> {
  const headerIndex = findHeader(rows)
  if (headerIndex < 0) throw new ImportError(noHeaderMessage('csv'))
  const header = rows[headerIndex]!
  const columns = mapColumns(header.cells, header.number)

  const trips: Trip[] = []
  const legs: Leg[] = []
  const warnings: string[] = []
  let trip: Trip | null = null
  let previousDate: string | null = null

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]!
    const rowNumber = row.number
    const raw = (col: number): SheetCell => row.cells[col] ?? { text: '' }
    const text = (col: number): string => {
      const c = raw(col)
      return c.text.trim()
    }

    // Een rij zonder dag-inhoud scheidt tochten. Datum (soms een formule als =A23+1), Totaal (formule) en wind
    // tellen daarvoor niet mee, zodat doorgetrokken formules geen lege dagen opleveren.
    const content = [columns.fromPlace, columns.toPlace, columns.role, columns.boat, columns.fromCountry, columns.toCountry, columns.skipper, columns.coSkipper]
    const hasNm = [columns.inland, columns.sea, columns.tidal, columns.night].some((c) => text(c) !== '' && text(c) !== '0')
    if (!content.some((c) => text(c) !== '') && !hasNm) {
      if (text(columns.notes) !== '') warnings.push(t('import.warnOnlyNotes', { row: rowNumber, column: COLUMN_LABELS.notes }))
      trip = null
      continue
    }

    let date: string
    let dateEstimated = false
    const dateCell = raw(columns.date)
    if (dateCell.formulaWithoutValue) {
      if (previousDate === null) throw new ImportError(t('import.dateFormulaFirst'), rowNumber)
      date = previousDate
      dateEstimated = true
      warnings.push(t('import.warnDateFormula', { row: rowNumber }))
    } else if (dateCell.isoDate !== undefined) {
      date = checkYear(dateCell.isoDate, rowNumber)
    } else if (text(columns.date) === '') {
      if (previousDate === null) throw new ImportError(t('import.dateMissingFirst'), rowNumber)
      date = previousDate
      dateEstimated = true
    } else {
      const parsed = parseDate(text(columns.date), rowNumber)
      date = parsed.date
      if (parsed.clamped) {
        dateEstimated = true
        warnings.push(t('import.warnDayClamped', { row: rowNumber }))
      }
    }
    previousDate = date

    const roleText = text(columns.role)
    const role = ROLE_MAP[roleText.toLowerCase().replace(/\s+/g, '')]
    if (!role) {
      throw new ImportError(
        t(roleText === '' ? 'import.roleMissing' : 'import.roleUnknown', { column: COLUMN_LABELS.role, roles: roleList() }),
        rowNumber,
      )
    }
    const boat = text(columns.boat)
    const notes = text(columns.notes)
    const number = (key: 'inland' | 'sea' | 'tidal' | 'night'): number => {
      const c = raw(columns[key])
      if (c.formulaWithoutValue) {
        warnings.push(t('import.warnNumberFormula', { row: rowNumber, column: COLUMN_LABELS[key] }))
        return 0
      }
      if (c.number !== undefined) {
        if (c.number < 0) throw new ImportError(t('import.negative', { column: COLUMN_LABELS[key] }), rowNumber)
        return c.number
      }
      return parseNumber(c.text.trim(), rowNumber, COLUMN_LABELS[key])
    }

    if (trip === null) {
      trip = { id: newId(), name: notes || defaultTripName(boat, date), updatedAt: now, deletedAt: null }
      trips.push(trip)
    }
    const leg: Leg = {
      id: newId(),
      tripId: trip.id,
      date,
      fromPlace: text(columns.fromPlace),
      fromCountry: text(columns.fromCountry),
      toPlace: text(columns.toPlace),
      toCountry: text(columns.toCountry),
      role,
      boat,
      nmInland: number('inland'),
      nmSea: number('sea'),
      nmTidal: number('tidal'),
      nightHours: number('night'),
      dateEstimated,
      source: 'import',
      updatedAt: now,
      deletedAt: null,
    }
    const skipper = text(columns.skipper)
    const coSkipper = text(columns.coSkipper)
    const wind = windText(raw(columns.wind))
    if (skipper) leg.skipperName = skipper
    if (coSkipper) leg.coSkipperName = coSkipper
    if (wind) leg.windBft = wind
    if (notes && legs.some((l) => l.tripId === trip!.id)) leg.notes = notes
    legs.push(leg)
  }
  if (legs.length === 0) throw new ImportError(t('import.noDays', { row: header.number }))
  // Boten: "Naam (Model)" uit de kolom Schip wordt naam en model van de trip. De lengte blijft een voorstel
  // (scherm Bootgegevens controleren) en wordt hier nooit ingevuld.
  for (const trip of trips) {
    const ship = tripShip(trip, legs)
    if (ship.name) trip.boat = ship.name
    if (ship.model) trip.boatModel = ship.model
  }
  return { trips, legs, summary: summarize(legs), warnings }
}

/**
 * Wind is tekst ("3-4"). Excel maakt van een getypte "3-4" soms 3 april; zo'n cel met datumnotatie wordt
 * weer "3-4". Een gewoon getal blijft een getal.
 */
function windText(cell: SheetCell): string {
  if (cell.number !== undefined && cell.dateStyled && cell.isoDate) {
    const [, m, d] = cell.isoDate.split('-')
    return `${Number(d)}-${Number(m)}`
  }
  return cell.text.trim().replace(/\s*bft\.?$/i, '')
}

function checkYear(iso: string, rowNumber: number): string {
  const y = Number(iso.slice(0, 4))
  if (y < 1990 || y > 2100) throw new ImportError(t('import.dateRange'), rowNumber)
  return iso
}

function mapColumns(header: readonly SheetCell[], rowNumber: number): Columns {
  const names = header.map((h) => h.text.trim().toLowerCase().replace(/\s+/g, ' '))
  const find = (key: keyof Columns): number => {
    const want = HEADER_KEYS[key]
    // "zee" mag niet op "zee (getijnavigatie)" matchen; neem de kortste kolomnaam die begint met de sleutel.
    const candidates = names.map((n, i) => ({ n, i })).filter(({ n }) => n.startsWith(want))
    const exact = candidates.find(({ n }) => n === want)
    const best = exact ?? candidates.sort((a, b) => a.n.length - b.n.length)[0]
    if (!best) throw new ImportError(t('import.columnMissing', { column: COLUMN_LABELS[key] }), rowNumber)
    return best.i
  }
  return {
    date: find('date'),
    fromPlace: find('fromPlace'),
    fromCountry: find('fromCountry'),
    toPlace: find('toPlace'),
    toCountry: find('toCountry'),
    role: find('role'),
    boat: find('boat'),
    skipper: find('skipper'),
    coSkipper: find('coSkipper'),
    wind: find('wind'),
    inland: find('inland'),
    sea: find('sea'),
    tidal: find('tidal'),
    night: find('night'),
    notes: find('notes'),
  }
}

/**
 * Accepteert d-m-jjjj, dd-mm-jjjj, d-m-jj, d/m/jjjj, d.m.jjjj en jjjj-mm-dd (ook zonder voorloopnullen). Geeft jjjj-mm-dd.
 * Een dag die niet in de maand bestaat (31 juni, 30 februari) wordt de laatste dag van die maand, met `clamped`.
 */
export function parseDate(text: string, rowNumber: number | null = null): { date: string; clamped: boolean } {
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)
  const eu = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text)
  let y: number, m: number, d: number
  if (iso) {
    ;[y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  } else if (eu) {
    ;[d, m] = [Number(eu[1]), Number(eu[2])]
    y = eu[3]!.length === 2 ? 2000 + Number(eu[3]) : Number(eu[3])
  } else {
    throw new ImportError(t('import.dateUnknown'), rowNumber)
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) {
    throw new ImportError(t('import.dateInvalid'), rowNumber)
  }
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const clamped = d > daysInMonth
  if (clamped) d = daysInMonth
  return { date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, clamped }
}

/** Leeg = 0. "12", "12,5", "12.5", "12 nm" en "4 uur" zijn geldig. */
export function parseNumber(text: string, rowNumber: number | null = null, column: string = t('import.numberColumns')): number {
  const cleaned = text.replace(/\s*(nm|uur|u|h)\.?$/i, '').replace(',', '.').trim()
  if (cleaned === '' || cleaned === '-') return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) throw new ImportError(t('import.numberUnknown', { column }), rowNumber)
  return n
}

export function defaultTripName(boat: string, date: string): string {
  const [y, m] = date.split('-')
  const month = m ? formatMonthName(Number(m)) : ''
  return `${boat} ${month} ${y}`.trim()
}
