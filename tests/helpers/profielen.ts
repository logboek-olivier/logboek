import type { PositionInput } from '../../src/model/position'
import type { RatesFile } from '../../src/model/rates'
import type { Account, Balance, Claim, FixedCost, Settings, Transaction, Trip } from '../../src/model/types'
import { DEFAULT_SETTINGS } from '../../src/model/settings'

// Gouden dataset met twee nepprofielen voor geld en netto waarde (alles verzonnen, CLAUDE.md regel 4). De app moet voor
// iedereen kloppen, niet alleen voor één gebruiker:
// - Profiel A lijkt op een instructeur met een paar seizoenen: twee eigen organisaties, euro en dollars, rekeningen met
//   een geschiedenis van standen (ook een lening en beleggingen), declaraties, een eerder seizoen en een planning.
// - Profiel B is een vriend: één organisatie, alleen inkomsten in dollars, geen rekeningen, geen planning en geen start
//   van de zeilcarrière.
// De uitkomsten staan met de hand uitgerekend in tests/doorklik.test.ts (1 EUR = 1,25 USD op elke dag).

export const T = '2026-11-01T12:00:00.000Z'
export const TODAY = '2026-11-02'

export const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2024-01-01', '2028-01-01'], rates: { USD: [1.25, 1.25] } }

export interface Profile {
  settings: Settings
  input: PositionInput
  fixed: FixedCost[]
}

const trip = (id: string, organisation: string, startDate: string, endDate: string, name = `Nep ${id}`): Trip => ({ id, name, kind: 'werk', type: 'skipper-charter', organisation, startDate, endDate, updatedAt: T, deletedAt: null })

function tx(id: string, date: string, kind: Transaction['kind'], amount: number, currency: 'EUR' | 'USD', extra: Partial<Transaction> = {}): Transaction {
  return { id, date, kind, amount, currency, source: 'overig', ...extra, updatedAt: T, deletedAt: null }
}

const salary = (t: Trip, amount: number, currency: 'EUR' | 'USD', status: 'verwacht' | 'ontvangen', date = t.endDate!): Transaction => tx(`salaris:${t.id}`, date, 'loon', amount, currency, { tripId: t.id, status })

const account = (id: string, name: string, kind: Account['kind'], currency: 'EUR' | 'USD' = 'EUR', provider: Account['provider'] = 'overig'): Account => ({ id, name, provider, kind, currency, updatedAt: T, deletedAt: null })

const balance = (accountId: string, date: string, amount: number): Balance => ({ id: `stand:${accountId}:${date}`, accountId, date, amount, source: 'handmatig', updatedAt: T, deletedAt: null })

/** Profiel A: twee organisaties, euro en dollars, rekeningen met standen, een lening, declaraties en een planning. */
export function profileA(): Profile {
  const a251 = trip('a25-1', 'org:noord', '2025-07-05', '2025-07-11')
  const a261 = trip('a26-1', 'org:noord', '2026-03-07', '2026-03-13')
  const a262 = trip('a26-2', 'org:zuid', '2026-06-01', '2026-06-14')
  const a263 = trip('a26-3', 'org:zuid', '2026-10-10', '2026-10-24')
  // De planning: twee komende tochten.
  const a264 = trip('a26-4', 'org:noord', '2026-12-05', '2026-12-11')
  const a271 = trip('a27-1', 'org:zuid', '2027-01-10', '2027-01-24')
  const transactions: Transaction[] = [
    salary(a251, 1000, 'EUR', 'ontvangen', '2025-07-15'),
    salary(a261, 1200, 'EUR', 'ontvangen', '2026-03-20'),
    salary(a262, 2500, 'USD', 'ontvangen', '2026-06-20'),
    // Voorbij en nog niet binnen: te ontvangen.
    salary(a263, 2000, 'USD', 'verwacht'),
    salary(a264, 1200, 'EUR', 'verwacht'),
    salary(a271, 2500, 'USD', 'verwacht'),
    tx('fooi-a251', '2025-07-11', 'fooi', 250, 'EUR', { tripId: a251.id }),
    tx('fooi-a261', '2026-03-13', 'fooi', 300, 'EUR', { tripId: a261.id }),
    tx('fooi-a262', '2026-06-14', 'fooi', 400, 'USD', { tripId: a262.id }),
    tx('bonus-a262', '2026-06-14', 'bonus', 150, 'EUR', { tripId: a262.id }),
    tx('gift', '2026-08-01', 'overig-inkomen', 100, 'EUR', { note: 'Nepgift' }),
    // Fooi van een eerder seizoen (geen tocht).
    tx('seizoen-noord-2025', '2025-12-31', 'fooi', 500, 'EUR', { season: { org: 'org:noord', year: 2025 } }),
    tx('eten-a261', '2026-03-10', 'kosten', 120, 'EUR', { tripId: a261.id, category: 'eten' }),
    tx('vervoer-a262', '2026-05-28', 'kosten', 300, 'EUR', { tripId: a262.id, category: 'vervoer' }),
    tx('verblijf-a263', '2026-10-12', 'kosten', 80, 'USD', { tripId: a263.id, category: 'verblijf' }),
    tx('cursus', '2026-02-15', 'investering', 650, 'EUR', { category: 'opleiding' }),
    // Een oude investering zonder soort.
    tx('oud-materiaal', '2025-11-01', 'investering', 200, 'EUR'),
    // Een geboekte vaste last.
    tx('vast:tel:2026-09', '2026-09-30', 'kosten', 50, 'EUR', { fixedCostId: 'tel', category: 'overig' }),
    // Declaraties: één terugbetaald, één nog open.
    tx('decl-1-uitgave', '2026-10-15', 'kosten', 90, 'EUR', { tripId: a263.id, claimId: 'claim-1', category: 'overig' }),
    tx('decl-1-terug', '2026-10-28', 'terugbetaling', 90, 'EUR', { tripId: a263.id, claimId: 'claim-1' }),
    tx('decl-2-uitgave', '2026-10-30', 'kosten', 60, 'EUR', { tripId: a263.id, claimId: 'claim-2', category: 'overig' }),
  ]
  const claims: Claim[] = [
    { id: 'claim-1', date: '2026-10-15', tripId: a263.id, amount: 90, currency: 'EUR', status: 'terugbetaald', repaid: { date: '2026-10-28', amount: 90, currency: 'EUR', transactionId: 'decl-1-terug' }, updatedAt: T, deletedAt: null },
    { id: 'claim-2', date: '2026-10-30', tripId: a263.id, amount: 60, currency: 'EUR', status: 'open', updatedAt: T, deletedAt: null },
  ]
  const accounts = [
    account('a-bank', 'Nepbank', 'betaal'),
    account('a-spaar', 'Nepspaar', 'spaar'),
    account('a-beleg', 'Nepbeleggen', 'beleggen', 'EUR', 'degiro'),
    account('a-lening', 'Neplening', 'schuld'),
    account('a-usd', 'Nepdollars', 'betaal', 'USD', 'revolut'),
  ]
  const balances = [
    balance('a-bank', '2025-12-31', 3000),
    balance('a-bank', '2026-03-31', 4200),
    balance('a-bank', '2026-06-30', 5000),
    balance('a-bank', '2026-11-01', 6100),
    balance('a-spaar', '2026-01-01', 10000),
    balance('a-spaar', '2026-11-01', 10500),
    balance('a-beleg', '2026-01-01', 2000),
    balance('a-beleg', '2026-11-01', 2600),
    balance('a-lening', '2025-12-31', -20000),
    balance('a-lening', '2026-11-01', -19000),
    balance('a-usd', '2026-01-01', 500),
    balance('a-usd', '2026-11-01', 800),
  ]
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    organisations: [
      { id: 'org:noord', name: 'Nepzeil Noord', short: 'NN' },
      { id: 'org:zuid', name: 'Nepcharter Zuid', short: 'NZ' },
    ],
    startedEmpty: true,
    careerStart: '2026-01-01',
  }
  const fixed: FixedCost[] = [{ id: 'tel', name: 'Neptelefoon', currency: 'EUR', amounts: [{ from: '2026-01', amount: 50 }], updatedAt: T, deletedAt: null }]
  return { settings, fixed, input: { accounts, balances, trips: [a251, a261, a262, a263, a264, a271], legs: [], transactions, rates: RATES, claims } }
}

/** Profiel B: een vriend met één organisatie, alleen dollars, geen rekeningen, geen planning, geen start van de zeilcarrière. */
export function profileB(): Profile {
  const b1 = trip('b26-1', 'org:een', '2026-05-02', '2026-05-09')
  const b2 = trip('b26-2', 'org:een', '2026-08-01', '2026-08-08')
  const b3 = trip('b26-3', 'org:een', '2026-10-20', '2026-10-27')
  const transactions: Transaction[] = [
    salary(b1, 3000, 'USD', 'ontvangen', '2026-05-15'),
    salary(b2, 3000, 'USD', 'ontvangen', '2026-08-20'),
    salary(b3, 3000, 'USD', 'verwacht'),
    tx('fooi-b1', '2026-05-09', 'fooi', 600, 'USD', { tripId: b1.id }),
    tx('fooi-b2', '2026-08-08', 'fooi', 450, 'USD', { tripId: b2.id }),
    tx('vervoer-b2', '2026-07-30', 'kosten', 200, 'USD', { tripId: b2.id, category: 'vervoer' }),
  ]
  const settings: Settings = { ...DEFAULT_SETTINGS, organisations: [{ id: 'org:een', name: 'Nepvloot' }], startedEmpty: true }
  return { settings, fixed: [], input: { accounts: [], balances: [], trips: [b1, b2, b3], legs: [], transactions, rates: RATES, claims: [] } }
}
