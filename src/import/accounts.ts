import type { AccountProvider } from '../model/types'
import type { BalancePoint } from '../model/accounts'
import type { SheetCell, SheetRow } from './rows'

// Standen uit een export van de bank of broker (CSV of Excel, src/import/rows.ts). Alleen de stand per regel wordt
// gelezen en per maand de laatste bewaard; omschrijvingen, tegenrekeningen en bedragen per regel worden nooit
// opgeslagen. De voorinstellingen volgen de openbare exportformaten van ASN, Revolut, BUX en DEGIRO, maar zijn nog niet
// getest met een echte export van Olivier: wijkt een bestand af, dan koppelt hij de kolommen zelf (het scherm toont
// koppen en de eerste regel, alleen op het apparaat). Meldingen noemen rij en kolom, nooit celinhoud (regel 9).

/** Hoe een stand uit een regel volgt. */
export type ImportMode =
  /** Een kolom met het saldo ná de regel (Revolut, BUX). */
  | 'saldo'
  /** Het saldo vóór de regel plus het bedrag van de regel (ASN). */
  | 'voor-plus-bedrag'
  /** Alleen bedragen: vanaf het saldo nu terugrekenen. */
  | 'bedragen'
  /** De som van een kolom is één stand op een gekozen dag (DEGIRO Portefeuille: de waarde van alle posities). */
  | 'totaal'

export interface ColumnFilter {
  column: number
  /** Hoofdletterongevoelig gelijk. */
  value: string
}

export interface ColumnMapping {
  mode: ImportMode
  /** Index van de kopregel in de rijen; null = geen kopregel (ASN). */
  headerRow: number | null
  date: number | null
  /** Saldo ná de regel ('saldo'), of vóór de regel ('voor-plus-bedrag'). */
  balance: number | null
  amount: number | null
  /** De kolom die bij 'totaal' wordt opgeteld. */
  value: number | null
  filters: ColumnFilter[]
}

export type PresetId = 'asn' | 'revolut' | 'bux' | 'degiro-portefeuille'

export const PRESET_PROVIDER: Record<PresetId, AccountProvider> = { asn: 'asn', revolut: 'revolut', bux: 'bux', 'degiro-portefeuille': 'degiro' }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function findColumn(header: readonly SheetCell[], names: readonly string[]): number | null {
  const cells = header.map((c) => norm(c.text))
  for (const name of names) {
    const i = cells.indexOf(name)
    if (i >= 0) return i
  }
  return null
}

/** Eerst een bekende naam, anders een kop waarin het woord voorkomt ("Boekdatum", "Saldo (EUR)"). */
function guessColumn(header: readonly SheetCell[], names: readonly string[], pattern: RegExp): number | null {
  const exact = findColumn(header, names)
  if (exact !== null) return exact
  const i = header.findIndex((c) => pattern.test(norm(c.text)))
  return i >= 0 ? i : null
}

const DATE_NAMES = ['datum', 'date', 'boekingsdatum', 'transactiedatum', 'completed date', 'started date', 'transaction time', 'transaction time (cet)', 'valutadatum', 'value date']
const BALANCE_NAMES = ['saldo na mutatie', 'saldo na boeking', 'saldo', 'balance', 'cash balance amount', 'balance after']
const AMOUNT_NAMES = ['bedrag', 'amount', 'transactiebedrag', 'mutatie', 'transaction amount', 'bedrag (eur)', 'amount (eur)']
const VALUE_NAMES = ['waarde in eur', 'value in eur', 'waarde', 'value', 'marktwaarde', 'market value']

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/

const DATE_WORD = /datum|date|time|tijd/
const BALANCE_WORD = /saldo|balance/
const AMOUNT_WORD = /bedrag|amount|mutatie/
const VALUE_WORD = /waarde|value/

/**
 * De kopregel: de eerste rij (van de eerste tien) met een herkenbare datum- of waardekolom; anders een eerste regel
 * zonder datum boven een regel met een datum.
 */
function headerIndex(rows: readonly SheetRow[]): number | null {
  for (let i = 0; i < Math.min(10, rows.length); i++) if (guessColumn(rows[i]!.cells, DATE_NAMES, DATE_WORD) !== null || guessColumn(rows[i]!.cells, VALUE_NAMES, VALUE_WORD) !== null) return i
  const filled = rows.findIndex((r) => r.cells.some((c) => c.text.trim() !== ''))
  const hasDate = (r: SheetRow | undefined) => !!r && r.cells.some((c) => parseDate(c) !== null)
  return filled >= 0 && !hasDate(rows[filled]) && hasDate(rows[filled + 1]) ? filled : null
}

/** Herkent een export aan de inhoud: welke voorinstelling, en hoe de kolommen gekoppeld zijn. Null = zelf koppelen. */
export function detectPreset(rows: readonly SheetRow[], currency: string): { preset: PresetId; mapping: ColumnMapping } | null {
  const first = rows.find((r) => r.cells.some((c) => c.text.trim() !== ''))
  if (!first) return null
  // ASN: geen kopregel, negentien kolommen; boekingsdatum, eigen IBAN, ..., saldo vóór de mutatie (9), bedrag (11).
  if (first.cells.length >= 18 && parseDate(first.cells[0]!) && IBAN.test(first.cells[1]!.text.replace(/\s/g, ''))) {
    return { preset: 'asn', mapping: { mode: 'voor-plus-bedrag', headerRow: null, date: 0, balance: 8, amount: 10, value: null, filters: [] } }
  }
  const h = headerIndex(rows)
  if (h === null) return null
  const header = rows[h]!.cells
  const col = (names: readonly string[]) => findColumn(header, names)
  // Revolut: Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance.
  if (col(['completed date']) !== null && col(['balance']) !== null) {
    const filters: ColumnFilter[] = []
    const state = col(['state'])
    const cur = col(['currency'])
    const product = col(['product'])
    if (state !== null) filters.push({ column: state, value: 'COMPLETED' })
    if (cur !== null) filters.push({ column: cur, value: currency })
    if (product !== null) filters.push({ column: product, value: 'Current' })
    return { preset: 'revolut', mapping: { mode: 'saldo', headerRow: h, date: col(['completed date']), balance: col(['balance']), amount: col(['amount']), value: null, filters } }
  }
  // BUX: Transaction Time, …, Cash Balance Amount (alleen het geld op de rekening, niet de waarde van de aandelen).
  if (col(['cash balance amount']) !== null) {
    return { preset: 'bux', mapping: { mode: 'saldo', headerRow: h, date: col(['transaction time (cet)', 'transaction time']), balance: col(['cash balance amount']), amount: col(['transaction amount']), value: null, filters: [] } }
  }
  // DEGIRO Portefeuille: Product, Symbool/ISIN, Aantal, Slotkoers, Lokale waarde, Waarde in EUR.
  if (col(['waarde in eur', 'value in eur']) !== null) {
    return { preset: 'degiro-portefeuille', mapping: { mode: 'totaal', headerRow: h, date: null, balance: null, amount: null, value: col(['waarde in eur', 'value in eur']), filters: [] } }
  }
  return null
}

/** Een eerste gok voor zelf koppelen: kolommen op naam, anders leeg. */
export function guessMapping(rows: readonly SheetRow[]): ColumnMapping {
  const h = headerIndex(rows)
  const header = h === null ? [] : rows[h]!.cells
  const balance = guessColumn(header, BALANCE_NAMES, BALANCE_WORD)
  const amount = guessColumn(header, AMOUNT_NAMES, AMOUNT_WORD)
  const value = guessColumn(header, VALUE_NAMES, VALUE_WORD)
  const mode: ImportMode = balance !== null ? 'saldo' : amount !== null ? 'bedragen' : value !== null ? 'totaal' : 'saldo'
  return { mode, headerRow: h, date: guessColumn(header, DATE_NAMES, DATE_WORD), balance, amount, value, filters: [] }
}

/** De kolommen om uit te kiezen: de kop, of "Kolom 3" zonder kopregel; met de waarde op de eerste regel als voorbeeld. */
export function columnChoices(rows: readonly SheetRow[], headerRow: number | null): { index: number; header: string; sample: string }[] {
  const header = headerRow === null ? null : rows[headerRow]
  const sampleRow = rows.slice(headerRow === null ? 0 : headerRow + 1).find((r) => r.cells.some((c) => c.text.trim() !== ''))
  const width = Math.max(header?.cells.length ?? 0, sampleRow?.cells.length ?? 0)
  return Array.from({ length: width }, (_, index) => ({ index, header: header?.cells[index]?.text.trim() ?? '', sample: (sampleRow?.cells[index]?.text ?? '').trim().slice(0, 40) }))
}

/** jjjj-mm-dd uit een cel: Excel-datum, 2026-10-29 (ook met tijd), 29-10-2026, 29/10/2026, 29.10.2026, 20261029. */
export function parseDate(cell: SheetCell): string | null {
  if (cell.isoDate) return cell.isoDate
  const text = cell.text.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text)
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(text)
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!)
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!)
  return null
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Welk decimaalteken een kolom gebruikt: dat met twee cijfers erachter wint (1.234,56 en 1,234.56 en 12,50). */
export function decimalSeparator(values: readonly string[]): '.' | ',' {
  let dot = 0
  let comma = 0
  for (const v of values) {
    const t = v.trim()
    if (/,\d{1,2}$/.test(t)) comma++
    else if (/\.\d{1,2}$/.test(t)) dot++
  }
  return comma > dot ? ',' : '.'
}

/** Een bedrag: met teken (ook −, en (12,50) als negatief), valutateken, duizendtallen; null als het geen getal is. */
export function parseNumber(cell: SheetCell, decimal: '.' | ','): number | null {
  if (typeof cell.number === 'number' && Number.isFinite(cell.number)) return cell.number
  let t = cell.text.trim().replace(/[\u2212\u2012\u2013]/g, '-').replace(/[\u20ac$\u00a3\s\u00a0]|EUR|USD|GBP/gi, '')
  let negative = false
  if (/^\(.*\)$/.test(t)) {
    negative = true
    t = t.slice(1, -1)
  }
  if (t.endsWith('-')) {
    negative = !negative
    t = t.slice(0, -1)
  }
  if (t.startsWith('+')) t = t.slice(1)
  if (t.startsWith('-')) {
    negative = !negative
    t = t.slice(1)
  }
  const thousands = decimal === ',' ? '.' : ','
  t = t.split(thousands).join('')
  if (decimal === ',') t = t.replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return negative ? -n : n
}

export interface ImportResult {
  points: BalancePoint[]
  /** Regels met een stand. */
  used: number
  /** Overgeslagen regels (filter, lege regel). */
  skipped: number
  /** Rijnummers (zoals in het bestand) met een datum of bedrag dat niet te lezen is; nooit de inhoud. */
  problems: { row: number; column: number }[]
}

export class MappingIncompleteError extends Error {
  constructor() {
    super('Kolommen niet compleet')
    this.name = 'MappingIncompleteError'
  }
}

/**
 * Leest de standen volgens de koppeling. `currentBalance` is nodig bij 'bedragen' (het saldo na de laatste regel),
 * `onDate` bij 'totaal'. Per regel de stand ná die regel; de volgorde in het bestand telt binnen een dag (oplopend of
 * aflopend, herkend aan de eerste en laatste datum).
 */
export function readBalances(rows: readonly SheetRow[], mapping: ColumnMapping, options: { currentBalance?: number; onDate?: string } = {}): ImportResult {
  const body = rows.slice(mapping.headerRow === null ? 0 : mapping.headerRow + 1)
  const problems: { row: number; column: number }[] = []
  let skipped = 0
  const decimalOf = (column: number | null) => (column === null ? '.' : decimalSeparator(body.map((r) => r.cells[column]?.text ?? '')))
  const keep = (row: SheetRow) => row.cells.some((c) => c.text.trim() !== '') && mapping.filters.every((f) => norm(row.cells[f.column]?.text ?? '') === norm(f.value))

  if (mapping.mode === 'totaal') {
    if (mapping.value === null || !options.onDate) throw new MappingIncompleteError()
    const decimal = decimalOf(mapping.value)
    let sum = 0
    let used = 0
    for (const row of body) {
      if (!keep(row)) {
        skipped++
        continue
      }
      const cell = row.cells[mapping.value]
      if (!cell || cell.text.trim() === '') {
        skipped++
        continue
      }
      const n = parseNumber(cell, decimal)
      if (n === null) {
        problems.push({ row: row.number, column: mapping.value + 1 })
        continue
      }
      sum += n
      used++
    }
    return { points: used > 0 ? [{ date: options.onDate, amount: Math.round(sum * 100) / 100 }] : [], used, skipped, problems }
  }

  if (mapping.date === null) throw new MappingIncompleteError()
  const need = mapping.mode === 'saldo' ? [mapping.balance] : mapping.mode === 'voor-plus-bedrag' ? [mapping.balance, mapping.amount] : [mapping.amount]
  if (need.some((c) => c === null)) throw new MappingIncompleteError()
  if (mapping.mode === 'bedragen' && (options.currentBalance === undefined || !Number.isFinite(options.currentBalance))) throw new MappingIncompleteError()
  const balanceDecimal = decimalOf(mapping.balance)
  const amountDecimal = decimalOf(mapping.amount)

  const lines: { date: string; order: number; balance?: number; amount?: number }[] = []
  body.forEach((row, order) => {
    if (!keep(row)) {
      skipped++
      return
    }
    const date = parseDate(row.cells[mapping.date!] ?? { text: '' })
    if (!date) {
      problems.push({ row: row.number, column: mapping.date! + 1 })
      return
    }
    const line: { date: string; order: number; balance?: number; amount?: number } = { date, order }
    if (mapping.mode !== 'bedragen') {
      const b = parseNumber(row.cells[mapping.balance!] ?? { text: '' }, balanceDecimal)
      if (b === null) {
        problems.push({ row: row.number, column: mapping.balance! + 1 })
        return
      }
      line.balance = b
    }
    if (mapping.mode !== 'saldo') {
      const a = parseNumber(row.cells[mapping.amount!] ?? { text: '' }, amountDecimal)
      if (a === null) {
        problems.push({ row: row.number, column: mapping.amount! + 1 })
        return
      }
      line.amount = a
    }
    lines.push(line)
  })
  if (lines.length === 0) return { points: [], used: 0, skipped, problems }
  // Oplopend of aflopend (DEGIRO en sommige banken zetten de nieuwste regel bovenaan): binnen een dag telt de volgorde.
  const descending = lines[0]!.date > lines[lines.length - 1]!.date
  lines.sort((a, b) => a.date.localeCompare(b.date) || (descending ? b.order - a.order : a.order - b.order))
  let points: BalancePoint[]
  if (mapping.mode === 'saldo') points = lines.map((l) => ({ date: l.date, amount: l.balance! }))
  else if (mapping.mode === 'voor-plus-bedrag') points = lines.map((l) => ({ date: l.date, amount: Math.round((l.balance! + l.amount!) * 100) / 100 }))
  else {
    // Terugrekenen: na de laatste regel staat het saldo van nu; vóór elke regel het saldo erna min het bedrag.
    let after = options.currentBalance!
    const back: BalancePoint[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
      back.push({ date: lines[i]!.date, amount: Math.round(after * 100) / 100 })
      after -= lines[i]!.amount!
    }
    points = back.reverse()
  }
  return { points, used: lines.length, skipped, problems }
}

/** Per maand de laatste stand (zoals ze worden opgeslagen), voor het voorbeeld vóór importeren. */
export function monthlyPoints(points: readonly BalancePoint[]): BalancePoint[] {
  const perMonth = new Map<string, BalancePoint>()
  for (const p of points) {
    const known = perMonth.get(p.date.slice(0, 7))
    if (!known || p.date >= known.date) perMonth.set(p.date.slice(0, 7), p)
  }
  return [...perMonth.values()].sort((a, b) => a.date.localeCompare(b.date))
}
