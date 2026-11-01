// Opdracht: Logboek herstellen (Meer → Opslag). Zet verkeerd gekoppelde dagen, trips, studenten en deelnemers terug op
// id, volgens het plan uit src/model/link-repair.ts. Pas na een tik, met het voorbeeld vooraf; met geschiedenis, dus
// ongedaan te maken (melding en Meer → Geschiedenis). Elke wijziging is een benoemde opdracht via `commit`.

import { planLinkRepair, type LinkRepairPlan } from '../model/link-repair'
import type { Trip } from '../model/types'
import { opdrachtMet } from './opdracht'
import type { Tx } from './tx'

/** Vingerafdruk van een plan: wat er verandert, los van de volgorde. Zo is te zien of het plan bij de tik nog klopt. */
export function planSignature(plan: LinkRepairPlan): string {
  return [
    ...plan.legs.map((m) => `dag ${m.leg.id} ${m.from}>${m.to}`),
    ...plan.trips.map((f) => `trip ${f.trip.id} ${f.dates ? `${f.dates.before.start}..${f.dates.before.end}>${f.dates.after ? `${f.dates.after.start}..${f.dates.after.end}` : '-'}` : ''} ${f.removedParticipants.map((p) => p.id).sort().join(',')}`),
    ...plan.students.map((m) => `student ${m.student.id} ${m.from ?? '-'}>${m.to}`),
    ...plan.participants.map((b) => `deelnemer ${b.participant.id} ${b.from}>${b.to}`),
  ]
    .sort()
    .join('\n')
}

export type RepairOutcome = { applied: true; plan: LinkRepairPlan } | { applied: false; plan: LinkRepairPlan }

/**
 * Het herstel uitvoeren. `expected`: de vingerafdruk van het voorbeeld dat Olivier zag; is het plan bij de tik anders
 * (een ander apparaat synchroniseerde intussen), dan gebeurt er niets en toont het scherm het nieuwe voorbeeld.
 */
export async function repairLinks(tx: Tx, expected: string): Promise<RepairOutcome> {
  const plan = planLinkRepair(tx, tx.now)
  if (planSignature(plan) !== expected) return { applied: false, plan }
  for (const m of plan.legs) {
    const current = tx.list('legs.json.enc').find((l) => l.id === m.leg.id)
    if (current && current.tripId === m.from) await tx.put('legs.json.enc', { ...current, tripId: m.to, updatedAt: tx.now })
  }
  for (const fix of plan.trips) {
    const current = tx.list('trips.json.enc').find((t) => t.id === fix.trip.id)
    if (!current) continue
    let next: Trip = { ...current }
    if (fix.dates) {
      const { startDate: _s, endDate: _e, ...rest } = next
      void [_s, _e]
      next = fix.dates.after ? { ...rest, startDate: fix.dates.after.start, endDate: fix.dates.after.end } : (rest as Trip)
    }
    if (fix.removedParticipants.length > 0) next = { ...next, participants: (next.participants ?? []).filter((p) => !fix.removedParticipants.some((r) => r.id === p.id)) }
    await tx.put('trips.json.enc', { ...next, updatedAt: tx.now })
  }
  for (const m of plan.students) {
    const current = tx.list('students.json.enc').find((s) => s.id === m.student.id)
    if (current) await tx.put('students.json.enc', { ...current, weekId: m.to, updatedAt: tx.now })
  }
  for (const b of plan.participants) {
    const trip = tx.list('trips.json.enc').find((t) => t.id === b.to)
    if (!trip || trip.participants?.some((p) => p.id === b.participant.id)) continue
    await tx.put('trips.json.enc', { ...trip, participants: [...(trip.participants ?? []), b.participant], updatedAt: tx.now })
  }
  return { applied: true, plan }
}

export const logboekHerstellen = opdrachtMet('logboekHerstellen', repairLinks)
