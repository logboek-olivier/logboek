import { getLang, locale, t, type Lang } from './i18n'

// Notatie volgt de taal: nl 1.240 nm, € 1.250,50, 3 mei 2024; en 1,240 nm, €1,250.50, 3 May 2024.
// Formatters per taal één keer gemaakt. Alle functies nemen optioneel een taal, voor exports in een andere taal.

interface Formatters {
  number: Intl.NumberFormat
  rate: Intl.NumberFormat
  money: Intl.NumberFormat
  whole: Intl.NumberFormat
  date: Intl.DateTimeFormat
  dateShort: Intl.DateTimeFormat
  weekday: Intl.DateTimeFormat
  monthShort: Intl.DateTimeFormat
  monthLong: Intl.DateTimeFormat
  monthName: Intl.DateTimeFormat
}

const cache = new Map<Lang, Formatters>()

function f(lang: Lang = getLang()): Formatters {
  let found = cache.get(lang)
  if (!found) {
    const loc = locale(lang)
    found = {
      number: new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }),
      rate: new Intl.NumberFormat(loc, { maximumFractionDigits: 4 }),
      money: new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      whole: new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }),
      date: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }),
      dateShort: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }),
      weekday: new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' }),
      monthShort: new Intl.DateTimeFormat(loc, { month: 'short' }),
      monthLong: new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }),
      monthName: new Intl.DateTimeFormat(loc, { month: 'long' }),
    }
    cache.set(lang, found)
  }
  return found
}

export function formatNumber(n: number, lang?: Lang): string {
  return f(lang).number.format(n)
}

/** Wisselkoers met tot vier decimalen (ECB-notatie): 1,0812. */
export function formatRate(n: number, lang?: Lang): string {
  return f(lang).rate.format(n)
}

export function formatNm(n: number, lang?: Lang): string {
  return `${f(lang).number.format(n)} nm`
}

export function formatHours(n: number): string {
  return t('unit.hours', { n: f().number.format(n) })
}

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }

/** Nederlands met spatie na het symbool (€ 12,50), Engels zonder (€12.50). */
export function formatMoney(amount: number, currency: string, lang: Lang = getLang()): string {
  const symbol = SYMBOLS[currency]
  const value = f(lang).money.format(amount)
  if (!symbol) return `${value} ${currency}`
  return lang === 'nl' ? `${symbol} ${value}` : `${symbol}${value}`
}

/** Bedrag zonder centen voor as-teksten: € 1.250. */
export function formatMoneyShort(amount: number, currency = 'EUR', lang: Lang = getLang()): string {
  const whole = f(lang).whole.format(amount)
  if (currency !== 'EUR') return `${whole} ${currency}`
  return lang === 'nl' ? `€ ${whole}` : `€${whole}`
}

/** jjjj-mm-dd → 3 mei 2024. */
export function formatDate(iso: string, lang?: Lang): string {
  return f(lang).date.format(parseIsoDate(iso))
}

/** jjjj-mm-dd → 3 mei (zonder punt). */
export function formatDateShort(iso: string, lang?: Lang): string {
  return f(lang).dateShort.format(parseIsoDate(iso)).replace('.', '')
}

/** jjjj-mm-dd → maandag 3 mei. */
export function formatWeekday(iso: string, lang?: Lang): string {
  return f(lang).weekday.format(parseIsoDate(iso))
}

export function formatDateRange(start: string, end: string, lang?: Lang): string {
  if (start === end) return formatDate(start, lang)
  if (start.slice(0, 7) === end.slice(0, 7)) return `${parseIsoDate(start).getDate()}–${formatDate(end, lang)}`
  return `${formatDateShort(start, lang)} – ${formatDate(end, lang)}`
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** jjjj-mm → "okt" (zonder punt). */
export function formatMonthShort(month: string, lang?: Lang): string {
  return f(lang).monthShort.format(parseIsoDate(`${month}-01`)).replace('.', '')
}

/** jjjj-mm → "oktober 2026". */
export function formatMonth(month: string, lang?: Lang): string {
  return f(lang).monthLong.format(parseIsoDate(`${month}-01`))
}

/** Maandnummer 1–12 → "juni". */
export function formatMonthName(month: number, lang?: Lang): string {
  return f(lang).monthName.format(new Date(2000, month - 1, 1))
}
