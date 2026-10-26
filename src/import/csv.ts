// CSV zonder bibliotheek (RFC 4180): aanhalingstekens, dubbele aanhalingstekens, regeleinden in velden,
// CRLF, LF en losse CR. Scheidingsteken ; , of tab, gekozen op de kopregel.

export type Delimiter = ';' | ',' | '\t'

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
    if (ch === '"' && field.trim() === '') {
      field = ''
      quoted = true
    } else if (ch === delimiter) {
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

/** Kiest het scheidingsteken op de kopregel (de regel die met Datum begint); anders het vaakst voorkomende. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r\n|\r|\n/)
  const header =
    lines.find((l) => /^[\s;,\t"]*datum\b/i.test(l)) ?? lines.slice(0, 10).join('\n')
  const count = (d: string) => header.split(d).length - 1
  const candidates: Delimiter[] = [';', ',', '\t']
  return candidates.reduce((best, d) => (count(d) > count(best) ? d : best), ';' as Delimiter)
}
