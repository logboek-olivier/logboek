import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { canFix, fixedAt, gezondheidHerstellen } from '../src/domain/gezondheid'
import { violations } from '../src/domain/invariants'
import { declaratieKoppelen, declaratieVerwijderen, vasteLastVerwijderen } from '../src/domain/geld'
import { planningCursusZetten, planningKoppelen, studentCursusZetten, studentenWissen } from '../src/domain/training'
import { periodeVerwijderen } from '../src/domain/trips'
import { addClaim, claimsToShow, markRepaid } from '../src/model/claims'
import { bookingsOf } from '../src/model/costs'
import { DEFAULT_SETTINGS, lastUsedId, saveSettings } from '../src/model/settings'
import { buildIndex } from '../src/model/calendar'
import { expectedPayout } from '../src/model/money-path'
import { eurValue, type RatesFile } from '../src/model/rates'
import { tipAverages } from '../src/model/salary'
import { moneyStats } from '../src/model/stats'
import { trashItems } from '../src/model/trash'
import { LEGACY_ORGS, setOrganisations } from '../src/basis/organisatie'
import { reviewInput, reviewItems } from '../src/model/review'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import type { FixedCost, Scenario, Settings, Student, Transaction, Trip, WeekPlan } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, putMany } from './helpers/schrijf'

// Review G-5, W-5 (docs/review.md): verwijzingen die niemand controleerde. Een vaste last verwijderen met geboekte
// maanden geeft dezelfde keuze als bij een periode; een planning, declaratie of student die naar iets wijst dat weg is,
// staat in Nakijken (en Gezondheid verwijst daarheen); het actieve scenario wordt gecontroleerd. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-koppelingen-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_KOPPELING_0123456789abcdefghijklmnopqrstuvwx', new FakeGithub().fetch))
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nepweek ${id}`, kind: 'werk', type: 'training-geven', organisation: 'sailing-virgins', startDate: '2026-10-01', endDate: '2026-10-07', updatedAt: T0, deletedAt: null, ...extra })
const booking = (id: string, date: string, fixedCostId: string): Transaction => ({ id, date, kind: 'kosten', amount: 20, currency: 'EUR', source: 'overig', fixedCostId, note: 'Nephuur', updatedAt: T0, deletedAt: null })
const asa101 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-101')!

describe('vaste last verwijderen: dezelfde keuze als bij een periode (G-5)', () => {
  const cost: FixedCost = { id: 'f1', name: 'Nephuur', currency: 'EUR', amounts: [{ from: '2026-08', amount: 20 }], updatedAt: T0, deletedAt: null }

  it('behouden: de geboekte maanden blijven als gewone uitgave en tellen niet meer als vast; ongedaan maken zet alles terug', async () => {
    const s = await store()
    await put(s, 'fixedcosts.json.enc', cost)
    await putMany(s, 'transactions.json.enc', [booking('b1', '2026-08-31', 'f1'), booking('b2', '2026-09-30', 'f1')])
    expect(bookingsOf(s.list('transactions.json.enc'), 'f1').map((b) => b.id)).toEqual(['b2', 'b1'])
    const undo = await vasteLastVerwijderen(s, cost, 'behouden')
    expect(s.list('fixedcosts.json.enc')).toEqual([])
    const left = s.list('transactions.json.enc')
    expect(left).toHaveLength(2)
    expect(left.every((tx) => tx.fixedCostId === undefined && tx.amount === 20 && tx.kind === 'kosten')).toBe(true)
    expect(bookingsOf(left, 'f1')).toEqual([])
    await undo()
    expect(s.list('fixedcosts.json.enc')[0]).toMatchObject({ id: 'f1', name: 'Nephuur' })
    expect(s.list('transactions.json.enc').every((tx) => tx.fixedCostId === 'f1')).toBe(true)
  })

  it('alles: de geboekte maanden gaan mee naar de prullenbak; zonder boekingen is verwijderen één tik', async () => {
    const s = await store()
    await put(s, 'fixedcosts.json.enc', cost)
    await put(s, 'transactions.json.enc', booking('b1', '2026-08-31', 'f1'))
    const undo = await vasteLastVerwijderen(s, cost, 'alles')
    expect(s.list('transactions.json.enc')).toEqual([])
    expect(s.get('transactions.json.enc')[0]).toMatchObject({ id: 'b1', deletedAt: expect.any(String) })
    await undo()
    expect(s.list('transactions.json.enc')).toHaveLength(1)
    // Standaard (zonder keuze) is behouden: niets verdwijnt stil.
    await vasteLastVerwijderen(s, cost)
    expect(s.list('transactions.json.enc')[0]!.fixedCostId).toBeUndefined()
  })
})

describe('verwijzingen die weg zijn: Nakijken en Gezondheid (G-5, W-5)', () => {
  const plan = (id: string, tripId: string | undefined, startDate = '2026-10-01'): WeekPlan => ({ id, title: 'Nepplanning', startDate, dayCount: 5, ...(tripId ? { tripId } : {}), groups: [], days: [], updatedAt: T0, deletedAt: null })
  const student = (id: string, extra: Partial<Student> = {}): Student => ({ id, firstName: 'Nep', curriculumId: asa101.id, level: 'beginner', progress: {}, archivedAt: null, updatedAt: T0, deletedAt: null, ...extra })

  it('planning en declaratie bij een trip die met "behouden" weg ging: nakijken, koppelen aan de trip van de datum of losmaken', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('weg'), trip('ander', { startDate: '2026-10-08', endDate: '2026-10-14' })])
    await put(s, 'plans.json.enc', plan('p1', 'weg', '2026-10-09'))
    const claim = await inTx(s, addClaim, { date: '2026-10-03', tripId: 'weg', note: 'Nepdiesel', amount: 42.5, currency: 'EUR' }, null)
    await inTx(s, markRepaid, claim, { date: '2026-10-05', amount: 42.5, currency: 'EUR' })
    expect(violations(s)).toEqual([])
    await periodeVerwijderen(s, s.list('trips.json.enc').find((t) => t.id === 'weg')!, 'behouden')

    const rules = violations(s).map((v) => v.rule)
    expect(rules).toContain('planning-zonder-trip')
    expect(rules).toContain('declaratie-zonder-trip')
    for (const v of violations(s)) {
      expect(canFix(v)).toBe(false)
      expect(fixedAt(v)).toBe('nakijken')
    }
    // Een terugbetaalde declaratie van een verwijderde trip blijft zichtbaar onder Geld → Declaraties.
    expect(claimsToShow(s.list('claims.json.enc'), new Set(['ander']))).toHaveLength(1)
    expect(claimsToShow(s.list('claims.json.enc'), new Set(['ander', 'weg']))).toHaveLength(0)

    const items = reviewItems(reviewInput(s))
    const planItem = items.find((i) => i.kind === 'planning-zonder-trip')
    const claimItem = items.find((i) => i.kind === 'declaratie-zonder-trip')
    if (planItem?.kind !== 'planning-zonder-trip' || claimItem?.kind !== 'declaratie-zonder-trip') throw new Error('verwacht')
    expect(planItem).toMatchObject({ tripName: 'Nepweek weg', target: { id: 'ander' } })
    expect(claimItem).toMatchObject({ tripName: 'Nepweek weg', target: null })

    const undoPlan = await planningKoppelen(s, planItem.plan, 'ander')
    expect(s.list('plans.json.enc')[0]!.tripId).toBe('ander')
    await undoPlan()
    expect(s.list('plans.json.enc')[0]!.tripId).toBe('weg')
    await planningKoppelen(s, planItem.plan, null)
    expect(s.list('plans.json.enc')[0]!.tripId).toBeUndefined()

    await declaratieKoppelen(s, claimItem.claim, null)
    const after = s.list('claims.json.enc')[0]!
    expect(after.tripId).toBeUndefined()
    expect(after).toMatchObject({ status: 'terugbetaald', amount: 42.5, note: 'Nepdiesel' })
    // De uitgave van de declaratie volgt de declaratie.
    expect(s.list('transactions.json.enc').find((tx) => tx.claimId === after.id && tx.kind === 'kosten')?.tripId).toBeUndefined()
    expect(reviewItems(reviewInput(s)).map((i) => i.kind)).not.toEqual(expect.arrayContaining(['planning-zonder-trip', 'declaratie-zonder-trip']))
    expect(violations(s)).toEqual([])
  })

  it('student met een cursus die niet meer bestaat: de cursussen van zijn trip eerst; de deelnemer krijgt dezelfde cursus', async () => {
    const s = await store()
    const asa103 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-103')!
    await put(s, 'trips.json.enc', trip('t', { participants: [{ id: 's1', firstName: 'Nep', curriculumId: 'eigen-weg' }, { id: 's2', firstName: 'Nepper', curriculumId: asa103.id }] }))
    await putMany(s, 'students.json.enc', [student('s1', { curriculumId: 'eigen-weg', weekId: 't' }), student('s2', { curriculumId: asa103.id, weekId: 't' })])
    expect(violations(s).map((v) => v.rule)).toEqual(['student-zonder-cursus'])
    expect(fixedAt(violations(s)[0]!)).toBe('nakijken')
    const item = reviewItems(reviewInput(s)).find((i) => i.kind === 'student-zonder-cursus')
    if (item?.kind !== 'student-zonder-cursus') throw new Error('verwacht')
    expect(item.choices[0]!.id).toBe(asa103.id)
    expect(item.choices.length).toBe(SEED_CURRICULA.length)
    const undo = await studentCursusZetten(s, item.student, asa101.id)
    expect(s.list('students.json.enc').find((x) => x.id === 's1')!.curriculumId).toBe(asa101.id)
    expect(s.list('trips.json.enc')[0]!.participants!.find((p) => p.id === 's1')!.curriculumId).toBe(asa101.id)
    expect(violations(s)).toEqual([])
    await undo()
    expect(s.list('students.json.enc').find((x) => x.id === 's1')!.curriculumId).toBe('eigen-weg')
    // Een gearchiveerde student telt niet.
    await put(s, 'students.json.enc', { ...s.list('students.json.enc').find((x) => x.id === 's1')!, archivedAt: T0 })
    expect(violations(s)).toEqual([])
  })

  it('het actieve scenario bestaat niet meer: Gezondheid lost het met één tik op', async () => {
    const s = await store()
    const sc: Scenario = { id: 'sc1', name: 'Nepscenario', blocks: [], updatedAt: T0, deletedAt: null }
    await put(s, 'scenarios.json.enc', sc)
    await put(s, 'settings.json.enc', { ...DEFAULT_SETTINGS, id: 'settings', activeScenarioId: 'sc1', updatedAt: T0, deletedAt: null })
    expect(violations(s)).toEqual([])
    await put(s, 'scenarios.json.enc', { ...sc, deletedAt: T0 })
    const v = violations(s)
    expect(v.map((x) => x.rule)).toEqual(['scenario-weg'])
    expect(canFix(v[0]!)).toBe(true)
    await gezondheidHerstellen(s, v[0]!)
    expect(violations(s)).toEqual([])
    expect(s.list('settings.json.enc').find((r) => r.id === 'settings')!.activeScenarioId).toBeUndefined()
  })

  it('Gezondheid verwijst voor salaris zonder bedrag en meerdere salarissen naar Geld → Te controleren', () => {
    const v = (rule: 'salaris-zonder-bedrag' | 'meerdere-salarissen' | 'datum') => ({ rule, path: 'transactions.json.enc' as const, id: 'x', key: `${rule}:x`, severity: 'nakijken' as const })
    expect(fixedAt(v('salaris-zonder-bedrag'))).toBe('geld')
    expect(fixedAt(v('meerdere-salarissen'))).toBe('geld')
    expect(fixedAt(v('datum'))).toBeNull()
  })
})

// Nacontrole door een review-agent na #137 (docs/review.md, "Nacontrole"): wat die vond, vastgezet.
describe('nacontrole: dezelfde omrekening en organisatie, niets stil kwijt, onbekende velden blijven', () => {
  const RATES: RatesFile = { format: 'logboek-rates', source: 'test', dates: ['2026-10-01', '2026-10-07', '2026-11-05'], rates: { USD: [1.1, 1.2, 1.5] } }
  const salary = (tripId: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id: `salaris:${tripId}`, date, kind: 'loon', amount: 1000, currency: 'USD', source: 'sailing-virgins', tripId, status: 'verwacht', updatedAt: T0, deletedAt: null, ...extra })

  it('het verwachte bedrag van een uitbetaling gebruikt dezelfde waarde als de tripkaart (eurValue, niet de koers van vandaag)', () => {
    const trips = [trip('a', { startDate: '2026-10-01', endDate: '2026-10-07' })]
    // Werkelijk ontvangen of opgeslagen euro's winnen van elke koers; anders de koers van de datum van het salaris.
    expect(expectedPayout(trips, [salary('a', '2026-10-07', { receivedEur: 900 })], 'EUR', '2026-11-05', RATES)).toBe(900)
    expect(expectedPayout(trips, [salary('a', '2026-10-07', { amountEur: 850, rate: 1.1765, rateDate: '2026-10-07' })], 'EUR', '2026-11-05', RATES)).toBe(850)
    expect(expectedPayout(trips, [salary('a', '2026-10-07')], 'EUR', '2026-11-05', RATES)).toBe(833.33)
    expect(eurValue(salary('a', '2026-10-07'), RATES)?.eur).toBe(833.33)
  })

  it('Statistieken: geld van een trip in de prullenbak blijft bij zijn organisatie, zoals in Geld', () => {
    const gone = trip('weg', { organisation: 'org:nep', deletedAt: T0 })
    const tx: Transaction = { id: 'f', date: '2026-10-03', kind: 'fooi', amount: 100, currency: 'EUR', source: 'overig', tripId: 'weg', updatedAt: T0, deletedAt: null }
    const stats = moneyStats([gone], [], [tx], buildIndex([], [gone], []), { from: '2026-01-01', to: '2026-12-31' }, '2026-11-01')
    expect(stats.perOrganisation).toEqual([{ org: 'org:nep', eur: 100 }])
    expect(stats.perTrip).toEqual([])
  })

  it('de fooischatting groepeert op de organisatie van de trip, ook uit de naam', () => {
    setOrganisations(LEGACY_ORGS)
    const named = trip('n', { organisation: undefined, name: 'Yacht week 7', startDate: '2026-09-01', endDate: '2026-09-07' })
    const tip: Transaction = { id: 't', date: '2026-09-05', kind: 'fooi', amount: 300, currency: 'EUR', source: 'overig', tripId: 'n', updatedAt: T0, deletedAt: null }
    expect(tipAverages([named], [], [tip], '2026-11-01')).toEqual({ 'yacht-week': 300 })
  })

  it('de terugbetaling van een verwijderde declaratie is weer gewoon geld: zonder periode in Nakijken en Gezondheid', async () => {
    const s = await store()
    await putMany(s, 'trips.json.enc', [trip('weg')])
    const claim = await inTx(s, addClaim, { date: '2026-10-03', tripId: 'weg', note: 'Nepdiesel', amount: 42.5, currency: 'EUR' }, null)
    await inTx(s, markRepaid, claim, { date: '2026-10-05', amount: 42.5, currency: 'EUR' })
    await declaratieVerwijderen(s, claim)
    expect(violations(s)).toEqual([])
    await periodeVerwijderen(s, s.list('trips.json.enc')[0]!, 'behouden')
    expect(violations(s).map((v) => v.rule)).toEqual(['geld-zonder-periode'])
    expect(reviewItems(reviewInput(s)).map((i) => i.kind)).toEqual(['geld-zonder-periode'])
  })

  it('vaste last behouden: de geboekte maanden hangen aan de periode van hun dag; alles: ook in de prullenbak', async () => {
    const s = await store()
    const cost: FixedCost = { id: 'f1', name: 'Nephuur', currency: 'EUR', amounts: [{ from: '2026-08', amount: 20 }], updatedAt: T0, deletedAt: null }
    await put(s, 'fixedcosts.json.enc', cost)
    await put(s, 'periods.json.enc', { id: 'thuis-aug', kind: 'thuis', startDate: '2026-08-20', endDate: '2026-09-10', updatedAt: T0, deletedAt: null })
    await putMany(s, 'transactions.json.enc', [booking('b1', '2026-08-31', 'f1'), booking('b2', '2026-10-31', 'f1')])
    await vasteLastVerwijderen(s, cost, 'behouden')
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'b1')?.tripId).toBe('thuis-aug')
    expect(s.list('transactions.json.enc').find((tx) => tx.id === 'b2')?.tripId).toBeUndefined()
    expect(reviewItems(reviewInput(s)).filter((i) => i.kind === 'geld-zonder-periode').map((i) => i.kind === 'geld-zonder-periode' && i.tx.id)).toEqual(['b2'])
    const s2 = await store()
    await put(s2, 'fixedcosts.json.enc', cost)
    await put(s2, 'transactions.json.enc', booking('b1', '2026-08-31', 'f1'))
    await vasteLastVerwijderen(s2, cost, 'alles')
    expect(trashItems(s2).map((i) => i.kind)).toEqual(['geld'])
  })

  it('een student wissen haalt hem ook uit de groepen van een planning', async () => {
    const s = await store()
    const student: Student = { id: 's1', firstName: 'Nep', curriculumId: asa101.id, level: 'beginner', progress: {}, archivedAt: T0, updatedAt: T0, deletedAt: null }
    await put(s, 'students.json.enc', student)
    await put(s, 'plans.json.enc', { id: 'p1', title: 'Nepplanning', startDate: '2026-10-01', dayCount: 5, groups: [{ id: 'g', name: 'Groep A', curriculumId: asa101.id, level: 'beginner', studentIds: ['s1', 's2'] }], days: [], updatedAt: T0, deletedAt: null })
    await studentenWissen(s, [student])
    expect(s.list('plans.json.enc')[0]!.groups[0]!.studentIds).toEqual(['s2'])
  })

  it('een planningsgroep met een cursus die weg is: Nakijken, met de cursussen van de trip eerst', async () => {
    const s = await store()
    await put(s, 'trips.json.enc', trip('t', { participants: [{ id: 'x', firstName: 'Nep', curriculumId: 'seed-asa-103' }] }))
    await put(s, 'plans.json.enc', { id: 'p1', title: 'Nepplanning', startDate: '2026-10-01', dayCount: 5, tripId: 't', groups: [{ id: 'g', name: 'Groep A', curriculumId: 'eigen-weg', level: 'beginner', studentIds: [] }], days: [], updatedAt: T0, deletedAt: null })
    expect(violations(s).map((v) => v.rule)).toEqual(['planning-zonder-cursus'])
    expect(fixedAt(violations(s)[0]!)).toBe('nakijken')
    const item = reviewItems(reviewInput(s)).find((i) => i.kind === 'planning-zonder-cursus')
    if (item?.kind !== 'planning-zonder-cursus') throw new Error('verwacht')
    expect(item.choices[0]!.id).toBe('seed-asa-103')
    const undo = await planningCursusZetten(s, item.plan, 'g', 'seed-asa-103')
    expect(s.list('plans.json.enc')[0]!.groups[0]!.curriculumId).toBe('seed-asa-103')
    expect(violations(s)).toEqual([])
    await undo()
    expect(s.list('plans.json.enc')[0]!.groups[0]!.curriculumId).toBe('eigen-weg')
  })

  it('een onbekend veld in het laatst-record van dit apparaat (van een nieuwere build) blijft bij het opslaan staan', async () => {
    const s = await store()
    await put(s, 'settings.json.enc', { ...DEFAULT_SETTINGS, id: lastUsedId(), lastBoat: 'Nepboot', lastCurrencies: { fooi: 'USD' }, toekomstigVeld: 'blijft', updatedAt: T0, deletedAt: null } as Settings)
    await inTx(s, saveSettings, { lastRole: 'schipper' })
    const record = s.list('settings.json.enc').find((r) => r.id === lastUsedId()) as Settings & { toekomstigVeld?: string }
    expect(record).toMatchObject({ lastBoat: 'Nepboot', lastRole: 'schipper', lastCurrencies: { fooi: 'USD' }, toekomstigVeld: 'blijft' })
  })
})
