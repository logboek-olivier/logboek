import { describe, expect, it } from 'vitest'
import { careerStart, DEFAULT_CAREER_START, difference, forecast, payoutMoment, positionAt, type PositionInput } from '../src/model/position'
import type { RatesFile } from '../src/model/rates'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Account, Balance, Settings, Transaction, Trip } from '../src/model/types'

// Ronde 3 · PR 4: Mijn positie en de vooruitblik. Op de bank, contant (zonder dubbel tellen met een kasrekening), te
// ontvangen, beleggingen, studieschuld en de netto waarde; sinds het begin van de zeilcarrière; de vooruitblik telt
// verwacht salaris op het uitbetaalmoment en een geschatte fooi op, en telt te ontvangen niet twee keer. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-10-30'
const RATES: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-09-01'], rates: { USD: [1.25] } }

const account = (id: string, kind: Account['kind'], extra: Partial<Account> = {}): Account => ({ id, name: `Nep ${id}`, provider: 'overig', kind, currency: 'EUR', updatedAt: T0, deletedAt: null, ...extra })
const balance = (accountId: string, date: string, amount: number): Balance => ({ id: `stand:${accountId}:${date.slice(0, 7)}`, accountId, date, amount, source: 'handmatig', updatedAt: T0, deletedAt: null })
const trip = (id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, startDate, endDate, organisation: 'sailing-virgins', updatedAt: T0, deletedAt: null, ...extra })
const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ id, date: '2026-10-10', kind: 'fooi', amount: 10, currency: 'EUR', source: 'sailing-virgins', updatedAt: T0, deletedAt: null, ...extra })
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra })
const input = (extra: Partial<PositionInput>): PositionInput => ({ accounts: [], balances: [], trips: [], legs: [], transactions: [], rates: RATES, ...extra })

describe('Mijn positie', () => {
  it('op de bank, contant, te ontvangen, beleggingen en studieschuld, met de netto waarde', () => {
    const p = positionAt(
      input({
        accounts: [account('asn', 'betaal'), account('spaar', 'spaar'), account('bux', 'beleggen', { currency: 'USD' }), account('duo', 'schuld', { provider: 'duo' })],
        balances: [balance('asn', '2026-10-20', 1500), balance('spaar', '2026-10-01', 2000), balance('bux', '2026-10-15', 500), balance('duo', '2026-10-01', -12000)],
        trips: [trip('voorbij', '2026-10-01', '2026-10-07', { salary: { amount: 1100, currency: 'EUR', status: 'verwacht', source: 'standaard' } }), trip('straks', '2026-11-01', '2026-11-07', { salary: { amount: 1100, currency: 'EUR', status: 'verwacht', source: 'standaard' } })],
        transactions: [tx('c', { tipVia: 'contant', amount: 60 }), tx('g', { tipVia: 'contant', amount: 40, depositedAt: '2026-10-20' }), tx('b', { tipVia: 'bank', amount: 30 })],
      }),
      TODAY,
    )
    expect(p.totals.bank.eur).toBe(3500)
    expect(p.totals.cash.eur).toBe(60)
    expect(p.receivable.map((r) => r.trip.id)).toEqual(['voorbij'])
    expect(p.totals.receivable.eur).toBe(1100)
    expect(p.totals.investments.eur).toBe(400)
    expect(p.totals.debts.eur).toBe(-12000)
    expect(p.totals.net.eur).toBe(3500 + 60 + 1100 + 400 - 12000)
  })

  it('een kasrekening telt de contante fooien tot haar stand al mee; latere fooien komen erbij', () => {
    const p = positionAt(input({ accounts: [account('kas', 'contant')], balances: [balance('kas', '2026-10-15', 200)], transactions: [tx('voor', { tipVia: 'contant', date: '2026-10-10', amount: 50 }), tx('na', { tipVia: 'contant', date: '2026-10-20', amount: 30 })] }), TODAY)
    expect(p.totals.cash.eur).toBe(230)
    expect(p.cashTips).toEqual({ EUR: 30 })
  })

  it('te ontvangen op een eerdere dag: salaris dat pas later betaald werd, telt dan nog als te ontvangen', () => {
    const paid = trip('t', '2026-09-01', '2026-09-07', { salary: { amount: 1000, currency: 'EUR', status: 'ontvangen', source: 'eigen', transactionId: 'loon' } })
    const data = input({ trips: [paid], transactions: [tx('loon', { kind: 'loon', date: '2026-10-05', amount: 1000 })] })
    expect(positionAt(data, '2026-09-30').totals.receivable.eur).toBe(1000)
    expect(positionAt(data, '2026-10-05').totals.receivable.eur).toBe(0)
  })

  it('sinds het begin van de zeilcarrière: zonder stand op die dag telt de eerste stand daarna', () => {
    const data = input({ accounts: [account('asn', 'betaal')], balances: [balance('asn', '2026-09-20', 1000), balance('asn', '2026-10-20', 2500)] })
    const start = careerStart(settings())
    expect(start).toBe(DEFAULT_CAREER_START)
    expect(difference(positionAt(data, TODAY).totals.net, positionAt(data, start, true).totals.net)).toBe(1500)
    expect(careerStart(settings({ careerStart: '2026-10-01' }))).toBe('2026-10-01')
    // Iets zonder koers: geen verschil (niet te zeggen).
    expect(difference({ eur: 1, provisional: false, other: { GBP: 1 } }, { eur: 0, provisional: false, other: {} })).toBeNull()
  })
})

describe('vooruitblik', () => {
  it('uitbetaalmoment: na de trip, of maandelijks rond dag N in de maand erna', () => {
    const x = trip('t', '2026-11-20', '2026-11-26')
    expect(payoutMoment(x, [], settings())).toBe('2026-11-26')
    expect(payoutMoment(x, [], settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } }))).toBe('2026-12-05')
    expect(payoutMoment(trip('d', '2026-12-20', '2026-12-27'), [], settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } }))).toBe('2027-01-05')
  })

  it('verwacht salaris van komende trips en een geschatte fooi; te ontvangen telt niet nog eens', () => {
    const salary = { amount: 1000, currency: 'EUR' as const, status: 'verwacht' as const, source: 'standaard' as const }
    const data = input({
      accounts: [account('asn', 'betaal')],
      balances: [balance('asn', '2026-10-20', 500)],
      trips: [
        trip('voorbij', '2026-09-01', '2026-09-07', { salary }),
        trip('lopend', '2026-10-27', '2026-11-02', { salary }),
        trip('dec', '2026-12-01', '2026-12-07', { salary }),
      ],
      // Fooi van de voorbije trip (voor het gemiddelde) en al 20 binnen op de lopende trip.
      transactions: [tx('f1', { tripId: 'voorbij', amount: 100, tipVia: 'bank' }), tx('f2', { tripId: 'lopend', amount: 20, tipVia: 'bank', date: '2026-10-29' })],
    })
    const f = forecast(data, settings({ payouts: { 'sailing-virgins': { kind: 'maandelijks', day: 5 } } }), TODAY)
    expect(f.now.eur).toBe(500 + 1000)
    expect(f.items.map((i) => [i.kind, i.date, i.eur])).toEqual([
      ['fooi', '2026-11-02', 80],
      ['salaris', '2026-12-05', 1000],
      ['fooi', '2026-12-07', 100],
      ['salaris', '2027-01-05', 1000],
    ])
    expect(f.addsEur).toBe(2180)
    expect(f.tipEstimateEur).toBe(180)
    expect(f.endEur).toBe(1500 + 2180)
    expect(f.until).toBe('2027-01')
    // Gemeten tot en met nu, daarna verwacht; de laatste maand is het einde.
    expect(f.months.filter((m) => !m.future).at(-1)).toEqual({ month: '2026-10', eur: 1500, future: false })
    expect(f.months.at(-1)).toEqual({ month: '2027-01', eur: 3680, future: true })
  })
})
