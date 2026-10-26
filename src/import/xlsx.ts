import { unzipSync } from 'fflate'
import { attr, child, childElements, parseXml, textContent, type XmlElement } from './xml'
import type { SheetCell, SheetRow } from './rows'

// Leest de werkbladen van een .xlsx zonder Excel-bibliotheek: fflate pakt uit, xml.ts leest de onderdelen.
// Formulecellen geven de opgeslagen waarde; ontbreekt die, dan krijgt de cel `formulaWithoutValue`.

export type XlsxErrorKey = 'import.xlsxNoWorkbook' | 'import.xlsxTooBig' | 'import.xlsxDamaged' | 'import.xlsxNoSheets'

export class XlsxError extends Error {
  constructor(readonly key: XlsxErrorKey) {
    super(key)
    this.name = 'XlsxError'
  }
}

export interface Sheet {
  name: string
  rows: SheetRow[]
}

/** Uitgepakt maximaal 100 MB: genoeg voor elke mijlenregistratie, te weinig voor een zip-bom. */
const MAX_UNZIPPED = 100 * 1024 * 1024
const decoder = new TextDecoder()

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzip(bytes)
  const read = (path: string): XmlElement | null => {
    const data = files[path]
    return data ? parseXml(decoder.decode(data)) : null
  }

  const workbookPath = officeDocumentPath(read('_rels/.rels'))
  const workbook = read(workbookPath)
  if (!workbook) throw new XlsxError('import.xlsxNoWorkbook')
  const dir = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1) : ''
  const rels = relationships(read(`${dir}_rels/${workbookPath.slice(dir.length)}.rels`), dir)

  const props = child(workbook, 'workbookPr')
  const date1904 = props !== undefined && isTrue(attr(props, 'date1904'))
  const sharedPath = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target ?? `${dir}sharedStrings.xml`
  const stylesPath = [...rels.values()].find((r) => r.type.endsWith('/styles'))?.target ?? `${dir}styles.xml`
  const strings = sharedStrings(read(sharedPath))
  const dateStyles = dateStyleIndexes(read(stylesPath))

  const sheets: Sheet[] = []
  for (const sheet of childElements(child(workbook, 'sheets') ?? emptyElement(), 'sheet')) {
    const id = attr(sheet, 'id')
    const target = id === undefined ? undefined : rels.get(id)?.target
    const xml = target === undefined ? null : read(target)
    if (!xml) continue
    sheets.push({ name: sheet.attrs.name ?? '', rows: sheetRows(xml, strings, dateStyles, date1904) })
  }
  if (sheets.length === 0) throw new XlsxError('import.xlsxNoSheets')
  return sheets
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0
  try {
    return unzipSync(bytes, {
      filter(file) {
        if (!/\.(xml|rels)$/i.test(file.name)) return false
        total += file.originalSize
        if (total > MAX_UNZIPPED) throw new XlsxError('import.xlsxTooBig')
        return true
      },
    })
  } catch (error) {
    if (error instanceof XlsxError) throw error
    throw new XlsxError('import.xlsxDamaged')
  }
}

function officeDocumentPath(rels: XmlElement | null): string {
  for (const r of rels ? childElements(rels, 'Relationship') : []) {
    if ((r.attrs.Type ?? '').endsWith('/officeDocument') && r.attrs.Target) return resolveTarget(r.attrs.Target, '')
  }
  return 'xl/workbook.xml'
}

function relationships(rels: XmlElement | null, dir: string): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>()
  for (const r of rels ? childElements(rels, 'Relationship') : []) {
    if (r.attrs.Id && r.attrs.Target) map.set(r.attrs.Id, { type: r.attrs.Type ?? '', target: resolveTarget(r.attrs.Target, dir) })
  }
  return map
}

/** "worksheets/sheet1.xml" t.o.v. "xl/", of absoluut "/xl/worksheets/sheet1.xml". */
function resolveTarget(target: string, dir: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

function sharedStrings(xml: XmlElement | null): string[] {
  // Fonetische hulptekst (rPh) en de bijbehorende lettergreepinfo horen niet bij de waarde.
  return xml ? childElements(xml, 'si').map((si) => textContent(si, ['rPh', 'phoneticPr'])) : []
}

// Ingebouwde getalnotaties voor datum en tijd (ECMA-376, 18.8.30), plus de Oost-Aziatische datumnotaties.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

/** Indexen in cellXfs (het s-attribuut van een cel) waarvan de notatie een datum of tijd is. */
function dateStyleIndexes(xml: XmlElement | null): Set<number> {
  const result = new Set<number>()
  if (!xml) return result
  const custom = new Map<number, string>()
  for (const f of childElements(child(xml, 'numFmts') ?? emptyElement(), 'numFmt')) {
    custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? '')
  }
  childElements(child(xml, 'cellXfs') ?? emptyElement(), 'xf').forEach((xf, index) => {
    const id = Number(xf.attrs.numFmtId ?? 0)
    const code = custom.get(id)
    if (code !== undefined ? isDateFormat(code) : BUILTIN_DATE_FORMATS.has(id)) result.add(index)
  })
  return result
}

/** Een notatie is een datum als er buiten tekst tussen aanhalingstekens en [kleur]-codes d, m, y, h of s in staat. */
export function isDateFormat(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '')
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(stripped.trim())
}

function sheetRows(xml: XmlElement, strings: string[], dateStyles: Set<number>, date1904: boolean): SheetRow[] {
  const data = child(xml, 'sheetData')
  if (!data) return []
  const rows: SheetRow[] = []
  let rowNumber = 0
  for (const row of childElements(data, 'row')) {
    rowNumber = row.attrs.r ? Number(row.attrs.r) : rowNumber + 1
    const cells: SheetCell[] = []
    let column = -1
    for (const c of childElements(row, 'c')) {
      column = c.attrs.r ? columnIndex(c.attrs.r) : column + 1
      cells[column] = readCell(c, strings, dateStyles, date1904)
    }
    for (let i = 0; i < cells.length; i++) cells[i] ??= { text: '' }
    rows.push({ number: rowNumber, cells })
  }
  return rows
}

function readCell(c: XmlElement, strings: string[], dateStyles: Set<number>, date1904: boolean): SheetCell {
  const type = c.attrs.t ?? 'n'
  const v = child(c, 'v')
  const value = v ? textContent(v) : undefined
  const hasFormula = child(c, 'f') !== undefined
  switch (type) {
    case 's':
      return { text: strings[Number(value)] ?? '' }
    case 'inlineStr': {
      const is = child(c, 'is')
      return { text: is ? textContent(is, ['rPh', 'phoneticPr']) : '' }
    }
    case 'str':
      return value === undefined && hasFormula ? { text: '', formulaWithoutValue: true } : { text: value ?? '' }
    case 'b':
      return { text: value === '1' ? 'WAAR' : value === '0' ? 'ONWAAR' : '' }
    case 'e':
      // #REF!, #VALUE! enz.: behandelen als een formule zonder bruikbare waarde.
      return { text: '', formulaWithoutValue: true }
    case 'd': {
      const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? '')
      return iso ? { text: iso[1]!, isoDate: iso[1]!, dateStyled: true } : { text: value ?? '' }
    }
    default: {
      if (value === undefined || value.trim() === '') return hasFormula ? { text: '', formulaWithoutValue: true } : { text: '' }
      const n = Number(value)
      if (!Number.isFinite(n)) return { text: value }
      const cell: SheetCell = { text: plainNumber(n), number: n, dateStyled: dateStyles.has(Number(c.attrs.s ?? 0)) }
      const iso = serialToIso(n, date1904)
      if (iso) cell.isoDate = iso
      return cell
    }
  }
}

/** Getal zonder wetenschappelijke notatie en zonder afrondingsruis (0,30000000000000004 → 0.3). */
function plainNumber(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

/** "AB12" → 27. */
export function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0)
    if (code < 65 || code > 90) break
    n = n * 26 + (code - 64)
  }
  return n - 1
}

/**
 * Excel-serienummer → jjjj-mm-dd. Systeem 1900: 1 = 1 januari 1900, inclusief de niet-bestaande 29 februari 1900
 * (serienummer 60). Systeem 1904 (date1904): 0 = 1 januari 1904. Tijd binnen de dag telt niet mee.
 */
export function serialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null
  const days = Math.floor(serial)
  let ms: number
  if (date1904) ms = Date.UTC(1904, 0, 1) + days * 86_400_000
  else if (days === 0 || days === 60) return null
  else ms = Date.UTC(1899, 11, days < 60 ? 31 : 30) + days * 86_400_000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  if (y > 9999) return null
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function isTrue(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function emptyElement(): XmlElement {
  return { name: '', attrs: {}, children: [] }
}
