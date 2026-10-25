import { summarize, type SailingSummary } from '../model/derive'
import { newId, type Leg, type Role, type Trip } from '../model/types'

// Import van de mijlenregistratie (Excel → CSV UTF-8). Zonder bibliotheek.
// Scheidingsteken ; of , ; datums dd-mm-jjjj, jjjj-mm-dd of d/m/jj; getallen met of zonder " nm"/" bft".

export class ImportError extends Error {
  constructor(
    message: string,
    readonly row: number | null = null,
  ) {
    super(row === null ? message : `Rij ${row}: ${message}`)
    this.name = 'ImportError'
  }
}

export interface ImportResult {
  trips: Trip[]
  legs: Leg[]
  summary: SailingSummary
  /** Meldingen voor het controlescherm, bijvoorbeeld gecorrigeerde datums. Nooit inhoud van cellen. */
  warnings: string[]
}

const ROLE_MAP: Record<string, Role> = {
  schipper: 'schipper',
  'co-schipper': 'co-schipper',
  coschipper: 'co-schipper',
  bemanningslid: 'bemanningslid',
  trainee: 'trainee',
  instructeur: 'instructeur',
}

const MONTHS = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
]

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

export function parseMileageCsv(text: string, now: string = new Date().toISOString()): ImportResult {
  // Byte order mark van Excel/Windows weghalen.
  const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  const headerIndex = rows.findIndex((r) => (r[0] ?? '').trim().toLowerCase() === 'datum')
  if (headerIndex < 0) throw new ImportError('Kopregel met "Datum" niet gevonden')
  const columns = mapColumns(rows[headerIndex]!, headerIndex + 1)

  const trips: Trip[] = []
  const legs: Leg[] = []
  const warnings: string[] = []
  let trip: Trip | null = null
  let previousDate: string | null = null

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]!
    const rowNumber = i + 1
    if (row.every((c) => c.trim() === '')) {
      trip = null
      continue
    }
    const cell = (col: number) => (row[col] ?? '').trim()

    let date: string
    let dateEstimated = false
    if (cell(columns.date) === '') {
      if (previousDate === null) throw new ImportError('Datum ontbreekt op de eerste rij van het bestand', rowNumber)
      date = previousDate
      dateEstimated = true
    } else {
      const parsed = parseDate(cell(columns.date), rowNumber)
      date = parsed.date
      if (parsed.clamped) {
        dateEstimated = true
        warnings.push(`Rij ${rowNumber}: dag bestaat niet in die maand; laatste dag van de maand genomen (geschat)`)
      }
    }
    previousDate = date

    const role = ROLE_MAP[cell(columns.role).toLowerCase().replace(/\s+/g, '')]
    if (!role) throw new ImportError(`Onbekende rol "${cell(columns.role)}"`, rowNumber)
    const boat = cell(columns.boat)
    const notes = cell(columns.notes)

    if (trip === null) {
      trip = { id: newId(), name: notes || defaultTripName(boat, date), updatedAt: now, deletedAt: null }
      trips.push(trip)
    }
    const leg: Leg = {
      id: newId(),
      tripId: trip.id,
      date,
      fromPlace: cell(columns.fromPlace),
      fromCountry: cell(columns.fromCountry),
      toPlace: cell(columns.toPlace),
      toCountry: cell(columns.toCountry),
      role,
      boat,
      nmInland: parseNumber(cell(columns.inland), rowNumber),
      nmSea: parseNumber(cell(columns.sea), rowNumber),
      nmTidal: parseNumber(cell(columns.tidal), rowNumber),
      nightHours: parseNumber(cell(columns.night), rowNumber),
      dateEstimated,
      source: 'import',
      updatedAt: now,
      deletedAt: null,
    }
    const skipper = cell(columns.skipper)
    const coSkipper = cell(columns.coSkipper)
    const wind = cell(columns.wind).replace(/\s*bft\.?$/i, '')
    if (skipper) leg.skipperName = skipper
    if (coSkipper) leg.coSkipperName = coSkipper
    if (wind) leg.windBft = wind
    if (notes && legs.some((l) => l.tripId === trip!.id)) leg.notes = notes
    legs.push(leg)
  }
  if (legs.length === 0) throw new ImportError('Geen dagen gevonden onder de kopregel')
  return { trips, legs, summary: summarize(legs), warnings }
}

function mapColumns(header: string[], rowNumber: number): Columns {
  const names = header.map((h) => h.trim().toLowerCase())
  const find = (key: keyof Columns): number => {
    const want = HEADER_KEYS[key]
    // "zee" mag niet op "zee (getijnavigatie)" matchen; neem de kortste kolomnaam die begint met de sleutel.
    const candidates = names.map((n, i) => ({ n, i })).filter(({ n }) => n.startsWith(want))
    const exact = candidates.find(({ n }) => n === want)
    const best = exact ?? candidates.sort((a, b) => a.n.length - b.n.length)[0]
    if (!best) throw new ImportError(`Kolom "${want}" ontbreekt in de kopregel`, rowNumber)
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
 * Accepteert dd-mm-jjjj, d-m-jj, d/m/jjjj, d/m/jj en jjjj-mm-dd. Geeft jjjj-mm-dd.
 * Een dag die niet in de maand bestaat (31 juni, 30 februari) wordt de laatste dag van die maand, met `clamped`.
 */
export function parseDate(text: string, rowNumber: number | null = null): { date: string; clamped: boolean } {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const eu = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text)
  let y: number, m: number, d: number
  if (iso) {
    ;[y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  } else if (eu) {
    ;[d, m] = [Number(eu[1]), Number(eu[2])]
    y = eu[3]!.length === 2 ? 2000 + Number(eu[3]) : Number(eu[3])
  } else {
    throw new ImportError(`Datum "${text}" niet herkend`, rowNumber)
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) {
    throw new ImportError(`Datum "${text}" bestaat niet`, rowNumber)
  }
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const clamped = d > daysInMonth
  if (clamped) d = daysInMonth
  return { date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, clamped }
}

/** Leeg = 0. "12", "12,5", "12.5", "12 nm" en "4 uur" zijn geldig. */
export function parseNumber(text: string, rowNumber: number | null = null): number {
  const cleaned = text.replace(/\s*(nm|uur|u|h)\.?$/i, '').replace(',', '.').trim()
  if (cleaned === '') return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) throw new ImportError(`Getal "${text}" niet herkend`, rowNumber)
  return n
}

export function defaultTripName(boat: string, date: string): string {
  const [y, m] = date.split('-')
  const month = MONTHS[Number(m) - 1] ?? ''
  return `${boat} ${month} ${y}`.trim()
}

/** Eenvoudige CSV-lezer (RFC 4180): aanhalingstekens, dubbele aanhalingstekens, regeleinden in velden. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Kiest ; of , op basis van de kopregel; valt terug op het vaakst voorkomende teken. */
export function detectDelimiter(text: string): ';' | ',' {
  const lines = text.split(/\r?\n/)
  const header = lines.find((l) => l.toLowerCase().startsWith('datum')) ?? lines.slice(0, 10).join('\n')
  const semicolons = (header.match(/;/g) ?? []).length
  const commas = (header.match(/,/g) ?? []).length
  return semicolons >= commas ? ';' : ','
}
