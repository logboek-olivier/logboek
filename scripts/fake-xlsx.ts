import { strToU8, zipSync } from 'fflate'

// Bouwt een nep-mijlenregistratie als .xlsx met dezelfde opbouw als Oliviers Excel, met verzonnen plaatsen en getallen:
// werkblad "Sheet1" met samenvattingsformules in J1:O4, kopregel op rij 6, dagen daaronder met lege rijen tussen
// tochten, datums als serienummer, leeg of als formule (=A7+1), Totaal als formule, wind als tekst, en een
// data-validatie-extensie die naar de rollenlijst op werkblad "Blad1" verwijst.

export interface FakeXlsxOptions {
  /** Datumsysteem 1904 (oude Mac-bestanden). */
  date1904?: boolean
  /** Laat de opgeslagen waarde van de formuledatum op rij 9 weg, zoals bij een bestand dat nooit herberekend is. */
  dropCachedDate?: boolean
}

type Value = string | number | null
interface CellSpec {
  value?: Value
  formula?: string
  /** Index in cellXfs: 1 = eigen datumnotatie d-m-jjjj, 2 = ingebouwde datumnotatie 14. */
  style?: number
}

const HEADER = [
  'Datum',
  'Van (plaats)',
  'Van (land)',
  'Naar (plaats)',
  'Naar (land)',
  'Rol',
  'Schip',
  'Schipper/trainer',
  'Co-schipper (flot.leider)',
  'Wind (bft)',
  'Binnenwater',
  'Zee',
  'Zee (getijnavigatie)',
  'Totaal',
  'Nacht-uren',
  'Bijzonderheden',
]

const COLUMNS = 'ABCDEFGHIJKLMNOP'.split('')

function serial(iso: string, date1904: boolean): number {
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y!, m! - 1, d!)
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  return Math.round((ms - base) / 86_400_000)
}

interface Day {
  date: { iso: string; style?: number } | { formula: string; iso: string } | null
  from: [string, string]
  to: [string, string]
  role: string
  boat: string
  skipper?: string
  coSkipper?: string
  wind?: string | number
  nm: [number | null, number | null, number | null]
  night?: number
  notes?: string
}

const TRIPS: Day[][] = [
  [
    { date: { iso: '2024-05-03', style: 1 }, from: ['Fjordhaven', 'Noordland'], to: ['Kaap Nevel', 'Noordland'], role: 'Schipper', boat: 'Nepboot Een', wind: '3-4', nm: [12, null, null], notes: 'Oefentocht noord' },
    { date: null, from: ['Kaap Nevel', 'Noordland'], to: ['Zoutbaai', 'Noordland'], role: 'Schipper', boat: 'Nepboot Een', wind: 4, nm: [8, 20, null], notes: 'Lange dag' },
    { date: { formula: 'A7+1', iso: '2024-05-04' }, from: ['Zoutbaai', 'Noordland'], to: ['Fjordhaven', 'Noordland'], role: 'Schipper', boat: 'Nepboot Een', wind: 2, nm: [null, null, 30], night: 4 },
  ],
  [
    { date: { iso: '2024-06-10', style: 1 }, from: ['Westeiland', 'Verreland'], to: ['Oosteiland', 'Verreland'], role: 'Co-schipper', boat: 'Nepboot Twee', skipper: 'Kapitein Nep', wind: 5, nm: [null, 30, null] },
    { date: { formula: 'A11+1', iso: '2024-06-11' }, from: ['Oosteiland', 'Verreland'], to: ['Zuidrif', 'Verreland'], role: 'Co-schipper', boat: 'Nepboot Twee', skipper: 'Kapitein Nep', wind: 3, nm: [null, null, 40], night: 6 },
    { date: { formula: 'A12+1', iso: '2024-06-12' }, from: ['Zuidrif', 'Verreland'], to: ['Westeiland', 'Verreland'], role: 'Co-schipper', boat: 'Nepboot Twee', skipper: 'Kapitein Nep', nm: [null, null, 40], notes: 'Terug' },
  ],
  [
    { date: { iso: '2024-07-20', style: 2 }, from: ['Meerdorp', 'Noordland'], to: ['Rietmeer', 'Noordland'], role: 'Trainee', boat: 'Nepboot Drie', skipper: 'Trainer Nep', wind: 2, nm: [15, null, null], notes: 'Cursus binnenwater' },
    { date: { iso: '2024-07-21', style: 1 }, from: ['Rietmeer', 'Noordland'], to: ['Meerdorp', 'Noordland'], role: 'Bemanningslid', boat: 'Nepboot Drie', skipper: 'Trainer Nep', coSkipper: 'Nep Co', wind: 3, nm: [null, 45, null], night: 2 },
  ],
]

export function buildFakeMileageXlsx(options: FakeXlsxOptions = {}): Uint8Array {
  const date1904 = options.date1904 ?? false
  const strings: string[] = []
  const stringIndex = (s: string): number => {
    const i = strings.indexOf(s)
    if (i >= 0) return i
    strings.push(s)
    return strings.length - 1
  }

  const rows = new Map<number, CellSpec[]>()
  // Rijen 1–4: samenvatting per rol, zoals in het origineel (SUMIF over de kolommen K–O).
  const summary = ['Schipper', 'Co-schipper', 'bem./trainee:', 'totaal:']
  const cached = [
    [20, 20, 30, 70, 4],
    [0, 30, 80, 110, 6],
    [15, 45, 0, 60, 2],
    [35, 95, 110, 240, 12],
  ]
  summary.forEach((label, r) => {
    const cells: CellSpec[] = []
    cells[9] = { value: label }
    'KLMNO'.split('').forEach((col, k) => {
      cells[10 + k] = {
        formula: r < 3 ? `SUMIF($F$7:$F$200,$J${r + 1},${col}$7:${col}$200)` : `SUM(${col}1:${col}3)`,
        value: cached[r]![k]!,
      }
    })
    rows.set(r + 1, cells)
  })
  rows.set(6, HEADER.map((h) => ({ value: h })))

  let rowNumber = 7
  TRIPS.forEach((trip, t) => {
    for (const day of trip) {
      const cells: CellSpec[] = []
      if (day.date && 'formula' in day.date) {
        const dropped = options.dropCachedDate && rowNumber === 9
        cells[0] = { formula: day.date.formula, value: dropped ? null : serial(day.date.iso, date1904), style: 1 }
      } else if (day.date) {
        cells[0] = { value: serial(day.date.iso, date1904), style: day.date.style ?? 1 }
      }
      const texts = [day.from[0], day.from[1], day.to[0], day.to[1], day.role, day.boat, day.skipper ?? '', day.coSkipper ?? '']
      texts.forEach((v, i) => {
        if (v) cells[1 + i] = { value: v }
      })
      if (day.wind !== undefined) cells[9] = { value: day.wind }
      day.nm.forEach((v, i) => {
        if (v !== null) cells[10 + i] = { value: v }
      })
      const total = day.nm.reduce<number>((n, v) => n + (v ?? 0), 0)
      cells[13] = { formula: `SUM(K${rowNumber}:M${rowNumber})`, value: total }
      if (day.night !== undefined) cells[14] = { value: day.night }
      if (day.notes) cells[15] = { value: day.notes }
      rows.set(rowNumber, cells)
      rowNumber++
    }
    // Lege rij tussen tochten; de Totaal-formule is doorgetrokken en geeft 0. Tussen tocht 2 en 3 twee lege rijen.
    const blanks = t === 1 ? 2 : t === 0 ? 1 : 0
    for (let b = 0; b < blanks; b++) {
      rows.set(rowNumber, totalOnly(rowNumber))
      rowNumber++
    }
  })
  // Onder de laatste dag: doorgetrokken formules zonder dag.
  for (let r = rowNumber; r < rowNumber + 3; r++) {
    rows.set(r, totalOnly(r))
  }

  const sheetXml = (cellRows: Map<number, CellSpec[]>, extension: string) => {
    const body = [...cellRows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, cells]) => {
        const xmlCells = cells
          .map((c, i) => (c ? cellXml(`${COLUMNS[i]}${r}`, c, stringIndex) : ''))
          .join('')
        return `<row r="${r}">${xmlCells}</row>`
      })
      .join('')
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">' +
      `<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>` +
      `<sheetData>${body}</sheetData>${extension}` +
      '</worksheet>'
    )
  }

  const validation =
    '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">' +
    '<x14:dataValidations count="1" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">' +
    '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">' +
    '<x14:formula1><xm:f>Blad1!$A$1:$A$5</xm:f></x14:formula1><xm:sqref>F7:F1000</xm:sqref>' +
    '</x14:dataValidation></x14:dataValidations></ext></extLst>'
  const sheet1 = sheetXml(rows, validation)
  const roles = new Map<number, CellSpec[]>()
  ;['Schipper', 'Co-schipper', 'Bemanningslid', 'Trainee', 'Instructeur'].forEach((r, i) => roles.set(i + 1, [{ value: r }]))
  const sheet2 = sheetXml(roles, '')

  const sharedXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') +
    '</sst>'

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<workbookPr${date1904 ? ' date1904="1"' : ''} defaultThemeVersion="166925"/>` +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Blad1" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="d\\-m\\-yyyy;@"/></numFmts>' +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
    'xl/worksheets/sheet2.xml': strToU8(sheet2),
    'xl/sharedStrings.xml': strToU8(sharedXml),
  }
  // Vaste tijd, zodat het bestand bij elke generatie byte-voor-byte gelijk is.
  return zipSync(files, { mtime: new Date(Date.UTC(2026, 0, 1)) })
}

function totalOnly(row: number): CellSpec[] {
  const cells: CellSpec[] = []
  cells[13] = { formula: `SUM(K${row}:M${row})`, value: 0 }
  return cells
}

function cellXml(ref: string, cell: CellSpec, stringIndex: (s: string) => number): string {
  const style = cell.style ? ` s="${cell.style}"` : ''
  const formula = cell.formula ? `<f>${escapeXml(cell.formula)}</f>` : ''
  if (typeof cell.value === 'string') {
    return `<c r="${ref}"${style} t="s">${formula}<v>${stringIndex(cell.value)}</v></c>`
  }
  const value = typeof cell.value === 'number' ? `<v>${cell.value}</v>` : ''
  return `<c r="${ref}"${style}>${formula}${value}</c>`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
