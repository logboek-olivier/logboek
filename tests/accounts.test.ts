import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { columnChoices, dateOrder, decimalSeparator, detectPreset, guessMapping, MappingIncompleteError, monthlyPoints, parseDate, parseNumber, readBalances, type ColumnMapping } from '../src/import/accounts'
import { readRowSources, type SheetRow } from '../src/import/rows'
import { balanceId, netWorth, netWorthSeries, pace, saveAccount, setBalance, writeBalances } from '../src/model/accounts'
import type { RatesFile } from '../src/model/rates'
import type { Account, Balance } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx } from './helpers/schrijf'
import { rekeningVerwijderen, standVerwijderen } from '../src/domain/geld'
import { parseStand } from '../src/basis/bedrag'

// Rekeningen en netto waarde: standen per maand, importeren uit verzonnen exports in de openbare formaten van ASN,
// Revolut, BUX en DEGIRO (nog te testen met een echte export), netto waarde, tempo. Alle bedragen en namen verzonnen.

const T = '2026-10-01T10:00:00.000Z'
const rows = (csv: string): SheetRow[] => readRowSources(new TextEncoder().encode(csv)).sheets[0]!
const cell = (text: string) => ({ text })
const account = (id: string, extra: Partial<Account> = {}): Account => ({ id, name: `Nep ${id}`, provider: 'overig', kind: 'betaal', currency: 'EUR', updatedAt: T, deletedAt: null, ...extra })
const balance = (accountId: string, date: string, amount: number): Balance => ({ id: balanceId(accountId, date), accountId, date, amount, source: 'handmatig', updatedAt: T, deletedAt: null })
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-01-02', '2026-06-01', '2026-10-01'], rates: { USD: [1.1, 1.2, 1.25] } }

let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
const newStore = async () => Store.open(await openLogboekDb(`logboek-rekeningen-${++counter}`), masterKey, new GithubClient('github_pat_ACCOUNTS_0123456789abcdefghijklmnopqrstuvw', new FakeGithub().fetch))

describe('getallen en datums uit een export', () => {
  it('bedragen in elke notatie; het decimaalteken per kolom', () => {
    expect(decimalSeparator(['1.234,56', '12,50', '-3,00'])).toBe(',')
    expect(decimalSeparator(['1,234.56', '12.50'])).toBe('.')
    expect(parseNumber(cell('1.234,56'), ',')).toBe(1234.56)
    expect(parseNumber(cell('1,234.56'), '.')).toBe(1234.56)
    expect(parseNumber(cell('-12,50'), ',')).toBe(-12.5)
    expect(parseNumber(cell('−12.50'), '.')).toBe(-12.5)
    expect(parseNumber(cell('(12.50)'), '.')).toBe(-12.5)
    expect(parseNumber(cell('12,50-'), ',')).toBe(-12.5)
    expect(parseNumber(cell('€ 1.000,00'), ',')).toBe(1000)
    expect(parseNumber(cell('+5'), '.')).toBe(5)
    expect(parseNumber(cell('nep'), '.')).toBeNull()
    expect(parseNumber({ text: '', number: 3.5 }, ',')).toBe(3.5)
    // Hele bedragen met duizendtallen (Nederlands): de komma is het decimaalteken, nooit 1000× te klein.
    expect(decimalSeparator(['1.234', '2.500', '10.000'])).toBe(',')
    expect(decimalSeparator(['1,234', '2,500'])).toBe('.')
    expect(parseNumber(cell('10.000'), decimalSeparator(['1.234', '10.000']))).toBe(10000)
    // Een notatie die niet bij de kolom past, is geen getal (melding), nooit een verkeerd getal.
    expect(parseNumber(cell('1.234,56'), '.')).toBeNull()
    expect(parseNumber(cell('1,234.56'), ',')).toBeNull()
    expect(parseNumber(cell('1.2.3'), ',')).toBeNull()
  })

  it('datums: ISO (ook met tijd), dag-maand-jaar, jjjjmmdd, Excel; ongeldig is null', () => {
    expect(parseDate(cell('2026-10-29'))).toBe('2026-10-29')
    expect(parseDate(cell('2026-10-29 14:03:22'))).toBe('2026-10-29')
    expect(parseDate(cell('2026-10-29T14:03:22Z'))).toBe('2026-10-29')
    expect(parseDate(cell('29-10-2026'))).toBe('2026-10-29')
    expect(parseDate(cell('29/10/2026 09:00'))).toBe('2026-10-29')
    expect(parseDate(cell('1.2.2026'))).toBe('2026-02-01')
    expect(parseDate(cell('20261029'))).toBe('2026-10-29')
    expect(parseDate({ text: '46324', isoDate: '2026-10-29' })).toBe('2026-10-29')
    expect(parseDate(cell('31-02-2026'))).toBeNull()
    expect(parseDate(cell('nep'))).toBeNull()
    // Een Amerikaanse export: herkend aan een tweede getal boven de 12, dan maand eerst voor de hele kolom.
    expect(dateOrder(['09/03/2026', '09/29/2026'])).toBe('mdy')
    expect(dateOrder(['29/09/2026', '03/09/2026'])).toBe('dmy')
    expect(dateOrder(['03/09/2026'])).toBe('dmy')
    expect(parseDate(cell('09/03/2026'), 'mdy')).toBe('2026-09-03')
  })

  it('een ingetypte stand: ook nul en negatief, duizendtallen en beide decimaaltekens', () => {
    expect(parseStand('1.234,56')).toBe(1234.56)
    expect(parseStand('1,234.56')).toBe(1234.56)
    expect(parseStand('1.234')).toBe(1234)
    expect(parseStand('12,5')).toBe(12.5)
    expect(parseStand('12.50')).toBe(12.5)
    expect(parseStand('-80')).toBe(-80)
    expect(parseStand('− 80,10')).toBe(-80.1)
    expect(parseStand('0')).toBe(0)
    expect(parseStand('1,234', 'en')).toBe(1234)
    expect(parseStand('1,234', 'nl')).toBe(1.23)
    expect(parseStand('')).toBeNull()
    expect(parseStand('nep')).toBeNull()
    expect(parseStand('\u20ac -80')).toBe(-80)
    expect(parseStand('-\u20ac 80')).toBe(-80)
    expect(parseStand('(80)')).toBe(-80)
    expect(parseStand('80-')).toBe(-80)
    for (const bad of ['1e5', '2-3', '1O0', '--5']) expect(parseStand(bad)).toBeNull()
  })
})

// Verzonnen exports in de opbouw van de openbare formaten.
const REVOLUT = [
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
  'TOPUP,Current,2026-08-01 09:00:00,2026-08-01 09:00:01,Nepstorting,500.00,0.00,EUR,COMPLETED,600.00',
  'CARD_PAYMENT,Current,2026-08-20 12:00:00,2026-08-21 08:00:00,Nepwinkel,-50.00,0.00,EUR,COMPLETED,550.00',
  'CARD_PAYMENT,Current,2026-08-22 12:00:00,,Nepwinkel,-20.00,0.00,EUR,PENDING,',
  'EXCHANGE,Current,2026-09-02 10:00:00,2026-09-02 10:00:00,Nepwissel,100.00,0.00,USD,COMPLETED,100.00',
  'TRANSFER,Savings,2026-09-03 10:00:00,2026-09-03 10:00:00,Nepsparen,200.00,0.00,EUR,COMPLETED,200.00',
  'CARD_PAYMENT,Current,2026-09-15 12:00:00,2026-09-15 12:00:05,"Nep, met komma",-25.50,0.00,EUR,COMPLETED,524.50',
].join('\n')

const ASN = [
  '02-09-2026,NL00NEPB0123456789,NL11NEPB9876543210,Nep Tegenpartij,,,,EUR,1000.00,EUR,-200.00,02-09-2026,02-09-2026,8810,IOB,1,,"Nepomschrijving",1',
  '15-09-2026,NL00NEPB0123456789,,Nep Werkgever,,,,EUR,800.00,EUR,1500.00,15-09-2026,15-09-2026,8810,IOB,2,,"Nepsalaris",1',
  '03-10-2026,NL00NEPB0123456789,,Nep Huur,,,,EUR,2300.00,EUR,-700.00,03-10-2026,03-10-2026,8810,IOB,3,,"Nephuur",2',
].join('\n')

const BUX = ['Transaction Time (CET),Transaction Category,Transaction Type,Asset Id,Asset Name,Asset Currency,Transaction Currency,Transaction Amount,Cash Balance Amount', '2026-07-01 10:00:00,deposits,Deposit,,,EUR,EUR,1000.00,1000.00', '2026-07-05 10:00:00,trades,Buy Trade,NEP1,Nep NV,EUR,EUR,-400.00,600.00'].join('\n')

const DEGIRO = ['Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR', 'CASH & CASH FUND (EUR),,,,EUR,"12,34","12,34"', 'NEP FONDS,NL0000000000,10,"55,10",EUR,"551,00","551,00"', 'NEP AANDEEL,US0000000000,2,"100,00",USD,"200,00","183,00"'].join('\n')

describe('exports herkennen en lezen', () => {
  it('Revolut: saldo na elke regel, alleen afgerond, in de eigen valuta en van de betaalrekening', () => {
    const r = rows(REVOLUT)
    const found = detectPreset(r, 'EUR')!
    expect(found.preset).toBe('revolut')
    const result = readBalances(r, found.mapping)
    expect(result.points).toEqual([
      { date: '2026-08-01', amount: 600 },
      { date: '2026-08-21', amount: 550 },
      { date: '2026-09-15', amount: 524.5 },
    ])
    expect(result.skipped).toBe(3)
    expect(monthlyPoints(result.points)).toEqual([
      { date: '2026-08-21', amount: 550 },
      { date: '2026-09-15', amount: 524.5 },
    ])
    // Een rekening in dollars krijgt alleen de dollarregels.
    expect(readBalances(r, detectPreset(r, 'USD')!.mapping).points).toEqual([{ date: '2026-09-02', amount: 100 }])
  })

  it('ASN: geen kopregel; saldo vóór de mutatie plus het bedrag', () => {
    const r = rows(ASN)
    const found = detectPreset(r, 'EUR')!
    expect(found.preset).toBe('asn')
    expect(readBalances(r, found.mapping).points).toEqual([
      { date: '2026-09-02', amount: 800 },
      { date: '2026-09-15', amount: 2300 },
      { date: '2026-10-03', amount: 1600 },
    ])
  })

  it('BUX: het geld op de rekening; DEGIRO: de waarde van alle posities samen op een gekozen dag', () => {
    const bux = rows(BUX)
    expect(detectPreset(bux, 'EUR')!.preset).toBe('bux')
    expect(readBalances(bux, detectPreset(bux, 'EUR')!.mapping).points.at(-1)).toEqual({ date: '2026-07-05', amount: 600 })
    const degiro = rows(DEGIRO)
    const found = detectPreset(degiro, 'EUR')!
    expect(found.preset).toBe('degiro-portefeuille')
    expect(() => readBalances(degiro, found.mapping)).toThrow(MappingIncompleteError)
    expect(readBalances(degiro, found.mapping, { onDate: '2026-10-29' }).points).toEqual([{ date: '2026-10-29', amount: 746.34 }])
  })

  it('een onbekend formaat: zelf koppelen; alleen bedragen rekent terug vanaf het saldo nu; aflopend bestand', () => {
    const csv = ['Boekdatum;Omschrijving;Bedrag', '30-09-2026;Nep;-10,00', '30-09-2026;Nep;+5,00', '01-09-2026;Nep;100,00', 'kapot;Nep;1,00', '02-08-2026;Nep;nep'].join('\n')
    const r = rows(csv)
    expect(detectPreset(r, 'EUR')).toBeNull()
    const mapping = guessMapping(r)
    expect(mapping).toMatchObject({ mode: 'bedragen', headerRow: 0, date: 0, amount: 2 })
    expect(columnChoices(r, 0).map((c) => [c.header, c.sample])).toEqual([
      ['Boekdatum', '30-09-2026'],
      ['Omschrijving', 'Nep'],
      ['Bedrag', '-10,00'],
    ])
    // Zonder het saldo nu, of zonder datumkolom: eerst kolommen kiezen.
    expect(() => readBalances(r, mapping)).toThrow(MappingIncompleteError)
    expect(() => readBalances(r, { ...mapping, date: null } satisfies ColumnMapping, { currentBalance: 1 })).toThrow(MappingIncompleteError)
    const result = readBalances(r, mapping, { currentBalance: 195 })
    // Aflopend: binnen 30 september kwam de onderste regel (+5) eerst, de bovenste (−10) daarna.
    expect(result.points).toEqual([
      { date: '2026-09-01', amount: 200 },
      { date: '2026-09-30', amount: 205 },
      { date: '2026-09-30', amount: 195 },
    ])
    // Rij en kolom van wat niet te lezen is, nooit de inhoud.
    expect(result.problems).toEqual([
      { row: 5, column: 1 },
      { row: 6, column: 3 },
    ])
    expect(result.cutOff).toBe(false)
  })

  it('alleen bedragen: een onleesbare regel; de standen daarvóór zijn niet te berekenen en gaan niet mee', () => {
    const r = rows(['Datum;Bedrag', '01-09-2026;100,00', '10-09-2026;n.v.t.', '20-09-2026;-10,00', '05-10-2026;50,00'].join('\n'))
    const result = readBalances(r, guessMapping(r), { currentBalance: 1000 })
    expect(result.points).toEqual([
      { date: '2026-09-20', amount: 950 },
      { date: '2026-10-05', amount: 1000 },
    ])
    expect(result.cutOff).toBe(true)
    expect(result.problems).toEqual([{ row: 3, column: 2 }])
  })

  it('kolommen raden: saldo vóór de mutatie met een bedrag; een gegevensregel is nooit een kopregel', () => {
    const before = rows(['Datum,Saldo voor mutatie,Bedrag', '2026-09-01,100.00,5.00'].join('\n'))
    expect(guessMapping(before)).toMatchObject({ mode: 'voor-plus-bedrag', balance: 1, amount: 2 })
    const noHeader = rows(['Tijdschrift,2026-09-01,12.50', 'Nep,2026-09-02,10.00'].join('\n'))
    expect(guessMapping(noHeader).headerRow).toBeNull()
  })
})

describe('netto waarde en tempo', () => {
  const acc = [account('bank'), account('dollar', { currency: 'USD' }), account('duo', { kind: 'schuld', provider: 'duo' }), account('oud', { closedAt: '2026-05-01' })]

  it('de laatste stand per rekening, schulden negatief, andere valuta met de koers, opgeheven telt niet', () => {
    const balances = [balance('bank', '2026-09-30', 2000), balance('bank', '2026-10-20', 2500), balance('dollar', '2026-10-01', 125), balance('duo', '2026-10-01', -10000), balance('oud', '2026-04-01', 999)]
    const now = netWorth(acc, balances, '2026-10-29', RATES)
    expect(now).toMatchObject({ eur: 2500 + 100 - 10000, counted: 3, oldest: '2026-10-01', provisional: true })
    // Zonder koersbestand: het dollarbedrag apart, niet omgerekend.
    expect(netWorth(acc, balances, '2026-10-29', null)).toMatchObject({ eur: 2500 - 10000, other: { USD: 125 } })
    // Voor de opheffing telde de oude rekening mee.
    expect(netWorth(acc, balances, '2026-04-30', RATES)).toMatchObject({ eur: 999, counted: 1 })
  })

  it('per maand met de laatste bekende stand; tempo en maanden tot positief', () => {
    const balances = [balance('bank', '2026-06-30', 1000), balance('duo', '2026-06-30', -10000), balance('bank', '2026-07-31', 2000), balance('bank', '2026-08-31', 3000), balance('bank', '2026-09-30', 4000)]
    const series = netWorthSeries(acc, balances, '2026-09-30', RATES, 4)
    expect(series.map((m) => [m.month, m.worth?.eur])).toEqual([
      ['2026-06', -9000],
      ['2026-07', -8000],
      ['2026-08', -7000],
      ['2026-09', -6000],
    ])
    // Het tempo: elke maand op dezelfde dag 1000 erbij.
    const mid = [balance('bank', '2026-06-15', 1000), balance('duo', '2026-06-15', -10000), balance('bank', '2026-07-15', 2000), balance('bank', '2026-08-15', 3000), balance('bank', '2026-09-15', 4000)]
    expect(pace(acc, mid, '2026-09-30', RATES)).toEqual({ state: 'op-weg', perMonth: 1000, months: 6 })
    // Achteruit: wordt niet positief.
    const worse = [balance('bank', '2026-08-15', 3000), balance('duo', '2026-08-15', -10000), balance('bank', '2026-09-15', 2500)]
    expect(pace(acc, worse, '2026-09-30', RATES)).toEqual({ state: 'niet', perMonth: -500 })
    // Eén maand: te weinig. Positief: positief.
    expect(pace(acc, [balance('duo', '2026-09-30', -10)], '2026-09-30', RATES)).toEqual({ state: 'te-weinig' })
    expect(pace(acc, [balance('bank', '2026-09-30', 10)], '2026-09-30', RATES)).toEqual({ state: 'positief', perMonth: null })
    // Een maand zonder nieuwe stand: de trend loopt gewoon over de standen die er zijn.
    const gap = [balance('bank', '2026-06-15', 1000), balance('duo', '2026-06-15', -10000), balance('bank', '2026-09-15', 4000)]
    expect(pace(acc, gap, '2026-09-30', RATES)).toEqual({ state: 'op-weg', perMonth: 1000, months: 6 })
    // Een net toegevoegde schuld met één stand telt mee in de netto waarde, niet in het tempo.
    const newDebt = [balance('bank', '2026-07-15', 1000), balance('bank', '2026-08-15', 2000), balance('bank', '2026-09-15', 3000), balance('duo', '2026-09-20', -15000)]
    expect(pace(acc, newDebt, '2026-09-30', RATES)).toEqual({ state: 'op-weg', perMonth: 1000, months: 12 })
    // Geld van een opgeheven spaarrekening naar de bank is geen sparen: de spaarrekening telt mee tot nul.
    const closedAcc = [account('spaar', { closedAt: '2026-09-15' }), account('bank'), account('duo', { kind: 'schuld' })]
    const moved = [balance('spaar', '2026-07-15', 5000), balance('spaar', '2026-08-15', 5000), balance('bank', '2026-07-15', 1000), balance('bank', '2026-08-15', 1000), balance('bank', '2026-09-15', 6000), balance('duo', '2026-07-15', -20000)]
    expect(pace(closedAcc, moved, '2026-09-30', RATES)).toEqual({ state: 'niet', perMonth: 0 })
    // Zonder koers voor een rekening: geen tempo, met de juiste reden.
    expect(pace(acc, [balance('dollar', '2026-08-15', 100), balance('dollar', '2026-09-15', 200), balance('duo', '2026-09-15', -500)], '2026-09-30', null)).toEqual({ state: 'geen-koers' })
    // Een koersverschil is geen sparen: dezelfde dollarstand blijft vlak.
    const dollars = [balance('dollar', '2026-05-10', 100), balance('dollar', '2026-09-10', 100), balance('duo', '2026-09-10', -500)]
    expect(pace(acc, dollars, '2026-09-30', RATES)).toEqual({ state: 'niet', perMonth: 0 })
  })
})

describe('opslaan', () => {
  it('één stand per maand; een oudere export overschrijft nooit een nieuwere stand, met de hand wint op dezelfde dag', async () => {
    const store = await newStore()
    const bank = await inTx(store, saveAccount, null, { name: 'Nepbank', provider: 'asn', kind: 'betaal', currency: 'EUR' })
    await inTx(store, writeBalances, bank, [
      { date: '2026-09-02', amount: 800 },
      { date: '2026-09-15', amount: 2300 },
      { date: '2026-10-03', amount: 1600 },
    ], 'import')
    expect(store.list('balances.json.enc').map((b) => [b.id, b.date, b.amount])).toEqual(
      expect.arrayContaining([
        [`stand:${bank.id}:2026-09`, '2026-09-15', 2300],
        [`stand:${bank.id}:2026-10`, '2026-10-03', 1600],
      ]),
    )
    // Opnieuw importeren met de juiste kolommen vervangt een stand uit een export van dezelfde dag; precies dezelfde
    // stand wordt niet opnieuw geschreven.
    expect((await inTx(store, writeBalances, bank, [{ date: '2026-09-15', amount: 2400 }], 'import')).map((b) => b.amount)).toEqual([2400])
    expect(await inTx(store, writeBalances, bank, [{ date: '2026-09-15', amount: 2400 }], 'import')).toEqual([])
    // Geen standen in de toekomst.
    expect(await inTx(store, writeBalances, bank, [{ date: '2099-01-01', amount: 1 }], 'import')).toEqual([])
    expect(await inTx(store, setBalance, bank, '2099-01-01', 1)).toBeNull()
    expect(await inTx(store, setBalance, bank, '2026-10-20', 1750)).toMatchObject({ amount: 1750, source: 'handmatig' })
    // Een export van dezelfde dag vervangt een stand met de hand niet.
    expect(await inTx(store, writeBalances, bank, [{ date: '2026-10-20', amount: 1 }], 'import')).toEqual([])
    // Een oude export (3 oktober) laat de stand van 20 oktober staan; een stand met de hand van eerder ook.
    expect(await inTx(store, writeBalances, bank, [{ date: '2026-10-03', amount: 1600 }], 'import')).toEqual([])
    expect(await inTx(store, setBalance, bank, '2026-10-10', 1)).toBeNull()
    expect(await inTx(store, setBalance, bank, '2026-10-20', 1800)).toMatchObject({ amount: 1800 })
    // Precies dezelfde stand nog eens: opgeslagen (niet "er staat al een nieuwere stand").
    expect(await inTx(store, setBalance, bank, '2026-10-20', 1800)).toMatchObject({ amount: 1800 })
    expect(store.list('balances.json.enc').filter((b) => b.date.startsWith('2026-10')).map((b) => b.amount)).toEqual([1800])
  })

  it('een schuld is altijd negatief; van soort wisselen draait de standen mee, ook terug', async () => {
    const store = await newStore()
    const duo = await inTx(store, saveAccount, null, { name: 'Nepschuld', provider: 'duo', kind: 'schuld', currency: 'EUR' })
    await inTx(store, setBalance, duo, '2026-10-01', 9876.5)
    expect(store.list('balances.json.enc')[0]!.amount).toBe(-9876.5)
    // Per ongeluk Schuld gekozen, daarna Spaar: wat Olivier typte komt terug.
    await inTx(store, saveAccount, duo.id, { name: 'Nepschuld', provider: 'duo', kind: 'spaar', currency: 'EUR' })
    expect(store.list('balances.json.enc')[0]!.amount).toBe(9876.5)
    const asDebt = await inTx(store, saveAccount, duo.id, { name: 'Nepschuld', provider: 'duo', kind: 'schuld', currency: 'EUR' })
    expect(asDebt.kind).toBe('schuld')
    expect(store.list('balances.json.enc')[0]!.amount).toBe(-9876.5)
  })

  it('verwijderen: tombstones zonder naam en zonder bedrag; ongedaan maken zet alles terug', async () => {
    const store = await newStore()
    const bank = await inTx(store, saveAccount, null, { name: 'Nepbank', provider: 'asn', kind: 'betaal', currency: 'EUR', note: 'Nepnotitie' })
    await inTx(store, setBalance, bank, '2026-09-30', 1234.56)
    await inTx(store, setBalance, bank, '2026-10-20', 1500)
    const undoBalance = await standVerwijderen(store, store.list('balances.json.enc').find((b) => b.amount === 1500)!)
    expect(store.get('balances.json.enc').find((b) => b.deletedAt !== null)).toMatchObject({ amount: 0 })
    await undoBalance()
    expect(store.list('balances.json.enc')).toHaveLength(2)
    const undo = await rekeningVerwijderen(store, bank)
    expect(store.list('accounts.json.enc')).toEqual([])
    expect(store.list('balances.json.enc')).toEqual([])
    expect(store.get('accounts.json.enc')[0]).toMatchObject({ name: '', deletedAt: expect.any(String) })
    expect(JSON.stringify(store.get('accounts.json.enc'))).not.toContain('Nep')
    expect(store.get('balances.json.enc').every((b) => b.amount === 0)).toBe(true)
    await undo()
    expect(store.list('accounts.json.enc')[0]).toMatchObject({ name: 'Nepbank', note: 'Nepnotitie' })
    expect(store.list('balances.json.enc').map((b) => b.amount).sort()).toEqual([1234.56, 1500])
  })
})
