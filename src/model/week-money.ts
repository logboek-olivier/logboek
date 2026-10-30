import type { Store } from '../storage/store'
import { balanceId, scrubbedBalance, setBalance } from './accounts'
import type { Undo } from './edit'
import { depositCash, expectedPayout, recordPayout } from './money-path'
import type { RatesFile } from './rates'
import type { Account, Balance, Currency, Organisation, Trip } from './types'

// De geldstap van de weekafsluiting (wekelijks 2 minuten): de stand per bankrekening, ontvangen uitbetalingen afvinken,
// gestorte contanten afvinken; de schatting "los uitgegeven" hoort bij de afsluiting zelf. Alles overslaan mag: alleen
// wat is ingevuld of aangevinkt, wordt opgeslagen. Eén ongedaan maken zet alles van deze stap terug.

export interface MoneyStep {
  /** Stand van vandaag per rekening (alleen ingevulde). */
  balances: { account: Account; amount: number }[]
  /** Trips waarvan het salaris binnen is (te ontvangen, aangevinkt): per organisatie één uitbetaling van het verwachte bedrag. */
  received: Trip[]
  /** Valuta's waarvan alle contante fooien gestort zijn. */
  deposited: Currency[]
}

export function isEmptyStep(step: MoneyStep): boolean {
  return step.balances.length === 0 && step.received.length === 0 && step.deposited.length === 0
}

/**
 * De geldstap opslaan. Een uitbetaling gaat met het verwachte bedrag (in de valuta van de trips als die gelijk is, anders
 * in euro); zonder koers slaat de app die organisatie over (geeft hem terug), dan via Geld → Uitbetaling invoeren.
 */
export async function applyMoneyStep(store: Store, step: MoneyStep, today: string, rates: RatesFile | null): Promise<{ undo: Undo; skipped: Organisation[] }> {
  const undos: Undo[] = []
  const skipped: Organisation[] = []
  for (const { account, amount } of step.balances) {
    const id = balanceId(account.id, today)
    const before: Balance | undefined = store.get('balances.json.enc').find((b) => b.id === id)
    const written = await setBalance(store, account, today, amount, today)
    if (!written) continue
    undos.push(async () => {
      const now = new Date().toISOString()
      await store.put('balances.json.enc', before ? { ...before, updatedAt: now } : scrubbedBalance(written, now))
    })
  }
  const byOrg = new Map<Organisation, Trip[]>()
  for (const trip of step.received) {
    if (!trip.organisation || !trip.salary) continue
    byOrg.set(trip.organisation, [...(byOrg.get(trip.organisation) ?? []), trip])
  }
  const legs = store.list('legs.json.enc')
  for (const [org, trips] of byOrg) {
    const currencies = new Set(trips.map((x) => x.salary!.currency))
    const currency: Currency = currencies.size === 1 ? [...currencies][0]! : 'EUR'
    const amount = expectedPayout(trips, legs, currency, today, rates)
    if (amount === null || amount <= 0) {
      skipped.push(org)
      continue
    }
    undos.push(await recordPayout(store, { org, amount, currency, date: today }, trips, rates))
  }
  for (const currency of step.deposited) undos.push(await depositCash(store, currency, today))
  void store.sync()
  return {
    skipped,
    undo: async () => {
      for (const undo of [...undos].reverse()) await undo()
      void store.sync()
    },
  }
}
