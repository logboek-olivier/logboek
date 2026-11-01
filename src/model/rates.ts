import type { Tx } from '../domain/tx'
import { justAfter, type Transaction } from './types'

// Wisselkoersen: ECB-referentiekoersen (vreemde valuta per 1 EUR), door deploy.yml gebouwd als public/rates.json op
// dezelfde origin. De app haalt nooit zelf koersen van buiten (beveiligingsregel 2). Een transactie gebruikt de koers
// van haar datum of de laatste werkdag daarvoor. Is de datum nieuwer dan het bestand, dan geldt tijdelijk de laatst
// bekende koers, gemarkeerd als voorlopig; die wordt niet opgeslagen.

export interface RatesFile {
  format: 'logboek-rates'
  source: string
  /** jjjj-mm-dd, oplopend */
  dates: string[]
  /** Per valuta een koers per datum (null als de ECB die dag geen koers gaf). */
  rates: Record<string, (number | null)[]>
}

export interface RateHit {
  /** Vreemde valuta per 1 EUR. */
  rate: number
  /** Datum van de gebruikte koers. */
  date: string
  /** De transactiedatum valt na de laatste koers in het bestand. */
  provisional: boolean
}

let current: RatesFile | null = null
const listeners = new Set<() => void>()

export function getRates(): RatesFile | null {
  return current
}

export function subscribeRates(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setRates(file: RatesFile | null): void {
  current = file
  for (const l of listeners) l()
}

export function isRatesFile(value: unknown): value is RatesFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.format !== 'logboek-rates' || !Array.isArray(v.dates) || typeof v.rates !== 'object' || v.rates === null) return false
  const n = v.dates.length
  return v.dates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) &&
    Object.values(v.rates as Record<string, unknown>).every((list) => Array.isArray(list) && list.length === n && list.every((r) => r === null || (typeof r === 'number' && r > 0)))
}

/** Haalt rates.json op van dezelfde origin (de service worker bewaart een kopie voor offline). */
export async function loadRates(url = `${import.meta.env.BASE_URL}rates.json`, fetchImpl: typeof fetch = fetch): Promise<RatesFile | null> {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!isRatesFile(body)) return null
    setRates(body)
    return body
  } catch {
    return null
  }
}

/** Koers op `date` of de laatste werkdag daarvoor; na het einde van het bestand de laatste koers, voorlopig. */
export function rateFor(file: RatesFile | null, currency: string, date: string): RateHit | null {
  if (!file) return null
  const list = file.rates[currency]
  if (!list || file.dates.length === 0) return null
  // Binair zoeken naar de laatste datum <= date.
  let lo = 0
  let hi = file.dates.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (file.dates[mid]! <= date) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  for (let i = found; i >= 0; i--) {
    const rate = list[i]
    if (rate) return { rate, date: file.dates[i]!, provisional: date > file.dates[file.dates.length - 1]! }
  }
  return null
}

export interface EurValue {
  eur: number
  /** received: werkelijk ontvangen eurobedrag; stored: opgeslagen koers; rate: koers uit het bestand. */
  basis: 'eur' | 'received' | 'stored' | 'rate'
  provisional: boolean
  rate?: number
  rateDate?: string
}

/** Eurowaarde van een transactie: ontvangen bedrag gaat voor, dan de opgeslagen koers, dan het koersbestand. */
export function eurValue(tx: Transaction, file: RatesFile | null = current): EurValue | null {
  if (tx.currency === 'EUR') return { eur: tx.amount, basis: 'eur', provisional: false }
  if (typeof tx.receivedEur === 'number') return { eur: tx.receivedEur, basis: 'received', provisional: false }
  if (typeof tx.amountEur === 'number') return { eur: tx.amountEur, basis: 'stored', provisional: false, rate: tx.rate, rateDate: tx.rateDate }
  const hit = rateFor(file, tx.currency, tx.date)
  if (!hit) return null
  return { eur: round2(tx.amount / hit.rate), basis: 'rate', provisional: hit.provisional, rate: hit.rate, rateDate: hit.date }
}

/** Velden om een definitieve koers in een transactie op te slaan (nooit een voorlopige). */
export function finalRateFields(tx: Pick<Transaction, 'currency' | 'amount' | 'date'>, file: RatesFile | null = current): Pick<Transaction, 'rate' | 'rateDate' | 'amountEur'> | null {
  if (tx.currency === 'EUR') return null
  const hit = rateFor(file, tx.currency, tx.date)
  if (!hit || hit.provisional) return null
  return { rate: hit.rate, rateDate: hit.date, amountEur: round2(tx.amount / hit.rate) }
}

/**
 * Slaat de gebruikte koers op bij transacties die er nog geen hebben, zodra die definitief bekend is. Eén keer per
 * sessie na een geslaagde sync, zodat een offline apparaat geen wijzigingen van een ander apparaat overschrijft.
 */
export async function backfillRates(store: Tx, file: RatesFile | null = current): Promise<number> {
  if (!file) return 0
  const changed: Transaction[] = []
  for (const tx of store.list('transactions.json.enc')) {
    if (tx.currency === 'EUR' || typeof tx.amountEur === 'number') continue
    const fields = finalRateFields(tx, file)
    // Net na de vorige versie: een echte wijziging op een ander apparaat (dat nog niet synchroniseerde) wint altijd; de
    // koers wordt daarna gewoon opnieuw vastgelegd.
    if (fields) changed.push({ ...tx, ...fields, updatedAt: justAfter(tx.updatedAt) })
  }
  if (changed.length > 0) {
    await store.putMany('transactions.json.enc', changed)
  }
  return changed.length
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
