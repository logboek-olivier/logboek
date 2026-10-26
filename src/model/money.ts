import { active, lastMonths, round1 } from './derive'
import { eurValue } from './rates'
import type { Currency, Transaction, TransactionKind, TransactionSource } from './types'

// Afgeleiden voor zeilgeld, alles in euro: EUR zelf, het ontvangen eurobedrag, de opgeslagen koers of de ECB-koers
// van de transactiedatum (src/model/rates.ts). Alleen als er helemaal geen koers is, staat een bedrag apart per valuta.

export const INCOME_KINDS: readonly TransactionKind[] = ['fooi', 'loon']

export function isIncome(kind: TransactionKind): boolean {
  return INCOME_KINDS.includes(kind)
}

/** Bedrag in EUR als dat bekend is (ook voorlopig omgerekend), anders null. */
export function eurOf(t: Transaction): number | null {
  return eurValue(t)?.eur ?? null
}

export interface MoneyTotals {
  incomeEur: number
  costsEur: number
  balanceEur: number
  /** Bedragen zonder EUR-waarde, per valuta: inkomsten en kosten apart. */
  other: Record<string, { income: number; costs: number }>
}

export function emptyTotals(): MoneyTotals {
  return { incomeEur: 0, costsEur: 0, balanceEur: 0, other: {} }
}

export function totals(transactions: readonly Transaction[]): MoneyTotals {
  const t = emptyTotals()
  for (const tx of active(transactions)) {
    const eur = eurOf(tx)
    if (eur !== null) {
      if (isIncome(tx.kind)) t.incomeEur += eur
      else t.costsEur += eur
    } else {
      const bucket = (t.other[tx.currency] ??= { income: 0, costs: 0 })
      if (isIncome(tx.kind)) bucket.income += tx.amount
      else bucket.costs += tx.amount
    }
  }
  t.incomeEur = round2(t.incomeEur)
  t.costsEur = round2(t.costsEur)
  t.balanceEur = round2(t.incomeEur - t.costsEur)
  for (const b of Object.values(t.other)) {
    b.income = round2(b.income)
    b.costs = round2(b.costs)
  }
  return t
}

export interface MonthTotals extends MoneyTotals {
  /** jjjj-mm */
  month: string
}

/** Per maand, nieuwste eerst. */
export function perMonth(transactions: readonly Transaction[]): MonthTotals[] {
  const groups = new Map<string, Transaction[]>()
  for (const tx of active(transactions)) {
    const key = tx.date.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), tx])
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, txs]) => ({ month, ...totals(txs) }))
}

/** Inkomsten en kosten in EUR per kalendermaand voor de laatste `count` maanden, oudste eerst (voor de grafiek). */
export function monthSeries(transactions: readonly Transaction[], today: string, count = 12): MonthTotals[] {
  const byMonth = new Map(perMonth(transactions).map((m) => [m.month, m]))
  return lastMonths(today, count).map((month) => byMonth.get(month) ?? { month, ...emptyTotals() })
}

export interface SourceTotals extends MoneyTotals {
  source: TransactionSource
}

/** Per bron, grootste inkomsten eerst; bronnen zonder transacties vallen weg. */
export function perSource(transactions: readonly Transaction[]): SourceTotals[] {
  const groups = new Map<TransactionSource, Transaction[]>()
  for (const tx of active(transactions)) groups.set(tx.source, [...(groups.get(tx.source) ?? []), tx])
  return [...groups.entries()]
    .map(([source, txs]) => ({ source, ...totals(txs) }))
    .sort((a, b) => b.incomeEur - a.incomeEur)
}

export interface WeekTips {
  /** Maandag van de week, jjjj-mm-dd. */
  weekStart: string
  eur: number
  other: Record<string, number>
}

/** Fooi per week voor de laatste `weeks` weken (inclusief deze week), oudste eerst. */
export function tipsPerWeek(transactions: readonly Transaction[], today: string, weeks = 12): WeekTips[] {
  const start = mondayOf(today)
  const result: WeekTips[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    result.push({ weekStart: addDays(start, -7 * i), eur: 0, other: {} })
  }
  const first = result[0]!.weekStart
  for (const tx of active(transactions)) {
    if (tx.kind !== 'fooi' || tx.date < first || tx.date > addDays(start, 6)) continue
    const week = result.find((w) => tx.date >= w.weekStart && tx.date < addDays(w.weekStart, 7))
    if (!week) continue
    const eur = eurOf(tx)
    if (eur !== null) week.eur = round2(week.eur + eur)
    else week.other[tx.currency] = round2((week.other[tx.currency] ?? 0) + tx.amount)
  }
  return result
}

/** Fooi in de laatste `days` dagen tot en met vandaag: EUR plus andere valuta apart. */
export function recentTips(transactions: readonly Transaction[], today: string, days = 30): { eur: number; other: Record<string, number> } {
  const from = addDays(today, -(days - 1))
  let eur = 0
  const other: Record<string, number> = {}
  for (const tx of active(transactions)) {
    if (tx.kind !== 'fooi' || tx.date < from || tx.date > today) continue
    const e = eurOf(tx)
    if (e !== null) eur += e
    else other[tx.currency] = round2((other[tx.currency] ?? 0) + tx.amount)
  }
  return { eur: round2(eur), other }
}

/** Valuta's die in de transacties voorkomen zonder EUR-waarde. */
export function otherCurrencies(transactions: readonly Transaction[]): Currency[] {
  const set = new Set<Currency>()
  for (const tx of active(transactions)) if (eurOf(tx) === null) set.add(tx.currency)
  return [...set].sort()
}

/** "12,50", "12.50", "€ 12" → 12.5. Ongeldig of niet positief → null. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return round2(n)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = (date.getUTCDay() + 6) % 7
  return addDays(iso, -weekday)
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return date.toISOString().slice(0, 10)
}

export { round1 }
