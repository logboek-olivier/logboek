// Opdracht voor de gezondheidscheck (Meer → Opslag → Gezondheid): een overtreding met één tik oplossen, waar dat
// zonder gokken kan. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { saveSettings } from '../model/settings'
import type { Violation } from './invariants'
import { opdracht } from './opdracht'
import type { Tx } from './tx'

/** Welke overtredingen een fix van één tik hebben. */
export function canFix(violation: Violation): boolean {
  return violation.rule === 'lopende-trip-weg' || violation.rule === 'trip-datums'
}

export async function fixViolation(tx: Tx, violation: Violation): Promise<void> {
  switch (violation.rule) {
    case 'lopende-trip-weg':
      // De lopende trip wijst naar een trip die weg is: geen lopende trip (Vandaag kiest dan de trip van vandaag).
      return saveSettings(tx, { activeWeekId: undefined })
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
