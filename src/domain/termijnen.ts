// Opdrachten voor termijnen en de weekafsluiting. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { deleteReminder, deleteWeekClosing } from '../model/edit'
import type { RatesFile } from '../model/rates'
import { saveReminder, setDone } from '../model/reminders'
import type { Currency, Organisation } from '../model/types'
import { saveClosing } from '../model/week-close'
import { applyMoneyStep, type MoneyStep } from '../model/week-money'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'

/** De week afsluiten met de geldstap (alleen wat is ingevuld of aangevinkt). */
export async function closeWeekWithMoney(
  tx: Tx,
  date: string,
  closing: { rating: number | null; lesson: string; spent?: { amount: number; currency: Currency } | null },
  step: MoneyStep | null,
  today: string,
  rates: RatesFile | null,
): Promise<{ skipped: Organisation[] }> {
  const result = step ? await applyMoneyStep(tx, step, today, rates) : { skipped: [] }
  await saveClosing(tx, date, closing)
  return result
}

export const termijnAfronden = opdracht('termijnAfronden', setDone)
export const termijnOpslaan = opdrachtMet('termijnOpslaan', saveReminder)
export const termijnVerwijderen = opdracht('termijnVerwijderen', deleteReminder)
export const weekAfsluiten = opdracht('weekAfsluiten', saveClosing)
export const weekAfsluitenMetGeld = opdrachtMet('weekAfsluitenMetGeld', closeWeekWithMoney)
export const weekafsluitingVerwijderen = opdracht('weekafsluitingVerwijderen', deleteWeekClosing)
