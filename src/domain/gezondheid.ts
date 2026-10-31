// Opdracht voor de gezondheidscheck (Meer → Opslag → Gezondheid): een overtreding met één tik oplossen, waar dat
// zonder gokken kan. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { addDays } from '../basis/datum'
import { rangeDates, setStayDays } from '../model/periods'
import { saveSettings } from '../model/settings'
import type { Violation } from './invariants'
import { opdracht } from './opdracht'
import type { Tx } from './tx'

/** Welke overtredingen een fix van één tik hebben. */
export function canFix(violation: Violation): boolean {
  return violation.rule === 'lopende-trip-weg' || violation.rule === 'salaris-zonder-inkomen' || violation.rule === 'land-overlap' || violation.rule === 'trip-datums'
}

export async function fixViolation(tx: Tx, violation: Violation): Promise<void> {
  switch (violation.rule) {
    case 'lopende-trip-weg':
      // De lopende trip wijst naar een trip die weg is: geen lopende trip (Vandaag kiest dan de trip van vandaag).
      return saveSettings(tx, { activeWeekId: undefined })
    case 'salaris-zonder-inkomen': {
      // "Ontvangen" maar het inkomen is weg: weer te ontvangen (het bedrag blijft staan).
      const trip = tx.list('trips.json.enc').find((x) => x.id === violation.id)
      if (!trip?.salary) return
      const { transactionId: _t, ...salary } = trip.salary
      void _t
      return tx.put('trips.json.enc', { ...trip, salary: { ...salary, status: 'verwacht' }, updatedAt: tx.now })
    }
    case 'land-overlap': {
      // Twee periodes aan land op dezelfde dagen: de eerst begonnen houdt die dagen, de andere wordt korter.
      const first = tx.list('periods.json.enc').find((s) => s.id === violation.id)
      const second = tx.list('periods.json.enc').find((s) => s.id === violation.other)
      if (!first || !second) return
      const from = second.startDate > first.startDate ? second.startDate : first.startDate
      const to = second.endDate < first.endDate ? second.endDate : first.endDate
      if (from > to) return
      const days = rangeDates(from, to)
      if (second.startDate >= from && second.endDate <= to) return setStayDays(tx, days, first.kind)
      // Alleen het stuk dat overlapt gaat van de tweede af.
      await tx.put('periods.json.enc', second.startDate < from ? { ...second, endDate: addDays(from, -1), updatedAt: tx.now } : { ...second, startDate: addDays(to, 1), updatedAt: tx.now })
      return
    }
    case 'trip-datums': {
      // Begin na eind: omdraaien (de dagen zelf blijven staan).
      const trip = tx.list('trips.json.enc').find((x) => x.id === violation.id)
      if (!trip?.startDate || !trip.endDate) return
      return tx.put('trips.json.enc', { ...trip, startDate: trip.endDate, endDate: trip.startDate, updatedAt: tx.now })
    }
    default:
      return
  }
}

export const gezondheidHerstellen = opdracht('gezondheidHerstellen', fixViolation)
