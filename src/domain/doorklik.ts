import { toEur } from '../model/accounts'
import { active } from '../model/derive'
import { expenseCategory } from '../model/expenses'
import { isEarned, isIncome } from '../model/money'
import { GROUP, type Forecast, type ForecastItem, type NetWorthChange, type Position } from '../model/position'
import type { BlockRange } from '../model/scenario'
import { eurValue, type RatesFile } from '../model/rates'
import { groupOf, type TaxGroup } from '../model/tax-year'
import type { Account, Claim, CostCategory, Currency, Transaction, TransactionKind, Trip } from '../model/types'
import { addDays } from '../basis/datum'
import { transactionList, type ReportPeriod } from './geldrapport'

// Doorklikken in Geld: elk bedrag toont de posten die eronder vallen, gegroepeerd per soort en organisatie, met
// subtotalen die precies optellen tot het getikte bedrag (in centen gerekend, zodat afronden nooit een cent verschil
// geeft). Dezelfde transacties en regels als het bedrag zelf (src/domain/geldrapport.ts, src/model/money.ts): getest in
// tests/doorklik.test.ts met twee nepprofielen. Bij elke post staat wat er te openen is (de transactie, de declaratie of
// de rekening).

/** Waar een groep bij hoort; de schermen maken er een kop van (soort, organisatie). */
export type DrillSection =
  | 'inkomsten'
  | 'terugbetaald'
  | 'kosten'
  | 'salaris'
  | 'declaraties'
  | 'begin'
  | 'eind'
  | 'rekeningen'
  | 'zeilresultaat'
  | 'scenario'
  | 'eenmalig'
  | 'groei'

export interface DrillPost {
  key: string
  /** De transactie om te openen en te bewerken. */
  tx?: Transaction
  claim?: Claim
  account?: Account
  trip?: Trip
  date: string
  /** In de oorspronkelijke valuta (bij een rekening: de verandering in de valuta van de rekening, of 0). */
  amount: number
  currency: Currency
  /** Bijdrage aan het getikte bedrag in euro, met teken; null zonder koers. */
  eur: number | null
  provisional: boolean
  /** Bij een rekening: de stand op de begindag en op het einde, in de valuta van de rekening (null: geen stand). */
  balances?: { start: number | null; end: number | null }
  /** Vooruitblik: de maand (jjjj-mm) van een kostenpost of een deel van een scenarioblok. */
  month?: string
  /** Vooruitblik: een schatting (fooi), geen transactie. */
  estimate?: boolean
  /** Vooruitblik: de naam van een eenmalige uitgave. */
  oneOffName?: string
  /** Vooruitblik: wanneer een salaris waarschijnlijk wordt uitbetaald (ter informatie). */
  payout?: string
  /** Vooruitblik, waardegroei: waarover gerekend is en met welk percentage van die maand. */
  growth?: { opening: number; rate: number; contribution: number }
}

export interface DrillGroup {
  key: string
  section: DrillSection
  /** Soort transactie of soort uitgave; in de vooruitblik ook vaste lasten, variabele kosten en kosten van een scenarioblok. */
  kind?: TransactionKind | CostCategory | 'onbekend' | 'vaste-lasten' | 'variabel' | 'scenario-kosten' | 'groei-beleggen' | 'groei-bezit' | 'rente-schuld'
  org?: TaxGroup
  /** Bij een scenario: het blok. */
  block?: BlockRange
  eur: number
  /** Posten zonder koers, per valuta (met teken). */
  other: Partial<Record<Currency, number>>
  posts: DrillPost[]
}

export interface Drill {
  eur: number
  other: Partial<Record<Currency, number>>
  groups: DrillGroup[]
}

interface Entry {
  post: DrillPost
  section: DrillSection
  kind?: DrillGroup['kind']
  org?: TaxGroup
  block?: BlockRange
}

const SECTION_ORDER: readonly DrillSection[] = ['rekeningen', 'inkomsten', 'salaris', 'scenario', 'groei', 'terugbetaald', 'kosten', 'eenmalig', 'declaraties', 'eind', 'begin', 'zeilresultaat']
const toCents = (n: number) => Math.round(n * 100)

function build(entries: readonly Entry[]): Drill {
  const groups = new Map<string, { group: DrillGroup; cents: number }>()
  for (const e of entries) {
    const key = [e.section, e.kind ?? '', e.org ?? '', e.block?.block.id ?? ''].join('|')
    const known = groups.get(key) ?? { group: { key, section: e.section, ...(e.kind ? { kind: e.kind } : {}), ...(e.org ? { org: e.org } : {}), ...(e.block ? { block: e.block } : {}), eur: 0, other: {}, posts: [] }, cents: 0 }
    known.group.posts.push(e.post)
    if (e.post.eur !== null) known.cents += toCents(e.post.eur)
    else known.group.other[e.post.currency] = (toCents(known.group.other[e.post.currency] ?? 0) + toCents(e.post.amount)) / 100
    groups.set(key, known)
  }
  const list = [...groups.values()].map(({ group, cents }) => {
    group.eur = cents / 100
    group.posts.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
    return group
  })
  list.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || (a.block && b.block ? a.block.number - b.block.number : 0) || Math.abs(b.eur) - Math.abs(a.eur) || a.key.localeCompare(b.key))
  const other: Partial<Record<Currency, number>> = {}
  for (const g of list) for (const [c, v] of Object.entries(g.other) as [Currency, number][]) other[c] = (toCents(other[c] ?? 0) + toCents(v)) / 100
  return { eur: list.reduce((n, g) => n + toCents(g.eur), 0) / 100, other, groups: list }
}

/** Een transactie als post: in euro zoals overal (src/model/rates.ts), met teken. */
function txPost(tx: Transaction, sign: 1 | -1, trips?: ReadonlyMap<string, Trip>, rates?: RatesFile | null): DrillPost {
  const value = rates === undefined ? eurValue(tx) : eurValue(tx, rates)
  const trip = tx.tripId ? trips?.get(tx.tripId) : undefined
  return {
    key: tx.id,
    tx,
    ...(trip ? { trip } : {}),
    date: tx.date,
    amount: sign * tx.amount,
    currency: tx.currency,
    eur: value ? sign * value.eur : null,
    provisional: value?.provisional ?? false,
  }
}

const isCost = (tx: Transaction) => !isIncome(tx.kind)
const tripMap = (trips: readonly Trip[]) => new Map(active(trips).map((x) => [x.id, x]))
const costKind = (tx: Transaction): CostCategory | 'onbekend' => expenseCategory(tx) ?? 'onbekend'

/** Inkomsten (verdiend, zonder terugbetalingen) in de periode: per soort en organisatie. Gelijk aan `totals().incomeEur`. */
export function incomeDrill(transactions: readonly Transaction[], trips: readonly Trip[], period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  return build(transactionList(transactions, period).filter((tx) => isEarned(tx.kind)).map((tx) => ({ post: txPost(tx, 1, byId), section: 'inkomsten', kind: tx.kind, org: groupOf(tx, byId) })))
}

/** Terugbetaalde onkosten in de periode, per organisatie. Gelijk aan `totals().reimbursedEur`. */
export function reimbursedDrill(transactions: readonly Transaction[], trips: readonly Trip[], period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  return build(transactionList(transactions, period).filter((tx) => tx.kind === 'terugbetaling').map((tx) => ({ post: txPost(tx, 1, byId), section: 'terugbetaald', kind: tx.kind, org: groupOf(tx, byId) })))
}

/** Uitgaven (kosten en investeringen) in de periode, per soort uitgave en organisatie, positief. Gelijk aan `totals().costsEur`. */
export function costsDrill(transactions: readonly Transaction[], trips: readonly Trip[], period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  return build(transactionList(transactions, period).filter(isCost).map((tx) => ({ post: txPost(tx, 1, byId), section: 'kosten', kind: costKind(tx), org: groupOf(tx, byId) })))
}

/**
 * Investering in de zeilcarrière in de periode: alle uitgaven van soort investering (opleiding en uitrusting, en oudere
 * investeringen zonder soort), per soort. Gelijk aan `careerInvestment`.
 */
export function investmentDrill(transactions: readonly Transaction[], trips: readonly Trip[], period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  return build(transactionList(transactions, period).filter((tx) => tx.kind === 'investering').map((tx) => ({ post: txPost(tx, 1, byId), section: 'kosten', kind: costKind(tx), org: groupOf(tx, byId) })))
}

/** Zeilgeld: resultaat in de periode: inkomsten plus terugbetalingen min uitgaven. Gelijk aan `totals().balanceEur`. */
export function resultDrill(transactions: readonly Transaction[], trips: readonly Trip[], period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  return build(
    transactionList(transactions, period).map((tx): Entry => {
      if (tx.kind === 'terugbetaling') return { post: txPost(tx, 1, byId), section: 'terugbetaald', kind: tx.kind, org: groupOf(tx, byId) }
      if (isIncome(tx.kind)) return { post: txPost(tx, 1, byId), section: 'inkomsten', kind: tx.kind, org: groupOf(tx, byId) }
      return { post: txPost(tx, -1, byId), section: 'kosten', kind: costKind(tx), org: groupOf(tx, byId) }
    }),
  )
}

/**
 * Eén organisatie (de regel "Per organisatie"): het verdiende geld (plus) en de uitgaven (min), zonder terugbetalingen,
 * zoals de regel ze toont. Inkomsten = `perOrganisation().incomeEur`, uitgaven = `costsEur`.
 */
export function organisationDrill(transactions: readonly Transaction[], trips: readonly Trip[], group: TaxGroup, period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  const entries: Entry[] = []
  for (const tx of transactionList(transactions, period)) {
    if (groupOf(tx, byId) !== group || tx.kind === 'terugbetaling') continue
    entries.push(isIncome(tx.kind) ? { post: txPost(tx, 1, byId), section: 'inkomsten', kind: tx.kind, org: group } : { post: txPost(tx, -1, byId), section: 'kosten', kind: costKind(tx), org: group })
  }
  return build(entries)
}

/** Een kolom van Kosten per maand: vaste lasten, losse kosten of samen (zonder declaraties), zoals `actualCosts`. */
export function actualCostsDrill(transactions: readonly Transaction[], trips: readonly Trip[], month: string, column: 'vast' | 'los' | 'totaal', period?: ReportPeriod): Drill {
  const byId = tripMap(trips)
  return build(
    active(transactions)
      .filter((tx) => tx.kind === 'kosten' && !tx.claimId && tx.date.startsWith(month) && (!period || (tx.date >= period.from && tx.date <= period.to)) && (column === 'totaal' || (column === 'vast') === !!tx.fixedCostId))
      .map((tx) => ({ post: txPost(tx, 1, byId), section: 'kosten', kind: costKind(tx), org: groupOf(tx, byId) })),
  )
}

/** Eén organisatie in het jaaroverzicht: het verdiende geld van dat jaar, per soort. Gelijk aan de groep in `yearOverview`. */
export function taxGroupDrill(transactions: readonly Transaction[], trips: readonly Trip[], year: number, group: TaxGroup, rates: RatesFile | null): Drill {
  const byId = tripMap(trips)
  return build(
    transactionList(transactions, { from: `${year}-01-01`, to: `${year}-12-31` })
      .filter((tx) => isEarned(tx.kind) && groupOf(tx, byId) === group)
      .map((tx) => ({ post: txPost(tx, 1, byId, rates), section: 'inkomsten', kind: tx.kind, org: group })),
  )
}

/** Te ontvangen op een dag: het salaris per organisatie en de declaraties, met het bedrag zoals Mijn positie het telt. */
export function receivableDrill(position: Position, trips: readonly Trip[], rates: RatesFile | null, sign: 1 | -1 = 1, section?: 'begin' | 'eind'): Drill {
  const byId = tripMap(trips)
  return build(receivableEntries(position, byId, rates, sign, section))
}

function receivableEntries(position: Position, byId: ReadonlyMap<string, Trip>, rates: RatesFile | null, sign: 1 | -1, section?: 'begin' | 'eind'): Entry[] {
  const entries: Entry[] = []
  for (const r of position.receivable) {
    // Zoals Mijn positie het telt: met de koers van die dag (src/model/position.ts).
    const value = toEur(r.amount, r.currency, position.date, rates)
    entries.push({
      post: { key: r.tx.id, tx: r.tx, trip: r.trip, date: position.date, amount: sign * r.amount, currency: r.currency, eur: value ? sign * value.eur : null, provisional: value?.provisional ?? false },
      section: section ?? 'salaris',
      kind: 'loon',
      org: groupOf(r.tx, byId),
    })
  }
  for (const c of position.claims) {
    const value = toEur(c.amount!, c.currency!, position.date, rates)
    entries.push({
      post: { key: c.id, claim: c, date: position.date, amount: sign * c.amount!, currency: c.currency!, eur: value ? sign * value.eur : null, provisional: value?.provisional ?? false },
      section: section ?? 'declaraties',
      kind: 'terugbetaling',
    })
  }
  return entries
}

/** Uitsplitsing van de verandering van de netto waarde: elke regel apart te openen. */
export interface ChangeDrills {
  /** Zeilresultaat ná de begindag tot en met het einde (zelfde regels als Zeilgeld: resultaat). */
  sailing: Drill
  /** Te ontvangen op het einde (plus) en op de begindag (min). */
  receivable: Drill
  /** Waardeverandering van beleggingen en bezittingen, per rekening. */
  value: Drill
  /** Verandering van de schulden, per rekening. */
  debts: Drill
  /** De verandering op de bank en contant (plus), min het zeilresultaat. */
  other: Drill
}

export function changeDrills(change: Extract<NetWorthChange, { state: 'bekend' }>, transactions: readonly Transaction[], trips: readonly Trip[], rates: RatesFile | null): ChangeDrills {
  const byId = tripMap(trips)
  const sailing = resultDrill(transactions, trips, { from: addDays(change.from, 1), to: change.to })
  const receivable = build([...receivableEntries(change.end, byId, rates, 1, 'eind'), ...receivableEntries(change.start, byId, rates, -1, 'begin')])
  const accountEntry = (a: (typeof change.accounts)[number]): Entry => ({
    post: {
      key: a.account.id,
      account: a.account,
      date: change.to,
      amount: (toCents(a.end?.balance?.amount ?? 0) - toCents(a.start?.balance?.amount ?? 0)) / 100,
      currency: a.account.currency,
      eur: a.eur,
      provisional: !!(a.start?.eur?.provisional || a.end?.eur?.provisional),
      balances: { start: a.start?.balance?.amount ?? null, end: a.end?.balance?.amount ?? null },
    },
    section: 'rekeningen',
  })
  const of = (groups: readonly string[]) => change.accounts.filter((a) => groups.includes(GROUP[a.account.kind] ?? 'bank')).map(accountEntry)
  const entries = of(['bank', 'cash'])
  entries.push({ post: { key: 'zeilresultaat', date: change.to, amount: -sailing.eur, currency: 'EUR', eur: -sailing.eur, provisional: false }, section: 'zeilresultaat' })
  return { sailing, receivable, value: build(of(['investments', 'assets'])), debts: build(of(['debts'])), other: build(entries) }
}

/** De netto waarde op een dag: de rekeningen (de laatste stand) en wat nog te ontvangen is. Gelijk aan `totals.net`. */
export function positionDrill(position: Position, trips: readonly Trip[], rates: RatesFile | null): Drill {
  const byId = tripMap(trips)
  const entries: Entry[] = []
  for (const row of [...position.bank, ...position.cashAccounts, ...position.investments, ...position.assets, ...position.debts]) {
    if (!row.balance) continue
    entries.push({
      post: { key: row.account.id, account: row.account, date: row.balance.date, amount: row.balance.amount, currency: row.account.currency, eur: row.eur?.eur ?? null, provisional: row.eur?.provisional ?? false },
      section: 'rekeningen',
    })
  }
  return build([...entries, ...receivableEntries(position, byId, rates, 1)])
}

/** Uitsplitsing van de vooruitblik: elke regel van de som apart te openen. */
export interface ForecastDrills {
  start: Drill
  salary: Drill
  tips: Drill
  scenario: Drill
  costs: Drill
  /** De eenmalige uitgaven van het scenario. */
  oneOffs: Drill
  /** Waardegroei per maand: beleggingen, bezittingen en de rente op schulden. */
  growth: Drill
}

function itemPost(item: ForecastItem, key: string): DrillPost {
  return { key, date: item.date, amount: item.eur, currency: 'EUR', eur: item.eur, provisional: false }
}

/**
 * De regels van de vooruitblik met hun posten: elke regel telt op tot het bedrag in de som (dezelfde posten als
 * `forecast`). Salaris per organisatie (elke post opent het salaris), geschatte fooi per organisatie, het scenario per
 * blok en per maand, en de kosten: vaste lasten en variabele kosten per maand, en de kosten van een scenarioblok.
 */
export function forecastDrills(f: Forecast, start: Position, trips: readonly Trip[], rates: RatesFile | null): ForecastDrills {
  const byId = tripMap(trips)
  const of = (kinds: readonly ForecastItem['kind'][]) => f.items.filter((i) => kinds.includes(i.kind))
  const salary = build(
    of(['salaris']).map((item, i) => {
      const tx = item.tx!
      return {
        post: { key: `${tx.id}:${i}`, tx, ...(item.trips[0] ? { trip: item.trips[0] } : {}), ...(item.payout ? { payout: item.payout } : {}), date: item.date, amount: tx.amount, currency: tx.currency, eur: item.eur, provisional: false },
        section: 'salaris' as const,
        kind: 'loon' as const,
        org: groupOf(tx, byId),
      }
    }),
  )
  const tips = build(
    of(['fooi']).map((item) => ({
      post: { ...itemPost(item, `fooi:${item.trips[0]?.id ?? item.date}`), ...(item.trips[0] ? { trip: item.trips[0] } : {}), estimate: true },
      section: 'inkomsten' as const,
      kind: 'fooi' as const,
      ...(item.org ? { org: item.org } : {}),
    })),
  )
  const scenario = build(
    of(['scenario']).map((item) => ({
      post: { ...itemPost(item, `${item.part!.range.block.id}:${item.part!.month}`), amount: item.part!.income, currency: item.part!.range.block.currency, provisional: item.part!.provisional, month: item.part!.month },
      section: 'scenario' as const,
      block: item.part!.range,
    })),
  )
  const costs = build(
    of(['vaste-lasten', 'kosten', 'scenario-kosten']).map((item) => {
      const kind = item.kind === 'vaste-lasten' ? ('vaste-lasten' as const) : item.kind === 'kosten' ? ('variabel' as const) : ('scenario-kosten' as const)
      const post =
        item.kind === 'scenario-kosten'
          ? { ...itemPost(item, `kosten:${item.part!.range.block.id}:${item.part!.month}`), amount: -(item.part!.costs ?? 0), currency: item.part!.range.block.currency, provisional: item.part!.provisional, month: item.part!.month }
          : { ...itemPost(item, `${kind}:${item.date}`), month: item.date.slice(0, 7), estimate: item.kind === 'kosten' }
      return { post, section: 'kosten' as const, kind }
    }),
  )
  const oneOffs = build(
    of(['eenmalig']).map((item) => ({
      post: { ...itemPost(item, `eenmalig:${item.oneOff!.id}`), amount: -item.oneOff!.amount, currency: item.oneOff!.currency, oneOffName: item.oneOff!.name },
      section: 'eenmalig' as const,
    })),
  )
  const growth = build(
    of(['groei']).map((item) => ({
      post: { ...itemPost(item, `groei:${item.growth!.group}:${item.growth!.month}`), month: item.growth!.month, growth: { opening: item.growth!.opening, rate: item.growth!.rate, contribution: item.growth!.contribution } },
      section: 'groei' as const,
      kind: item.growth!.group === 'beleggen' ? ('groei-beleggen' as const) : item.growth!.group === 'bezit' ? ('groei-bezit' as const) : ('rente-schuld' as const),
    })),
  )
  return { start: positionDrill(start, trips, rates), salary, tips, scenario, costs, oneOffs, growth }
}
