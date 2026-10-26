import { parseCsv } from './csv'
import { readXlsx, XlsxError } from './xlsx'

// Gemeenschappelijke vorm voor CSV en Excel: rijen met het rijnummer zoals Olivier het in Excel ziet.

export interface SheetCell {
  /** Tekst zoals getoond; bij getallen zonder duizendtallen en met een punt als decimaalteken. */
  text: string
  /** Alleen bij Excel: de getalwaarde van de cel. */
  number?: number
  /** Alleen bij Excel: het getal gelezen als datum-serienummer (jjjj-mm-dd). */
  isoDate?: string
  /** Alleen bij Excel: de cel heeft een datumnotatie. */
  dateStyled?: boolean
  /** Alleen bij Excel: formule zonder opgeslagen waarde (of met een foutwaarde). */
  formulaWithoutValue?: boolean
}

export interface SheetRow {
  /** Rijnummer in het bestand, vanaf 1. */
  number: number
  cells: SheetCell[]
}

export class FileFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileFormatError'
  }
}

export type FileKind = 'csv' | 'xlsx'

/** Max 10 MB: de mijlenregistratie is een paar honderd kB. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Herkent het bestand aan de inhoud, niet aan naam of MIME-type (Android en Google Drive geven die niet betrouwbaar).
 * Excel (.xlsx) begint met "PK"; al het andere wordt als tekst (CSV) gelezen.
 */
export function readRowSources(bytes: Uint8Array): { kind: FileKind; sheets: SheetRow[][] } {
  if (bytes.length === 0) throw new FileFormatError('Het bestand is leeg.')
  if (bytes.length > MAX_FILE_BYTES) throw new FileFormatError('Het bestand is te groot (maximaal 10 MB).')
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return { kind: 'xlsx', sheets: readXlsx(bytes).map((s) => s.rows) }
    } catch (error) {
      if (error instanceof XlsxError) throw new FileFormatError(`${error.message}.`)
      throw new FileFormatError('Excel-bestand is beschadigd of niet leesbaar.')
    }
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new FileFormatError('Oud Excel-formaat (.xls) wordt niet ondersteund. Sla het bestand op als Excel-werkmap (.xlsx) of als CSV UTF-8.')
  }
  const text = decodeText(bytes)
  if (text.includes('\u0000')) throw new FileFormatError('Dit is geen CSV- of Excel-bestand.')
  const rows = parseCsv(text).map((cells, i) => ({ number: i + 1, cells: cells.map((t) => ({ text: t })) }))
  return { kind: 'csv', sheets: [rows] }
}

/** UTF-8 (met of zonder BOM), UTF-16, anders Windows-1252 (Excel "CSV (gescheiden door lijstscheidingsteken)"). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  // UTF-16 zonder BOM: elk tweede byte nul bij gewone tekst.
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes)
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return new TextDecoder('windows-1252').decode(body)
  }
}
