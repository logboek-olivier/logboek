// Opdrachten voor de agenda en periodes aan land: dagsoort, periodes, tripdatums en de eenmalige omzetting. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { clearDay, resizeTrip, setDay, setDays, type DayDetails, type TripResize } from '../model/calendar'
import { migratePeriods } from '../model/migrate-periods'
import { deleteStay, setStayDays, updateStay, type StayDetails } from '../model/periods'
import type { DayType } from '../model/types'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

/** Dagsoort kiezen in het dagblad: eerst zo nodig de trip een dag korter, dan een periode aan land of een dagtoestand. */
export async function chooseDayType(tx: Tx, date: string, next: DayType, details: DayDetails, stay: StayDetails, shrink: TripResize | null, land: 'reis' | 'thuis' | 'vrij' | null): Promise<void> {
  if (shrink) await resizeTrip(tx, shrink)
  if (land) return setStayDays(tx, [date], land, stay)
  // Een dagtoestand (beschikbaar, optie, onbeschikbaar) hoort bij een dag zonder periode.
  await setStayDays(tx, [date], null)
  await setDay(tx, date, next, details)
}

/** Een dagtoestand voor meerdere dagen (Periode markeren): eerst uit een periode aan land. */
export async function chooseDaysType(tx: Tx, dates: readonly string[], type: DayType): Promise<void> {
  await setStayDays(tx, dates, null)
  await setDays(tx, dates, type)
}

/** Terug naar automatisch: de eigen instelling vervalt en de dag gaat uit zijn periode aan land. */
export async function automaticDay(tx: Tx, date: string): Promise<void> {
  await setStayDays(tx, [date], null)
  await clearDay(tx, date)
}

/** De gegevens van een dag opslaan; reis, thuis of vrij zonder periode krijgt eerst de periode. */
export async function saveDayDetails(tx: Tx, date: string, type: DayType, details: DayDetails, makeStay: 'reis' | 'thuis' | 'vrij' | null, writeDay: boolean): Promise<void> {
  if (makeStay) await setStayDays(tx, [date], makeStay)
  if (writeDay) await setDay(tx, date, type, details)
}

export const dagAutomatisch = opdracht('dagAutomatisch', automaticDay)
export const dagOpslaan = opdracht('dagOpslaan', saveDayDetails)
export const dagsoortAutomatisch = opdracht('dagsoortAutomatisch', clearDay)
export const dagsoortKiezen = opdracht('dagsoortKiezen', chooseDayType)
export const dagsoortZetten = opdrachtMet('dagsoortZetten', setDay)
export const dagsoortenKiezen = opdracht('dagsoortenKiezen', chooseDaysType)
export const dagsoortenZetten = opdracht('dagsoortenZetten', setDays)
export const landperiodeBewerken = opdracht('landperiodeBewerken', updateStay)
export const landperiodeVerwijderen = opdracht('landperiodeVerwijderen', deleteStay)
export const landperiodeZetten = opdracht('landperiodeZetten', setStayDays)
export const periodeDatumsWijzigen = opdracht('periodeDatumsWijzigen', resizeTrip)
export const periodemodelMigreren = opdrachtMet('periodemodelMigreren', migratePeriods)
