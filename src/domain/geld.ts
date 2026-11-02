// Opdrachten voor geld: inkomsten en uitgaven, salaris en uitbetalingen, declaraties, vaste lasten, rekeningen en standen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { deleteAccount, deleteBalance, saveAccount, setBalance, signedAmount, writeBalances } from '../model/accounts'
import { addClaim, deleteClaim, markRepaid, markSubmitted, updateClaim } from '../model/claims'
import { addFixedCost, changeFixedCost, deleteFixedCost } from '../model/costs'
import { deleteTransaction, updateTransaction, type TransactionPatch } from '../model/edit'
import { resolveTarget, sourceOnSave, type ExpenseTarget } from '../model/expenses'
import { bookFixedCosts } from '../model/fixed-bookings'
import { recordPayout } from '../model/money-path'
import { finalRateFields } from '../model/rates'
import { askSalaryLater, receiveSalary, saveSalary, saveSalaryDefaults, setNoSalary } from '../model/salary'
import { saveSettings } from '../model/settings'
import { addScenarioBlock, changeScenarioBlock, createScenario, deleteScenario, moveScenarioBlock, removeScenarioBlock, renameScenario, setScenarioStart } from '../model/scenario'
import { newId, type Account, type Balance, type Currency, type Leg, type Organisation, type Settings, type Transaction, type Trip } from '../model/types'
import { active } from '../model/derive'
import { weekView } from '../model/weeks'
import { round2 } from '../basis/bedrag'
import { applyMoneyStep } from '../model/week-money'
import { salaryOf, salaryStatus } from './geldmodel'
import { opdracht, opdrachtMet } from './opdracht'
import type { Tx } from './tx'
import { sourceForOrganisation, sourceForPeriod, tripOrganisation } from '../basis/organisatie'

type Remember = Partial<Omit<Settings, 'id' | 'updatedAt' | 'deletedAt'>>

export type NewMoney = Omit<Transaction, 'id' | 'updatedAt' | 'deletedAt' | 'tripId' | 'amountEur' | 'status'>

/**
 * Een inkomen of uitgave toevoegen, met de koers als die definitief is, en de laatst gebruikte keuzes onthouden. Een loon
 * bij een tocht is zijn salaris: dat is er maar één, dus dan wordt een verwacht salaris ontvangen; een ontvangen salaris
 * nooit nog eens.
 */
export async function addMoney(tx: Tx, fields: NewMoney, tripId: string | null, remember: Remember = {}): Promise<Transaction> {
  if (fields.kind === 'loon' && tripId) {
    // Een salaris dat al binnen is, wordt nooit overschreven (het scherm opent dan het bestaande salaris).
    const current = salaryOf(tripId, tx.list('transactions.json.enc'))
    if (current && salaryStatus(current) === 'ontvangen') throw new Error('salaris bestaat al')
    const record = await saveSalary(tx, tripId, { amount: fields.amount, currency: fields.currency, status: 'ontvangen', date: fields.date })
    await saveSettings(tx, { lastCurrency: fields.currency, ...remember })
    return record
  }
  const record: Transaction = { ...fields, id: newId(), updatedAt: tx.now, deletedAt: null }
  if (fields.kind === 'loon') record.status = 'ontvangen'
  if (tripId) {
    record.tripId = tripId
    delete record.season
  }
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

/**
 * Beginsaldo invoeren (Mijn positie, "Verandering onbekend"): per rekening een stand op de begindag van de periode. Een
 * stand van een andere dag blijft staan (de geschiedenis); een datum in de toekomst wordt niet opgeslagen.
 */
export async function setStartBalances(tx: Tx, entries: readonly { account: Account; amount: number }[], date: string): Promise<Balance[]> {
  const out: Balance[] = []
  for (const { account, amount } of entries) {
    const written = await setBalance(tx, account, date, amount)
    if (written) out.push(written)
  }
  return out
}

/** Een stand met de hand wijzigen. */
export async function changeBalance(tx: Tx, account: Account, balance: Balance, amount: number): Promise<void> {
  // Het record zoals het nu is, met alleen bedrag en bron gewijzigd: velden van een nieuwere versie blijven staan.
  const current = tx.get('balances.json.enc').find((b) => b.id === balance.id) ?? balance
  await tx.put('balances.json.enc', { ...current, amount: signedAmount(account, amount), source: 'handmatig', updatedAt: tx.now })
}

/** Een bedrag van een eerder seizoen: bedrag en valuta. */
export interface SeasonAmount {
  amount: number
  currency: Currency
}

export interface EarlierSeason {
  org: Organisation
  year: number
  salary?: SeasonAmount
  tips?: SeasonAmount
  costs?: SeasonAmount
}

/** Datum van seizoensgeld: de laatste dag van de laatste tocht van de organisatie in dat jaar, anders 31 december. */
export function seasonDate(trips: readonly Trip[], legs: readonly Leg[], org: Organisation, year: number): string {
  let last = ''
  for (const trip of active(trips)) {
    const own = tripOrganisation(trip) ?? trip.organisation
    if (own !== org) continue
    const end = weekView(trip, legs).endDate
    if (end.startsWith(`${year}-`) && end > last) last = end
  }
  return last || `${year}-12-31`
}

/**
 * Money → "Eerder seizoen": voor geld waarvan Olivier de tocht niet meer weet. Elk ingevuld bedrag (salaris, fooien,
 * kosten) wordt één transactie, gekoppeld aan het seizoen (organisatie en jaar), op de laatste dag van de laatste tocht
 * van die organisatie in dat jaar (anders 31 december). Telt mee in de totalen, per organisatie, het jaaroverzicht en
 * per werkdag (op die datum), niet in de fooi per gast.
 */
export async function addEarlierSeason(tx: Tx, input: EarlierSeason): Promise<Transaction[]> {
  const date = seasonDate(tx.list('trips.json.enc'), tx.list('legs.json.enc'), input.org, input.year)
  const season = { org: input.org, year: input.year }
  const source = sourceForOrganisation(input.org)
  const out: Transaction[] = []
  const add = async (kind: Transaction['kind'], value: SeasonAmount | undefined, extra: Partial<Transaction> = {}) => {
    if (!value || !(value.amount > 0)) return
    const base = { date, amount: round2(value.amount), currency: value.currency }
    const record: Transaction = {
      id: newId(),
      ...base,
      kind,
      source,
      season,
      ...extra,
      ...(value.currency === 'EUR' ? { amountEur: base.amount } : (finalRateFields(base) ?? {})),
      updatedAt: tx.now,
      deletedAt: null,
    }
    await tx.put('transactions.json.enc', record)
    out.push(record)
  }
  await add('loon', input.salary, { status: 'ontvangen' })
  await add('fooi', input.tips)
  await add('kosten', input.costs, { category: 'overig' })
  return out
}

export const eerderSeizoenInvoeren = opdrachtMet('eerderSeizoenInvoeren', addEarlierSeason)
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
export const rekeningOpslaan = opdrachtMet('rekeningOpslaan', saveAccount)
export const rekeningVerwijderen = opdracht('rekeningVerwijderen', deleteAccount)
export const salarisLaterVragen = opdracht('salarisLaterVragen', askSalaryLater)
export const salarisOntvangen = opdracht('salarisOntvangen', receiveSalary)
export const salarisOpslaan = opdrachtMet('salarisOpslaan', saveSalary)
export const standOpslaan = opdrachtMet('standOpslaan', setBalance)
export const beginsaldiInvoeren = opdrachtMet('beginsaldiInvoeren', setStartBalances)

// Scenario's (Geld → Verwacht → Scenario, src/model/scenario.ts). Het actieve scenario staat in de instellingen.
export const scenarioMaken = opdrachtMet('scenarioMaken', async (tx: Tx, name: string) => {
  const scenario = await createScenario(tx, name)
  await saveSettings(tx, { activeScenarioId: scenario.id })
  return scenario
})
export const scenarioActiveren = opdracht('scenarioActiveren', (tx: Tx, id: string) => saveSettings(tx, { activeScenarioId: id }))
export const scenarioHernoemen = opdrachtMet('scenarioHernoemen', renameScenario)
export const scenarioBeginAanpassen = opdrachtMet('scenarioBeginAanpassen', setScenarioStart)
export const scenarioVerwijderen = opdracht('scenarioVerwijderen', deleteScenario)
export const blokToevoegen = opdrachtMet('blokToevoegen', addScenarioBlock)
export const blokWijzigen = opdrachtMet('blokWijzigen', changeScenarioBlock)
export const blokVerwijderen = opdrachtMet('blokVerwijderen', removeScenarioBlock)
export const blokVerplaatsen = opdrachtMet('blokVerplaatsen', moveScenarioBlock)
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
