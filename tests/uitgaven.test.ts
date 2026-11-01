import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { careerInvestment, expenseCategory, expenseTargets, kindForCategory, resolveTarget, sourceOnSave, targetKey } from '../src/model/expenses'
import { allPeriods } from '../src/model/periods'
import { reviewInput, reviewItems } from '../src/model/review'
import type { StayPeriod, Transaction, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put } from './helpers/schrijf'
import { landperiodeZetten } from '../src/domain/agenda'
import { geldBewerken } from '../src/domain/geld'
import { investeringssoortZetten } from '../src/domain/trips'

// PR 2 van het periodemodel: uitgaven hangen logisch aan een periode ("Hoort bij"), met een soort (reizen, eten en
// drinken, verblijf, opleiding, uitrusting, overig); opleiding en uitrusting zijn een investering in de zeilcarrière.
// Alle gegevens verzonnen.

const T = '2026-10-01T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store() {
  const db = await openLogboekDb(`logboek-uitgaven-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_UITGAVEN_0123456789abcdefghijklmnop', new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Neptrip ${id}`, updatedAt: T, deletedAt: null, ...extra })
const stay = (id: string, kind: StayPeriod['kind'], startDate: string, endDate: string): StayPeriod => ({ id, kind, startDate, endDate, updatedAt: T, deletedAt: null })
const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, date: '2026-11-01', kind: 'kosten', amount: 10, currency: 'EUR', source: 'overig', updatedAt: T, deletedAt: null, ...extra })

const sv3 = trip('sv3', { name: 'SV #3', type: 'training-geven', organisation: 'sailing-virgins', startDate: '2026-11-08', endDate: '2026-11-14' })
const periods = allPeriods([sv3], [], [stay('thuis', 'thuis', '2026-11-01', '2026-11-06'), stay('reis', 'reis', '2026-11-07', '2026-11-07'), stay('terug', 'reis', '2026-11-15', '2026-11-15')])

describe('Hoort bij', () => {
  it('standaard de periode van de datum, met de periodes ervoor en erna als keuze', () => {
    const { options, fallback } = expenseTargets(periods, '2026-11-03', 'eten')
    expect(targetKey(fallback)).toBe('thuis')
    expect(options.map(targetKey)).toEqual(['thuis', 'reis'])
    const mid = expenseTargets(periods, '2026-11-10', 'eten')
    expect(mid.options.map(targetKey)).toEqual(['reis', 'sv3', 'terug'])
    expect(targetKey(mid.fallback)).toBe('sv3')
  })

  it('een vlucht op een reisdag hoort bij de werkweek erna (of ervoor op de terugreis); eten op die dag bij de reis', () => {
    expect(targetKey(expenseTargets(periods, '2026-11-07', 'vervoer').fallback)).toBe('sv3')
    expect(targetKey(expenseTargets(periods, '2026-11-15', 'vervoer').fallback)).toBe('sv3')
    expect(targetKey(expenseTargets(periods, '2026-11-07', 'eten').fallback)).toBe('reis')
  })

  it('een dag zonder periode: een nieuwe periode thuis (tussen twee trips: vrij)', () => {
    const lone = expenseTargets(periods, '2026-12-20', 'overig')
    expect(targetKey(lone.fallback)).toBe('nieuw:thuis')
    const two = allPeriods([trip('a', { startDate: '2026-12-01', endDate: '2026-12-05' }), trip('b', { startDate: '2026-12-08', endDate: '2026-12-12' })], [], [])
    expect(targetKey(expenseTargets(two, '2026-12-06', 'eten').fallback)).toBe('nieuw:vrij')
  })

  it('opslaan op een dag zonder periode maakt eerst de periode (een aangrenzende thuisperiode wordt langer)', async () => {
    const s = await store()
    await landperiodeZetten(s, ['2026-12-01', '2026-12-02'], 'thuis')
    const id = await inTx(s, resolveTarget, { kind: 'nieuw', stayKind: 'thuis' }, '2026-12-03')
    const live = s.list('periods.json.enc')
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ id, startDate: '2026-12-01', endDate: '2026-12-03' })
  })
})

describe('soort en bron', () => {
  it('opleiding en uitrusting zijn een investering; de rest kosten', () => {
    expect(kindForCategory('opleiding')).toBe('investering')
    expect(kindForCategory('uitrusting')).toBe('investering')
    expect(kindForCategory('vervoer')).toBe('kosten')
    expect(kindForCategory('verblijf')).toBe('kosten')
    expect(expenseCategory({ kind: 'investering' })).toBeNull()
    expect(expenseCategory({ kind: 'kosten' })).toBe('overig')
    expect(expenseCategory({ kind: 'investering', category: 'uitrusting' })).toBe('uitrusting')
  })

  it('de bron volgt uit de organisatie van de trip; zonder organisatie blijft de oude bron', () => {
    expect(sourceOnSave(sv3, 'overig')).toBe('sailing-virgins')
    expect(sourceOnSave(trip('x', { type: 'delivery' }), 'overig')).toBe('delivery')
    expect(sourceOnSave(undefined, 'yacht-week')).toBe('yacht-week')
  })

  it('investering in de zeilcarrière: alle opleiding en uitrusting in de periode', () => {
    const list = [tx('a', { kind: 'investering', category: 'opleiding', amount: 450 }), tx('b', { kind: 'investering', category: 'uitrusting', amount: 120, date: '2027-01-02' }), tx('c', { amount: 30 })]
    expect(careerInvestment(list, (x) => x.amount).eur).toBe(570)
    expect(careerInvestment(list, (x) => x.amount, '2026-01-01', '2026-12-31')).toMatchObject({ eur: 450, count: 1 })
  })

  it('bewerken: de soort blijft bij een investering (eerst rood: werd gewist)', async () => {
    const s = await store()
    await put(s, 'transactions.json.enc', tx('i', { kind: 'investering', category: 'opleiding' }))
    await geldBewerken(s, s.list('transactions.json.enc')[0]!, { date: '2026-11-01', kind: 'investering', amount: 12, currency: 'EUR', source: 'overig', category: 'uitrusting' })
    expect(s.list('transactions.json.enc')[0]).toMatchObject({ kind: 'investering', category: 'uitrusting', amount: 12 })
  })

  it('een investering van vóór het periodemodel staat in Nakijken: opleiding of uitrusting met één tik', async () => {
    const s = await store()
    await put(s, 'transactions.json.enc', tx('oud', { kind: 'investering', note: 'Nepcursus' }))
    const item = reviewItems(reviewInput(s)).find((i) => i.kind === 'investering-soort')
    expect(item).toBeDefined()
    if (item?.kind !== 'investering-soort') throw new Error('verwacht')
    await investeringssoortZetten(s, item.tx, 'opleiding')
    expect(s.list('transactions.json.enc')[0]!.category).toBe('opleiding')
    expect(reviewItems(reviewInput(s)).some((i) => i.kind === 'investering-soort')).toBe(false)
  })
})

describe('punten uit de review', () => {
  it('een nieuw inkomen krijgt nooit een eerder gekozen bron: de organisatie uit de naam, anders overig', async () => {
    const { sourceForPeriod } = await import('../src/basis/organisatie')
    expect(sourceForPeriod(trip('y', { name: 'Yacht week 7' }))).toBe('yacht-week')
    expect(sourceForPeriod(trip('e', { name: 'Nep eigen charter', type: 'skipper-charter' }))).toBe('overig')
    expect(sourceForPeriod(undefined)).toBe('overig')
  })

  it('een trip die zijn dagen volgt: de ochtend na de laatste gelogde dag hoort de uitgave nog bij de trip', () => {
    const run = allPeriods([trip('run', { startDate: '2026-11-01', endDate: '2026-11-03', datesFromDays: true })], [], [])
    expect(targetKey(expenseTargets(run, '2026-11-04', 'eten').fallback)).toBe('run')
    expect(targetKey(expenseTargets(run, '2026-11-08', 'eten').fallback)).toBe('nieuw:thuis')
  })

  it('wisseldag: beide trips staan als keuze; een dag met een dagtoestand krijgt niet vanzelf een nieuwe periode', () => {
    const two = allPeriods([trip('a', { startDate: '2026-11-01', endDate: '2026-11-07' }), trip('b', { startDate: '2026-11-07', endDate: '2026-11-14' })], [], [])
    expect(expenseTargets(two, '2026-11-07', 'eten').options.map(targetKey)).toEqual(['a', 'b'])
    expect(targetKey(expenseTargets(periods, '2026-11-20', 'eten', true).fallback)).toBe('terug')
  })
})
