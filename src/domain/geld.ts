// Opdrachten voor geld: inkomsten en uitgaven, salaris en uitbetalingen, declaraties, vaste lasten, rekeningen en standen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { deleteAccount, deleteBalance, saveAccount, setBalance, writeBalances } from '../model/accounts'
import { addClaim, deleteClaim, markRepaid, markSubmitted, updateClaim } from '../model/claims'
import { addFixedCost, changeFixedCost, deleteFixedCost } from '../model/costs'
import { deleteTransaction, updateTransaction, type TransactionPatch } from '../model/edit'
import { resolveTarget, sourceOnSave, type ExpenseTarget } from '../model/expenses'
import { bookFixedCosts } from '../model/fixed-bookings'
import { depositCash, recordPayout } from '../model/money-path'
import { backfillRates, finalRateFields } from '../model/rates'
import { askSalaryLater, receiveSalary, saveSalaryDefaults, setNoSalary } from '../model/salary'
import { saveSettings } from '../model/settings'
import { newId, type Account, type Balance, type Settings, type Transaction, type Trip } from '../model/types'
import { applyMoneyStep } from '../model/week-money'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'
import { sourceForPeriod } from '../basis/organisatie'

type Remember = Partial<Omit<Settings, 'id' | 'updatedAt' | 'deletedAt'>>

/** Het salaris van een trip zetten of wijzigen (de rest van de trip blijft zoals hij is). */
export async function setTripSalary(tx: Tx, tripId: string, salary: Trip['salary']): Promise<void> {
  const trip = tx.list('trips.json.enc').find((x) => x.id === tripId)
  if (!trip) return
  const { salary: _old, ...rest } = trip
  void _old
  await tx.put('trips.json.enc', { ...rest, ...(salary ? { salary } : {}), updatedAt: tx.now })
}

export type NewMoney = Omit<Transaction, 'id' | 'updatedAt' | 'deletedAt' | 'tripId' | 'amountEur'>

/** Een inkomen of uitgave toevoegen, met de koers als die definitief is, en de laatst gebruikte keuzes onthouden. */
export async function addMoney(tx: Tx, fields: NewMoney, tripId: string | null, remember: Remember = {}): Promise<Transaction> {
  const record: Transaction = { ...fields, id: newId(), updatedAt: tx.now, deletedAt: null }
  if (tripId) record.tripId = tripId
  if (fields.currency === 'EUR') record.amountEur = fields.amount
  else Object.assign(record, finalRateFields(fields) ?? {})
  await tx.put('transactions.json.enc', record)
  await saveSettings(tx, { lastCurrency: fields.currency, ...remember })
  return record
}

/** Een uitgave toevoegen bij de gekozen periode (Hoort bij); zo nodig maakt dit eerst de periode thuis of vrij. */
export async function addExpense(tx: Tx, target: ExpenseTarget, fields: Omit<NewMoney, 'source'>, remember: Remember): Promise<Transaction> {
  const tripId = (await resolveTarget(tx, target, fields.date)) ?? null
  const trip = tripId ? tx.list('trips.json.enc').find((x) => x.id === tripId) : undefined
  return addMoney(tx, { ...fields, source: sourceForPeriod(trip) }, tripId, remember)
}

/** Een uitgave bewerken met Hoort bij (een declaratie-uitgave volgt haar declaratie en gaat via geldBewerken). */
export async function editExpense(tx: Tx, record: Transaction, target: ExpenseTarget, patch: Omit<TransactionPatch, 'tripId' | 'source'>): Promise<void> {
  const tripId = (await resolveTarget(tx, target, patch.date)) ?? null
  const trip = tripId ? tx.list('trips.json.enc').find((x) => x.id === tripId) : undefined
  await updateTransaction(tx, record, { ...patch, tripId, source: sourceOnSave(trip, record.source) })
}

/** Een stand met de hand wijzigen. */
export async function changeBalance(tx: Tx, account: Account, balance: Balance, amount: number): Promise<void> {
  await setBalance(tx, account, balance.date, amount, balance.date)
}

export const contantGestort = opdracht('contantGestort', depositCash)
export const declaratieBewerken = opdracht('declaratieBewerken', updateClaim)
export const declaratieIngediend = opdracht('declaratieIngediend', markSubmitted)
export const declaratieTerugbetaald = opdracht('declaratieTerugbetaald', markRepaid)
export const declaratieToevoegen = opdrachtMet('declaratieToevoegen', addClaim)
export const declaratieVerwijderen = opdracht('declaratieVerwijderen', deleteClaim)
export const geenSalaris = opdracht('geenSalaris', setNoSalary)
export const geldBewerken = opdracht('geldBewerken', updateTransaction)
export const geldToevoegen = opdrachtMet('geldToevoegen', addMoney)
export const geldVerwijderen = opdracht('geldVerwijderen', deleteTransaction)
export const geldstapOpslaan = opdrachtMet('geldstapOpslaan', applyMoneyStep)
export const koersenVastleggen = opdrachtMet('koersenVastleggen', backfillRates)
export const rekeningOpslaan = opdrachtMet('rekeningOpslaan', saveAccount)
export const rekeningVerwijderen = opdracht('rekeningVerwijderen', deleteAccount)
export const salarisLaterVragen = opdracht('salarisLaterVragen', askSalaryLater)
export const salarisOntvangen = opdracht('salarisOntvangen', receiveSalary)
export const salarisZetten = opdracht('salarisZetten', setTripSalary)
export const standOpslaan = opdrachtMet('standOpslaan', setBalance)
export const standVerwijderen = opdracht('standVerwijderen', deleteBalance)
export const standWijzigen = opdracht('standWijzigen', changeBalance)
export const standaardsalarisOpslaan = opdrachtMet('standaardsalarisOpslaan', saveSalaryDefaults)
export const standenImporteren = opdrachtMet('standenImporteren', writeBalances)
export const uitbetalingInvoeren = opdracht('uitbetalingInvoeren', recordPayout)
export const uitgaveBewerken = opdracht('uitgaveBewerken', editExpense)
export const uitgaveToevoegen = opdrachtMet('uitgaveToevoegen', addExpense)
export const uitgaveperiodeKiezen = opdrachtMet('uitgaveperiodeKiezen', resolveTarget)
export const vasteLastToevoegen = opdrachtMet('vasteLastToevoegen', addFixedCost)
export const vasteLastVerwijderen = opdracht('vasteLastVerwijderen', deleteFixedCost)
export const vasteLastWijzigen = opdracht('vasteLastWijzigen', changeFixedCost)
export const vasteLastenBoeken = opdrachtMet('vasteLastenBoeken', bookFixedCosts)
