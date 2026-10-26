// Nederlandse notatie: 1.240 nm, € 1.250,50, 3 mei 2024.

const nlNumber = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })
const nlMoney = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nlDate = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
const nlDateShort = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' })

export function formatNumber(n: number): string {
  return nlNumber.format(n)
}

export function formatNm(n: number): string {
  return `${nlNumber.format(n)} nm`
}

export function formatHours(n: number): string {
  return `${nlNumber.format(n)} u`
}

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }

export function formatMoney(amount: number, currency: string): string {
  const symbol = SYMBOLS[currency]
  return symbol ? `${symbol} ${nlMoney.format(amount)}` : `${nlMoney.format(amount)} ${currency}`
}

/** jjjj-mm-dd → 3 mei 2024. */
export function formatDate(iso: string): string {
  return nlDate.format(parseIsoDate(iso))
}

/** jjjj-mm-dd → 3 mei. */
export function formatDateShort(iso: string): string {
  return nlDateShort.format(parseIsoDate(iso))
}

export function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start)
  if (start.slice(0, 7) === end.slice(0, 7)) return `${parseIsoDate(start).getDate()}–${formatDate(end)}`
  return `${formatDateShort(start)} – ${formatDate(end)}`
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

const nlMonthShort = new Intl.DateTimeFormat('nl-NL', { month: 'short' })
const nlMonthLong = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' })

/** jjjj-mm → "okt" (zonder punt). */
export function formatMonthShort(month: string): string {
  return nlMonthShort.format(parseIsoDate(`${month}-01`)).replace('.', '')
}

/** jjjj-mm → "oktober 2026". */
export function formatMonth(month: string): string {
  return nlMonthLong.format(parseIsoDate(`${month}-01`))
}

/** Bedrag zonder centen voor as-teksten: € 1.250. */
export function formatMoneyShort(amount: number, currency = 'EUR'): string {
  const whole = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(amount)
  return currency === 'EUR' ? `€ ${whole}` : `${whole} ${currency}`
}
