import { round2 } from '../basis/bedrag'
import { sourceForPeriod } from '../basis/organisatie'
import { active } from '../model/derive'
import { finalRateFields } from '../model/rates'
import { tripEnd } from '../model/salary'
import type { Currency, SalaryStatus, Transaction, Trip } from '../model/types'
import { salariesOf, salaryIncomeId, salaryStatus } from './geldmodel'
import { isDate } from '../basis/datum'
import { opdrachtMet } from './opdracht'
import type { Reader, Tx } from './tx'

// Geld omzetten (eenmalig, na één tik op het scherm "Geld omzetten"): van het oude geldmodel naar één waarheid
// (src/domain/geldmodel.ts). Het salaris stond op twee plekken: op de tocht (`salary`) en als loon-transactie. Daarna
// alleen nog als transactie. Contant en gestort (`tipVia`, `depositedAt`) vervallen. Er gaat geen bedrag verloren: elke
// transactie blijft met hetzelfde bedrag op haar eigen datum staan, en een salaris dat alleen op de tocht stond, wordt een
// transactie. Meerdere salarissen bij één tocht voegt de app niet zelf samen: ze blijven allemaal staan en komen in Te
// controleren. De opdracht schrijft een regel in de geschiedenis: in de prullenbak staat "Geld omzetten", volledig terug
// te zetten.

/** Het salaris zoals het vóór de omzetting op een tocht stond (een veld dat deze versie verder niet kent). */
interface OldTripSalary {
  transactionId?: unknown
  amount?: unknown
  currency?: unknown
  status?: unknown
  askAfter?: unknown
}

type OldTrip = Trip & { salary?: OldTripSalary }
type OldTransaction = Transaction & { tipVia?: unknown; depositedAt?: unknown }

export interface MoneyConversion {
  /** Tochten waarvan het salaris op de tocht en de loon-transactie één werden (de transactie houdt het bedrag). */
  merged: number
  /** Salarissen die alleen op de tocht stonden en nu een transactie zijn. */
  created: number
  /** Transacties waar contant, bank of gestort af ging. */
  cashMarks: number
  /** Salarissen op ontvangen zonder bedrag (in Te controleren). */
  missing: number
  /** Tochten met meer dan één salaris (alles blijft staan, in Te controleren). */
  multiple: number
}

const STATUSES: readonly SalaryStatus[] = ['verwacht', 'ontvangen', 'geen']

function oldStatus(s: OldTripSalary): SalaryStatus {
  return STATUSES.includes(s.status as SalaryStatus) ? (s.status as SalaryStatus) : 'verwacht'
}

function oldAmount(s: OldTripSalary): number {
  return typeof s.amount === 'number' && Number.isFinite(s.amount) && s.amount > 0 ? round2(s.amount) : 0
}

function oldCurrency(s: OldTripSalary): Currency {
  return typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? (s.currency as Currency) : 'EUR'
}

/** Moet er iets omgezet worden? Een levende tocht met een salaris erop, of een transactie met contant of gestort. */
export function needsMoneyConversion(reader: Reader): boolean {
  return (
    reader.list('trips.json.enc').some((x) => (x as OldTrip).salary !== undefined) ||
    reader.list('transactions.json.enc').some((tx) => (tx as OldTransaction).tipVia !== undefined || (tx as OldTransaction).depositedAt !== undefined)
  )
}

interface Plan {
  counts: MoneyConversion
  trips: Trip[]
  transactions: Transaction[]
}

/**
 * Wat de omzetting doet (zonder te schrijven): de tochten zonder salaris-veld, de transacties met een status of zonder
 * contant, en de nieuwe salarissen. `now` wordt de wijzigingstijd.
 */
export function planMoneyConversion(reader: Reader, now: string): Plan {
  const counts: MoneyConversion = { merged: 0, created: 0, cashMarks: 0, missing: 0, multiple: 0 }
  const legs = reader.list('legs.json.enc')
  const all = reader.get('transactions.json.enc')
  const changed = new Map<string, Transaction>()
  const put = (tx: Transaction) => changed.set(tx.id, tx)
  const current = (id: string) => changed.get(id) ?? all.find((x) => x.id === id)!
  // Contant en gestort vervallen; de fooi blijft met hetzelfde bedrag op haar eigen datum staan. Alleen levend geld: een
  // verwijderde fooi blijft zoals hij was (de prullenbak van vóór de geschiedenis herkent hem aan zijn tombstone).
  for (const tx of all as OldTransaction[]) {
    if (tx.deletedAt !== null || (tx.tipVia === undefined && tx.depositedAt === undefined)) continue
    const { tipVia: _v, depositedAt: _d, ...rest } = tx
    void [_v, _d]
    put({ ...rest, updatedAt: now })
    counts.cashMarks++
  }
  const trips: Trip[] = []
  for (const trip of reader.list('trips.json.enc') as OldTrip[]) {
    const old = trip.salary
    if (old === undefined) continue
    const { salary: _s, ...rest } = trip
    void _s
    trips.push({ ...rest, updatedAt: now })
    if (!old || typeof old !== 'object') continue
    const status = oldStatus(old)
    const salaries = salariesOf(trip.id, active([...changed.values(), ...all.filter((x) => !changed.has(x.id))]))
    if (salaries.length > 1) {
      // Niet zelf samenvoegen: alles blijft staan (elk loon was al echt geld), Olivier kiest in Te controleren.
      counts.multiple++
      continue
    }
    const existing = salaries[0]
    if (existing) {
      // De transactie houdt het bedrag. Heeft ze al een status (het nieuwe model, bijvoorbeeld een standaardsalaris dat na
      // de update ontstond), dan blijft die. Anders komt de status van de tocht, maar een transactie met een bedrag telde
      // al overal als ontvangen geld: die blijft ontvangen (anders zou een bedrag uit verdiend verdwijnen).
      const next: SalaryStatus = existing.status !== undefined ? salaryStatus(existing) : existing.amount > 0 ? 'ontvangen' : status
      const tx = current(existing.id)
      put({ ...tx, status: next, ...(next === 'verwacht' && typeof old.askAfter === 'string' ? { askAfter: old.askAfter } : {}), updatedAt: now })
      counts.merged++
      if (next === 'ontvangen' && !(existing.amount > 0)) counts.missing++
      continue
    }
    // Het inkomen van dit salaris staat bij een andere tocht (zelf verhuisd): dat geld bestaat al, dus geen tweede.
    const linked = typeof old.transactionId === 'string' ? all.find((x) => x.id === old.transactionId && x.deletedAt === null) : undefined
    if (linked) {
      counts.merged++
      continue
    }
    // Alleen een status op de tocht: een loon-transactie met die status (bij "geen salaris" bedrag 0).
    const amount = status === 'geen' ? 0 : oldAmount(old)
    const currency = oldCurrency(old)
    // Een geldige datum (een kapotte tripdatum mag de hele omzetting niet tegenhouden).
    const date = [tripEnd(trip, legs), trip.startDate ?? ''].find((d) => isDate(d)) ?? now.slice(0, 10)
    const base = { date, amount, currency }
    const id = salaryIncomeId(trip.id, [...changed.values(), ...all])
    put({
      id,
      ...base,
      kind: 'loon',
      source: sourceForPeriod(trip),
      tripId: trip.id,
      status,
      ...(status === 'verwacht' && typeof old.askAfter === 'string' ? { askAfter: old.askAfter } : {}),
      ...(status === 'ontvangen' && amount > 0 ? (currency === 'EUR' ? { amountEur: amount } : (finalRateFields(base) ?? {})) : {}),
      updatedAt: now,
      deletedAt: null,
    })
    counts.created++
    if (status === 'ontvangen' && !(amount > 0)) counts.missing++
  }
  return { counts, trips, transactions: [...changed.values()] }
}

/** De omzetting uitvoeren (na één tik). Geeft de aantallen terug; niets te doen: niets geschreven. */
export async function convertMoney(tx: Tx): Promise<MoneyConversion> {
  const plan = planMoneyConversion(tx, tx.now)
  if (plan.transactions.length > 0) await tx.putMany('transactions.json.enc', plan.transactions)
  if (plan.trips.length > 0) await tx.putMany('trips.json.enc', plan.trips)
  return plan.counts
}

export const geldOmzetten = opdrachtMet('geldOmzetten', convertMoney)
