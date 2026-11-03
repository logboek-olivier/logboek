import { parseMileageFile, type ImportResult } from '../../src/import/mileage-csv'

/** CSV als tekst door hetzelfde pad als een gekozen bestand in de app (`parseMileageFile`). */
export function parseMileageCsv(text: string, now: string = new Date().toISOString()): ImportResult {
  return parseMileageFile(new TextEncoder().encode(text), now)
}
