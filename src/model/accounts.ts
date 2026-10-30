import type { Store } from '../storage/store'
import type { Undo } from './edit'
import { parseStand, round2 } from './money'

export { parseStand }
import { rateFor, type RatesFile } from './rates'
import { newId, todayIso, type Account, type AccountKind, type AccountProvider, type Balance, type Currency } from './types'

// Rekeningen en netto waarde (Meer → Rekeningen). Per rekening één stand per maand (balances.json.enc): handmatig
// ingevuld of uit een export (src/import/accounts.ts). Alleen standen, nooit losse mutaties, omschrijvingen of
// tegenrekeningen. Een schuld (studieschuld) staat als negatief bedrag. De netto waarde telt per rekening de laatste
// stand, omgerekend naar euro met de ECB-koers uit rates.json; het tempo is de gemiddelde verandering per maand.

/** De soort die bij een aanbieder past (te wijzigen). */
export const DEFAULT_KIND: Record<AccountProvider, AccountKind> = {
  asn: 'betaal',
  revolut: 'betaal',
  bux: 'beleggen',
  degiro: 'beleggen',
  duo: 'schuld',
  overig: 'betaal',
}

export const isDebt = (account: Pick<Account, 'kind'>): boolean => account.kind === 'schuld'

/** Eén stand per rekening per maand: twee apparaten en een nieuwe import voegen dezelfde maand samen. */
export function balanceId(accountId: string, date: string): string {
  return `stand:${accountId}:${date.slice(0, 7)}`
}

/** Een ingetypt bedrag als stand: bij een schuld altijd negatief, wat Olivier ook typt. */
export function signedAmount(account: Pick<Account, 'kind'>, amount: number): number {
  return round2(isDebt(account) ? -Math.abs(amount) : amount)
}

export function liveAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => a.deletedAt === null).sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || a.name.localeCompare(b.name))
}

export function accountBalances(balances: readonly Balance[], accountId: string): Balance[] {
  return balances.filter((b) => b.deletedAt === null && b.accountId === accountId).sort((a, b) => b.date.localeCompare(a.date))
}

/** De laatste stand van een rekening op of vóór `date`. */
export function balanceOn(balances: readonly Balance[], accountId: string, date: string): Balance | null {
  let best: Balance | null = null
  for (const b of balances) {
    if (b.deletedAt !== null || b.accountId !== accountId || b.date > date) continue
    if (!best || b.date > best.date) best = b
  }
  return best
}

export interface EurAmount {
  eur: number
  provisional: boolean
}

/** Een stand in euro: de koers van die dag (of de laatste werkdag ervoor); zonder koers null, nooit verzonnen. */
export function toEur(amount: number, currency: Currency, date: string, rates: RatesFile | null): EurAmount | null {
  if (currency === 'EUR') return { eur: amount, provisional: false }
  const hit = rateFor(rates, currency, date)
  return hit ? { eur: round2(amount / hit.rate), provisional: hit.provisional } : null
}

export interface NetWorth {
  eur: number
  provisional: boolean
  /** Standen zonder koers: apart per valuta, niet omgerekend. */
  other: Partial<Record<Currency, number>>
  /** Rekeningen met een stand. */
  counted: number
  /** De oudste meegetelde stand (jjjj-mm-dd). */
  oldest: string | null
}

/** Netto waarde op `date`: per rekening die dan open was de laatste stand, schulden negatief. */
export function netWorth(accounts: readonly Account[], balances: readonly Balance[], date: string, rates: RatesFile | null): NetWorth {
  const out: NetWorth = { eur: 0, provisional: false, other: {}, counted: 0, oldest: null }
  for (const account of accounts) {
    if (account.deletedAt !== null || (account.closedAt && account.closedAt <= date)) continue
    const b = balanceOn(balances, account.id, date)
    if (!b) continue
    out.counted++
    if (!out.oldest || b.date < out.oldest) out.oldest = b.date
    // De koers van de dag zelf: een stand van vorig jaar telt met de koers van nu mee in de netto waarde van nu.
    const eur = toEur(b.amount, account.currency, date, rates)
    if (eur) {
      out.eur = round2(out.eur + eur.eur)
      out.provisional ||= eur.provisional
    } else out.other[account.currency] = round2((out.other[account.currency] ?? 0) + b.amount)
  }
  return out
}

/** De laatste dag van een maand (jjjj-mm). */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface MonthWorth {
  month: string
  /** Null zolang er in die maand nog geen enkele stand was. */
  worth: NetWorth | null
}

/** Netto waarde aan het einde van elke maand (de lopende maand: vandaag), de laatste `count` maanden. */
export function netWorthSeries(accounts: readonly Account[], balances: readonly Balance[], today: string, rates: RatesFile | null, count = 12): MonthWorth[] {
  const current = today.slice(0, 7)
  const out: MonthWorth[] = []
  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(current, -i)
    const date = i === 0 ? today : monthEnd(month)
    const worth = netWorth(accounts, balances, date, rates)
    out.push({ month, worth: worth.counted > 0 ? worth : null })
  }
  return out
}

export type Pace =
  | { state: 'positief'; perMonth: number | null }
  | { state: 'op-weg'; perMonth: number; months: number }
  | { state: 'niet'; perMonth: number }
  | { state: 'te-weinig' }
  /** Een stand in een valuta zonder koers: geen netto waarde in euro, dus ook geen tempo. */
  | { state: 'geen-koers' }

/** Hoogstens zes maanden terug kijken: het huidige tempo, niet dat van jaren geleden. */
const PACE_MONTHS = 6

/** Een datum als maandgetal met de dag als fractie (15 maart en 15 april liggen precies één maand uit elkaar). */
function monthPosition(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return y * 12 + (m - 1) + (d - 1) / 30.4375
}

/**
 * Het tempo: per rekening de trend van zijn eigen standen in de laatste zes maanden (lineair, in euro met de koers van
 * vandaag, zodat een koersverschil geen sparen lijkt), opgeteld over de rekeningen. Een rekening met één stand in die
 * tijd (bijvoorbeeld een net toegevoegde studieschuld) telt niet mee in het tempo, wel in de netto waarde. Daarna:
 * hoeveel maanden het bij dat tempo nog duurt tot de netto waarde positief is.
 */
export function pace(accounts: readonly Account[], balances: readonly Balance[], today: string, rates: RatesFile | null): Pace {
  const now = netWorth(accounts, balances, today, rates)
  const first = addMonths(today.slice(0, 7), -(PACE_MONTHS - 1))
  let perMonth = 0
  let contributing = 0
  for (const account of accounts) {
    if (account.deletedAt !== null) continue
    // Een rekening die in deze zes maanden is opgeheven, telt mee tot nul op de dag van opheffen: geld dat naar een
    // andere rekening ging, is dan geen sparen. Eerder opgeheven: telt niet meer mee.
    const closed = account.closedAt && account.closedAt <= today ? account.closedAt : null
    if (closed && closed.slice(0, 7) < first) continue
    const points: { x: number; y: number }[] = []
    for (const b of balances) {
      if (b.deletedAt !== null || b.accountId !== account.id || b.date.slice(0, 7) < first || b.date > today) continue
      if (closed && b.date >= closed) continue
      const eur = toEur(b.amount, account.currency, today, rates)
      if (eur) points.push({ x: monthPosition(b.date), y: eur.eur })
    }
    if (closed && points.length > 0) points.push({ x: monthPosition(closed), y: 0 })
    if (new Set(points.map((p) => Math.floor(p.x))).size < 2) continue
    perMonth += slope(points)
    contributing++
  }
  perMonth = Math.round(perMonth)
  if (now.counted > 0 && Object.keys(now.other).length > 0) return { state: 'geen-koers' }
  if (now.counted > 0 && now.eur >= 0) return { state: 'positief', perMonth: contributing > 0 ? perMonth : null }
  if (contributing === 0) return { state: 'te-weinig' }
  if (perMonth <= 0) return { state: 'niet', perMonth }
  return { state: 'op-weg', perMonth, months: Math.ceil(-now.eur / perMonth) }
}

function slope(points: { x: number; y: number }[]): number {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  return den === 0 ? 0 : num / den
}

export interface AccountInput {
  name: string
  provider: AccountProvider
  kind: AccountKind
  currency: Currency
  note: string
  closedAt: string
}

export function cleanAccount(input: AccountInput): Omit<Account, 'id' | 'updatedAt' | 'deletedAt'> {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 60)
  const note = input.note.trim().slice(0, 500)
  const closedAt = /^\d{4}-\d{2}-\d{2}$/.test(input.closedAt) ? input.closedAt : undefined
  return { name, provider: input.provider, kind: input.kind, currency: input.currency, ...(note ? { note } : {}), ...(closedAt ? { closedAt } : {}) }
}

export async function saveAccount(store: Store, id: string | null, fields: Omit<Account, 'id' | 'updatedAt' | 'deletedAt'>): Promise<Account> {
  const previous = id ? store.get('accounts.json.enc').find((a) => a.id === id) : undefined
  const record: Account = { ...fields, id: id ?? newId(), updatedAt: new Date().toISOString(), deletedAt: null }
  await store.put('accounts.json.enc', record)
  // Van gewone rekening naar schuld: de standen worden negatief. Terug van schuld naar een andere soort: het teken draait
  // om (een schuldstand is altijd negatief, dus zo komt terug wat Olivier typte).
  if (previous && isDebt(previous) !== isDebt(record)) {
    const flip = (amount: number) => (isDebt(record) ? signedAmount(record, amount) : round2(Math.abs(amount)))
    const flipped = accountBalances(store.get('balances.json.enc'), record.id).map((b) => ({ ...b, amount: flip(b.amount), updatedAt: new Date().toISOString() }))
    if (flipped.length > 0) await store.putMany('balances.json.enc', flipped)
  }
  return record
}

/**
 * Een stand met de hand: geldt voor zijn maand; een stand van een latere dag in die maand blijft staan. Een datum in de
 * toekomst wordt geweigerd (null), zodat een tikfout nooit een juiste stand blokkeert.
 */
export async function setBalance(store: Store, account: Account, date: string, amount: number, today = todayIso()): Promise<Balance | null> {
  if (date > today) return null
  const signed = signedAmount(account, amount)
  const [written] = await writeBalances(store, account, [{ date, amount: signed }], 'handmatig', true, today)
  if (written) return written
  // Precies deze stand stond er al (niet opnieuw geschreven): dat is gewoon opgeslagen, geen "nieuwere stand".
  const same = store.list('balances.json.enc').find((b) => b.id === balanceId(account.id, date) && b.date === date && b.amount === signed)
  return same ?? null
}

export interface BalancePoint {
  date: string
  /** In de valuta van de rekening; bij een schuld al negatief. */
  amount: number
}

/**
 * Standen opslaan, één per maand. Bestaat er voor die maand al een stand van een latere dag, dan blijft die staan
 * (een oude export overschrijft nooit een nieuwere stand). Een import vervangt een stand uit een export van dezelfde
 * dag (zo herstelt opnieuw importeren met de juiste kolommen een verkeerde import), maar niet een stand die Olivier zelf
 * op die dag invulde; `force` (met de hand, dezelfde of een latere dag) wint wel. Datums in de toekomst gaan niet mee.
 */
export async function writeBalances(store: Store, account: Account, points: readonly BalancePoint[], source: Balance['source'], force = false, today = todayIso()): Promise<Balance[]> {
  const perMonth = new Map<string, BalancePoint>()
  for (const p of points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(p.amount) || p.date > today) continue
    const month = p.date.slice(0, 7)
    const known = perMonth.get(month)
    if (!known || p.date >= known.date) perMonth.set(month, p)
  }
  const existing = new Map(store.get('balances.json.enc').map((b) => [b.id, b]))
  const now = new Date().toISOString()
  const out: Balance[] = []
  for (const p of perMonth.values()) {
    const id = balanceId(account.id, p.date)
    const old = existing.get(id)
    const amount = round2(p.amount)
    if (old && old.deletedAt === null) {
      if (old.date > p.date) continue
      if (!force && old.date === p.date && old.source === 'handmatig') continue
      // Precies dezelfde stand: niets schrijven (geen onnodige sync).
      if (old.date === p.date && old.amount === amount && old.source === source) continue
    }
    out.push({ id, accountId: account.id, date: p.date, amount, source, updatedAt: now, deletedAt: null })
  }
  if (out.length > 0) await store.putMany('balances.json.enc', out)
  return out
}

/** Tombstone zonder bedrag (zoals bij studenten): alleen id, rekening en tijden blijven in het bestand. */
export function scrubbedBalance(balance: Balance, now: string): Balance {
  return { id: balance.id, accountId: balance.accountId, date: balance.date, amount: 0, source: balance.source, updatedAt: now, deletedAt: now }
}

/** Tombstone zonder naam of notitie. */
export function scrubbedAccount(account: Account, now: string): Account {
  return { id: account.id, name: '', provider: account.provider, kind: account.kind, currency: account.currency, updatedAt: now, deletedAt: now }
}

/** Een stand verwijderen, met ongedaan maken (uit het geheugen). */
export async function deleteBalance(store: Store, balance: Balance): Promise<Undo> {
  const original = { ...balance }
  await store.put('balances.json.enc', scrubbedBalance(balance, new Date().toISOString()))
  void store.sync()
  return async () => {
    await store.put('balances.json.enc', { ...original, updatedAt: new Date().toISOString(), deletedAt: null })
    void store.sync()
  }
}

/** Een rekening met al zijn standen verwijderen, met ongedaan maken (uit het geheugen). */
export async function deleteAccount(store: Store, account: Account): Promise<Undo> {
  const now = new Date().toISOString()
  const original = { ...account }
  const standen = accountBalances(store.get('balances.json.enc'), account.id).map((b) => ({ ...b }))
  if (standen.length > 0) await store.putMany('balances.json.enc', standen.map((b) => scrubbedBalance(b, now)))
  await store.put('accounts.json.enc', scrubbedAccount(account, now))
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.put('accounts.json.enc', { ...original, updatedAt: later, deletedAt: null })
    if (standen.length > 0) await store.putMany('balances.json.enc', standen.map((b) => ({ ...b, updatedAt: later, deletedAt: null })))
    void store.sync()
  }
}
