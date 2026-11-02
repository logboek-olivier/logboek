import type { RatesFile } from '../../src/model/rates'
import type { Transaction, Trip } from '../../src/model/types'

// Gouden dataset voor geld (verzonnen, CLAUDE.md regel 4): zoals een logboek er vóór "Geld omzetten" uitzag, met alles
// wat in het oude model door elkaar liep. Twee Yacht Week-seizoenen met genummerde weken, Sailing Virgins in dollars, een
// salaris dat alleen op de tocht stond (verwacht, ontvangen met en zonder bedrag, geen), een los ingevoerd loon zonder
// salaris op de tocht, een tocht met twee salarissen, oude contante fooien (gestort en niet gestort) en kosten per tocht.
// De verwachte uitkomsten staan met de hand uitgerekend in de tests (tests/geld-gouden.test.ts).

export const T = '2026-10-31T12:00:00.000Z'
/** De dag waarop de tests rekenen. */
export const TODAY = '2026-11-01'

/** Eén vaste koers: 1 EUR = 1,25 USD op elke dag (definitief, nooit voorlopig). */
export const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2024-01-01', '2028-01-01'], rates: { USD: [1.25, 1.25] } }

type OldSalary = { amount: number; currency: 'EUR' | 'USD'; status: 'verwacht' | 'ontvangen' | 'geen'; source: 'standaard' | 'eigen'; transactionId?: string }

function trip(id: string, name: string, organisation: string, startDate: string, endDate: string, salary?: OldSalary, extra: Partial<Trip> = {}): Trip {
  return { id, name, kind: 'werk', type: 'skipper-charter', organisation, startDate, endDate, ...(salary ? { salary } : {}), ...extra, updatedAt: T, deletedAt: null } as Trip
}

function tx(id: string, date: string, kind: Transaction['kind'], amount: number, currency: 'EUR' | 'USD', tripId: string, extra: Record<string, unknown> = {}): Transaction {
  const source = tripId.startsWith('sv') ? 'sailing-virgins' : 'yacht-week'
  return { id, date, kind, amount, currency, source, tripId, ...(currency === 'EUR' ? { amountEur: amount } : {}), ...extra, updatedAt: T, deletedAt: null } as Transaction
}

/** Vier gasten met voornaam (Sailing Virgins); Yacht Week heeft geen namen. */
const guests = ['Anna', 'Ben', 'Cas', 'Dirk'].map((firstName, i) => ({ id: `gast-${i}`, firstName }))

export function oldTrips(): Trip[] {
  return [
    // Yacht Week 2025: salaris op de tocht met het inkomen erbij (twee keer), en een los ingevoerd loon zonder salaris op de tocht.
    trip('yw25-1', 'Yacht week 1', 'yacht-week', '2025-07-05', '2025-07-11', { amount: 900, currency: 'EUR', status: 'ontvangen', source: 'eigen', transactionId: 'salaris:yw25-1' }),
    trip('yw25-2', 'Yacht week 2', 'yacht-week', '2025-07-12', '2025-07-18', { amount: 900, currency: 'EUR', status: 'ontvangen', source: 'standaard', transactionId: 'salaris:yw25-2' }),
    trip('yw25-3', 'Yacht week 3', 'yacht-week', '2025-07-19', '2025-07-25'),
    // Yacht Week 2026: met inkomen, "ontvangen" zonder bedrag en zonder inkomen, en "ontvangen" met bedrag maar zonder inkomen.
    trip('yw26-1', 'Yacht week 1', 'yacht-week', '2026-07-04', '2026-07-10', { amount: 1000, currency: 'EUR', status: 'ontvangen', source: 'eigen', transactionId: 'salaris:yw26-1' }),
    trip('yw26-2', 'Yacht week 2', 'yacht-week', '2026-07-11', '2026-07-17', { amount: 0, currency: 'EUR', status: 'ontvangen', source: 'eigen' }),
    trip('yw26-3', 'Yacht week 3', 'yacht-week', '2026-07-18', '2026-07-24', { amount: 1000, currency: 'EUR', status: 'ontvangen', source: 'eigen' }),
    // Sailing Virgins in dollars: verwacht (alleen op de tocht), ontvangen met twee loon-transacties, en geen salaris.
    trip('sv26-a', 'SV #1 · BVI', 'sailing-virgins', '2026-10-03', '2026-10-09', { amount: 1500, currency: 'USD', status: 'verwacht', source: 'standaard' }, { participants: guests }),
    trip('sv26-b', 'SV #2 · BVI', 'sailing-virgins', '2026-10-10', '2026-10-16', { amount: 1500, currency: 'USD', status: 'ontvangen', source: 'eigen', transactionId: 'salaris:sv26-b' }),
    trip('sv26-c', 'SV #3 · BVI', 'sailing-virgins', '2026-10-17', '2026-10-23', { amount: 0, currency: 'USD', status: 'geen', source: 'eigen' }),
  ]
}

export function oldTransactions(): Transaction[] {
  return [
    tx('salaris:yw25-1', '2025-07-15', 'loon', 900, 'EUR', 'yw25-1'),
    tx('fooi-yw25-1', '2025-07-11', 'fooi', 300, 'EUR', 'yw25-1', { tipVia: 'contant' }),
    tx('kosten-yw25-1', '2025-07-06', 'kosten', 50, 'EUR', 'yw25-1', { category: 'eten' }),
    tx('salaris:yw25-2', '2025-07-22', 'loon', 900, 'EUR', 'yw25-2'),
    tx('fooi-yw25-2', '2025-07-18', 'fooi', 250, 'EUR', 'yw25-2', { tipVia: 'contant', depositedAt: '2025-08-01' }),
    tx('loon-yw25-3', '2025-07-30', 'loon', 950, 'EUR', 'yw25-3'),
    tx('fooi-yw25-3', '2025-07-25', 'fooi', 200, 'EUR', 'yw25-3', { tipVia: 'bank' }),
    tx('salaris:yw26-1', '2026-07-14', 'loon', 1000, 'EUR', 'yw26-1'),
    tx('fooi-yw26-1', '2026-07-10', 'fooi', 400, 'EUR', 'yw26-1'),
    tx('fooi-yw26-2', '2026-07-17', 'fooi', 350, 'EUR', 'yw26-2', { tipVia: 'contant' }),
    tx('kosten-yw26-3', '2026-07-19', 'kosten', 80, 'EUR', 'yw26-3', { category: 'vervoer' }),
    tx('fooi-sv26-a', '2026-10-09', 'fooi', 500, 'USD', 'sv26-a', { tipFrom: { kind: 'groep' } }),
    tx('salaris:sv26-b', '2026-10-20', 'loon', 1500, 'USD', 'sv26-b'),
    tx('loon-sv26-b-extra', '2026-10-21', 'loon', 200, 'USD', 'sv26-b'),
    tx('fooi-sv26-b', '2026-10-16', 'fooi', 600, 'USD', 'sv26-b'),
    tx('kosten-sv26-b', '2026-10-12', 'kosten', 100, 'USD', 'sv26-b', { category: 'eten' }),
  ]
}
