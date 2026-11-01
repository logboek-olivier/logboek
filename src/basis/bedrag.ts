import { getLang, type Lang } from '../i18n'

// Bedragen: één parser voor alles wat Olivier intypt (bedragen, standen, waarden bij doelen) en één vorm voor een
// voorgevuld veld, zodat Opslaan zonder typen nooit een ander bedrag bewaart (docs/FUNDERING.md).

/**
 * Een ingetypte stand: ook nul en negatief (rood staan, ook "€ -80" en "(80)"). "1.234,56" en "1,234.56": het laatste
 * teken is het decimaalteken; één punt met drie cijfers erachter is een duizendtal ("1.234"), één komma een
 * decimaalteken (in het Engels met drie cijfers erachter een duizendtal). Iets anders dan een bedrag ("2-3", "1e5",
 * "1O0") is null, nooit een geraden getal.
 */
export function parseStand(text: string, lang: 'nl' | 'en' = 'nl'): number | null {
  let t = text.replace(/[\s\u00a0]/g, '').replace(/\u2212/g, '-').replace(/^(€|EUR|\$|USD|£|GBP)/i, '').replace(/(€|EUR|\$|USD|£|GBP)$/i, '')
  let negative = false
  if (/^\(.*\)$/.test(t)) {
    negative = true
    t = t.slice(1, -1)
  }
  const sign = /^([-+]?)(?:€|EUR|\$|USD|£|GBP)?(\d[\d.,]*)(-?)$/i.exec(t)
  if (!sign) return null
  if (sign[1] === '-' || sign[3] === '-') negative = !negative
  let s = sign[2]!
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  const count = (c: string) => s.split(c).length - 1
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (comma >= 0) s = count(',') > 1 || (lang === 'en' && /,\d{3}$/.test(s)) ? s.replace(/,/g, '') : s.replace(',', '.')
  else if (dot >= 0 && (count('.') > 1 || /\.\d{3}$/.test(s))) s = s.replace(/\./g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = round2(Number(s))
  return negative && n !== 0 ? -n : n
}

/**
 * Een ingetypt bedrag: "12,50", "12.50", "€ 12", "1.250,75" en in het Engels "1,250.75" of "1,250" → het getal; zoals
 * parseStand, met het decimaalteken van de taal. Ongeldig, nul of negatief → null.
 */
export function parseAmount(text: string, lang: Lang = getLang()): number | null {
  const n = parseStand(text, lang)
  return n !== null && n > 0 ? n : null
}

/**
 * Een bedrag als invoer (voorgevuld veld): zonder duizendtallen, hoogstens twee decimalen, met het decimaalteken van
 * de taal. parseAmount leest het precies zo terug, zodat Opslaan zonder typen nooit een ander bedrag bewaart.
 */
export function amountInput(n: number, lang: Lang = getLang()): string {
  const s = round2(n).toFixed(2).replace(/\.00$/, '')
  return lang === 'nl' ? s.replace('.', ',') : s
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
