import { active } from './derive'
import { isWaterKind, periodAt, setStayDays, type Period } from './periods'
import type { Tx } from '../domain/tx'
import { DAYS_TRIP_GRACE } from './trip-dates'
import { REST_GAP_DAYS } from './calendar'
import type { CostCategory, StayKind, Transaction, TransactionKind, TransactionSource, Trip } from './types'
import { addDays } from '../basis/datum'
import { sourceForPeriod } from '../basis/organisatie'

// Uitgaven in het periodemodel (docs/PERIODEMODEL.md): een soort (reizen, eten en drinken, verblijf, opleiding,
// uitrusting, overig) en een periode waar de uitgave bij hoort ("Hoort bij"). Opleiding en uitrusting zijn een
// investering in de zeilcarrière. De bron (source) volgt uit de organisatie van de periode.

/** Opleiding en uitrusting zijn een investering; de rest kosten. */
export function kindForCategory(category: CostCategory): TransactionKind {
  return category === 'opleiding' || category === 'uitrusting' ? 'investering' : 'kosten'
}

/** De soort van een uitgave; null bij een investering van vóór het periodemodel (opleiding of uitrusting: Nakijken). */
export function expenseCategory(tx: Pick<Transaction, 'kind' | 'category'>): CostCategory | null {
  if (tx.category && (tx.kind === 'investering') === (kindForCategory(tx.category) === 'investering')) return tx.category
  return tx.kind === 'investering' ? null : 'overig'
}

/** Waar een uitgave bij kan horen: een bestaande periode, of een nieuwe periode thuis of vrij op die dag. */
export type ExpenseTarget = { kind: 'periode'; period: Period } | { kind: 'nieuw'; stayKind: StayKind }

export function targetKey(target: ExpenseTarget): string {
  return target.kind === 'periode' ? target.period.id : `nieuw:${target.stayKind}`
}

/** Zoveel dagen rond de datum staan periodes als keuze bij "Hoort bij". */
const AROUND_DAYS = 21

/**
 * De keuzes voor "Hoort bij": de periode van de datum, de vorige en de volgende (binnen drie weken). Standaard de
 * periode van de datum; op een reisdag met soort reizen de trip direct na (of vóór) de reis: een vlucht naar een
 * werkweek hoort bij die werkweek. Zonder periode op die dag: een nieuwe periode thuis (of vrij, tussen twee trips).
 */
export function expenseTargets(periods: readonly Period[], date: string, category: CostCategory, dayState = false): { options: ExpenseTarget[]; fallback: ExpenseTarget } {
  const dated = periods.filter((p) => p.start && p.end)
  // Een trip die zijn dagen volgt, loopt tot drie dagen na de laatste gelogde dag (zoals de lopende trip): 's ochtends
  // vóór het loggen hoort een uitgave nog bij die trip.
  const grace = dated.filter((p) => p.view?.trip.datesFromDays && p.end < date && date <= addDays(p.end, DAYS_TRIP_GRACE) && !dated.some((q) => q.id !== p.id && q.start <= date && date <= q.end))
  const current = periodAt(dated, date) ?? grace.at(-1) ?? null
  // Op een wisseldag (of bij overlap) staan alle periodes van die datum als keuze.
  const inside = [...dated.filter((p) => p.start <= date && date <= p.end), ...grace]
  const before = dated.filter((p) => p.end < date && p.end >= addDays(date, -AROUND_DAYS) && !inside.includes(p)).at(-1)
  const after = dated.filter((p) => p.start > date && p.start <= addDays(date, AROUND_DAYS))[0]
  const options: ExpenseTarget[] = []
  for (const p of [before, ...inside, after]) if (p && !options.some((o) => o.kind === 'periode' && o.period.id === p.id)) options.push({ kind: 'periode', period: p })
  if (current) {
    if (category === 'vervoer' && current.kind === 'reis') {
      // Een vlucht naar (of van) een werkweek: de trip die direct na de reis begint, anders de trip die er vlak voor eindigde.
      const next = dated.find((p) => isWaterKind(p.kind) && p.start > current.end && p.start <= addDays(current.end, 2))
      const prev = [...dated].reverse().find((p) => isWaterKind(p.kind) && p.end < current.start && p.end >= addDays(current.start, -2))
      const trip = next ?? prev
      if (trip) {
        if (!options.some((o) => o.kind === 'periode' && o.period.id === trip.id)) options.push({ kind: 'periode', period: trip })
        return { options: sortTargets(options), fallback: { kind: 'periode', period: trip } }
      }
    }
    return { options: sortTargets(options), fallback: { kind: 'periode', period: current } }
  }
  // Geen periode op die dag: tussen twee trips (hoogstens twee dagen) is het vrij, anders thuis. Staat er een zelf
  // ingestelde dagtoestand (optie, onbeschikbaar), dan niet vanzelf een nieuwe periode (die zou de dagtoestand
  // vervangen): standaard de periode ervoor of erna.
  const between = !!before && !!after && isWaterKind(before.kind) && isWaterKind(after.kind) && addDays(before.end, REST_GAP_DAYS + 1) >= after.start
  const fresh: ExpenseTarget[] = between ? [{ kind: 'nieuw', stayKind: 'vrij' }, { kind: 'nieuw', stayKind: 'thuis' }] : [{ kind: 'nieuw', stayKind: 'thuis' }, { kind: 'nieuw', stayKind: 'vrij' }]
  const near = dayState ? (before ?? after) : undefined
  return { options: [...sortTargets(options), ...fresh], fallback: near ? { kind: 'periode', period: near } : fresh[0]! }
}

function sortTargets(list: ExpenseTarget[]): ExpenseTarget[] {
  return [...list].sort((a, b) => (a.kind === 'periode' && b.kind === 'periode' ? (a.period.start < b.period.start ? -1 : 1) : 0))
}

export interface InvestmentTotal {
  eur: number
  other: Record<string, number>
  count: number
}

/** Investering in de zeilcarrière: opleiding en uitrusting (alle uitgaven van soort investering), in euro. */
export function careerInvestment(transactions: readonly Transaction[], eurOf: (tx: Transaction) => number | null, from?: string, to?: string): InvestmentTotal {
  const out: InvestmentTotal = { eur: 0, other: {}, count: 0 }
  for (const tx of active(transactions)) {
    if (tx.kind !== 'investering') continue
    if ((from && tx.date < from) || (to && tx.date > to)) continue
    out.count++
    const eur = eurOf(tx)
    if (eur !== null) out.eur = Math.round((out.eur + eur) * 100) / 100
    else out.other[tx.currency] = Math.round(((out.other[tx.currency] ?? 0) + tx.amount) * 100) / 100
  }
  return out
}

/**
 * De periode van een gekozen doel: een bestaande periode, of (een nieuwe periode thuis of vrij) die eerst maken op die
 * dag. Een aangrenzende periode van dezelfde soort wordt dan langer.
 */
export async function resolveTarget(store: Tx, target: ExpenseTarget, date: string): Promise<string | undefined> {
  if (target.kind === 'periode') return target.period.id
  await setStayDays(store, [date], target.stayKind)
  return active(store.list('periods.json.enc')).find((s) => s.startDate <= date && date <= s.endDate)?.id
}

/** De bron bij bewerken: uit de organisatie van de trip; zonder trip (of zonder organisatie) blijft de oude bron. */
export function sourceOnSave(trip: Trip | undefined, previous: TransactionSource | undefined): TransactionSource {
  const fromTrip = sourceForPeriod(trip)
  return fromTrip !== 'overig' ? fromTrip : (previous ?? 'overig')
}
