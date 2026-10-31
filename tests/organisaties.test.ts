import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { countedOrganisations, LEGACY_ORGS, orgFromName, organisationChoices, organisationsFrom, setOrganisations, sourceForPeriod, tripOrganisation } from '../src/basis/organisatie'
import { nieuwLogboekInrichten } from '../src/domain/instellingen'
import { curriculumPacks, effectiveCurricula, setCurriculumPacks } from '../src/model/curricula'
import { nameWithCounter, tripCounters } from '../src/model/counters'
import { tellerBeginnummersOpslaan } from '../src/domain/trips'
import { organisationLabel } from '../src/i18n/labels'
import { parsePlanning } from '../src/import/planning'
import { careerStart } from '../src/model/position'
import { currentSettings, DEFAULT_SETTINGS } from '../src/model/settings'
import type { Trip } from '../src/model/types'
import { taxYear } from '../src/model/tax-year'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// PR 5: organisaties instelbaar, een nieuw logboek begint leeg (geen SV/YW, geen ASA, geen startdatum van een ander),
// een bestaand logboek houdt alles zoals het was. Alleen nepdata.

const T0 = '2026-01-01T00:00:00.000Z'
const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, startDate: '2026-10-01', endDate: '2026-10-07', ...extra, updatedAt: T0, deletedAt: null })

afterEach(() => {
  setOrganisations(LEGACY_ORGS)
  setCurriculumPacks(null)
})

describe('organisaties', () => {
  it('een bestaand logboek (zonder instelling) houdt Sailing Virgins en Yacht Week; een nieuw logboek begint leeg', () => {
    expect(organisationsFrom(DEFAULT_SETTINGS).map((o) => o.id)).toEqual(['sailing-virgins', 'yacht-week'])
    expect(organisationsFrom({ ...DEFAULT_SETTINGS, startedEmpty: true })).toEqual([])
    expect(organisationsFrom({ ...DEFAULT_SETTINGS, startedEmpty: true, organisations: [{ id: 'org:x', name: 'Nep Charters', short: 'NC' }] }).map((o) => o.name)).toEqual(['Nep Charters'])
  })

  it('een eigen organisatie telt mee: teller, herkenning uit de naam, jaaroverzicht', () => {
    setOrganisations([{ id: 'org:x', name: 'Nep Charters', short: 'NC' }])
    expect(organisationChoices()).toEqual(['org:x', 'eigen', 'overig'])
    expect(countedOrganisations()).toEqual(['org:x'])
    expect(orgFromName('Nep charters week 3')).toEqual({ org: 'org:x', sure: true })
    expect(orgFromName('NC 4 · BVI')).toEqual({ org: 'org:x', sure: false })
    // Sailing Virgins bestaat in dit logboek niet: niet herkend.
    expect(orgFromName('Sailing Virgins 2')).toBeNull()
    const trips = [trip('a', { organisation: 'org:x' }), trip('b', { name: 'Nep charters 2', startDate: '2026-10-10', endDate: '2026-10-12' })]
    expect([...tripCounters(trips, [], currentSettings([])).values()].map((c) => c.label)).toEqual(['NC #1', 'NC #2'])
    expect(tripOrganisation(trips[1]!)).toBe('org:x')
    // De bron voor oudere versies: alleen SV en YW bestaan daar; een eigen organisatie is "overig".
    expect(sourceForPeriod(trips[0])).toBe('overig')
    const year = taxYear([{ id: 't', date: '2026-10-05', kind: 'fooi', amount: 50, currency: 'EUR', amountEur: 50, source: 'overig', tripId: 'a', updatedAt: T0, deletedAt: null }], trips, 2026, null)
    expect(year.groups.map((g) => [g.group, g.eur])).toEqual([['org:x', 50]])
  })

  it('geld van een organisatie die niet meer in de lijst staat, telt nog steeds mee in het jaaroverzicht', () => {
    setOrganisations([])
    const trips = [trip('a', { organisation: 'org:weg' })]
    const year = taxYear([{ id: 't', date: '2026-10-05', kind: 'loon', amount: 900, currency: 'EUR', amountEur: 900, source: 'overig', tripId: 'a', updatedAt: T0, deletedAt: null }], trips, 2026, null)
    expect(year.totalEur).toBe(900)
  })
})

describe('leeg beginnen', () => {
  it('een nieuw logboek: geen organisaties, geen cursuspakketten, geen startdatum van een ander', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const store = await Store.open(await openLogboekDb('logboek-leeg-1'), key, new GithubClient('github_pat_LEEG_0123456789abcdefghijklmnopqrstuvwxyz0', new FakeGithub().fetch))
    await nieuwLogboekInrichten(store)
    const settings = currentSettings(store.list('settings.json.enc'))
    expect(settings).toMatchObject({ startedEmpty: true, organisations: [], curriculumPacks: [] })
    expect(organisationsFrom(settings)).toEqual([])
    expect(careerStart(settings)).toBe(`${new Date().getFullYear()}-01-01`)
    // Bestaand logboek: de startdatum zoals altijd.
    expect(careerStart(DEFAULT_SETTINGS)).toBe('2026-09-11')
  })

  it('cursuspakketten: alle in een bestaand logboek, alleen de gekozen in een nieuw', () => {
    expect(curriculumPacks()).toBeNull()
    expect(effectiveCurricula([]).some((c) => c.body === 'ASA')).toBe(true)
    setCurriculumPacks([])
    expect(effectiveCurricula([])).toEqual([])
    setCurriculumPacks(['ASA'])
    expect(new Set(effectiveCurricula([]).map((c) => c.body))).toEqual(new Set(['ASA']))
  })
})

describe('review PR 5', () => {
  it('een afkorting met leestekens breekt geen scherm; een eigen naam telt alleen als losse woorden', () => {
    setOrganisations([{ id: 'org:c', name: 'Sun', short: 'C++' }])
    const trips = [trip('a', { organisation: 'org:c', name: 'C++ 4 · BVI' })]
    const counter = tripCounters(trips, [], currentSettings([])).get('a')
    expect(() => nameWithCounter(trips[0]!, counter)).not.toThrow()
    expect(nameWithCounter(trips[0]!, counter)).toBe('C++ #1 · BVI')
    expect(orgFromName('Sunsail week 3')).toBeNull()
    expect(orgFromName('Sun week 3')).toEqual({ org: 'org:c', sure: true })
  })

  it('Yacht Week hernoemd: trips met de oude naam horen er nog steeds bij', () => {
    setOrganisations([{ id: 'yacht-week', name: 'The Yacht Week', short: 'YW' }])
    expect(orgFromName('Yacht week 7')).toEqual({ org: 'yacht-week', sure: true })
  })

  it('een organisatie die niet (meer) in de lijst staat, blijft te kiezen en heet nooit naar haar id', () => {
    setOrganisations([])
    expect(organisationChoices([trip('a', { organisation: 'org:weg' })])).toEqual(['eigen', 'overig', 'org:weg'])
    expect(organisationLabel('org:weg', 'nl')).toBe('Onbekende organisatie')
  })

  it('beginnummers van een organisatie die even weg is, blijven bewaard', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const store = await Store.open(await openLogboekDb('logboek-leeg-2'), key, new GithubClient('github_pat_LEEG_0123456789abcdefghijklmnopqrstuvwxyz0', new FakeGithub().fetch))
    await tellerBeginnummersOpslaan(store, { 'sailing-virgins': 3, 'yacht-week': 10 })
    setOrganisations([LEGACY_ORGS[0]!])
    await tellerBeginnummersOpslaan(store, { 'sailing-virgins': 4 })
    expect(currentSettings(store.list('settings.json.enc')).orgFirst).toEqual({ 'sailing-virgins': 4, 'yacht-week': 10 })
  })

  it('de planningsimport herkent een eigen organisatie aan naam of afkorting', () => {
    setOrganisations([{ id: 'org:x', name: 'Nep Charters', short: 'NC' }])
    const csv = (org: string) => new TextEncoder().encode(`start;eind;soort;naam;organisatie\n2026-11-01;2026-11-07;werk;Nepweek;${org}\n`)
    expect(parsePlanning(csv('Nep Charters'))[0]!.organisation).toBe('org:x')
    expect(parsePlanning(csv('nc'))[0]!.organisation).toBe('org:x')
    expect(() => parsePlanning(csv('Onbekend'))).toThrow()
  })
})
