import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { applications, careerDueItems, cleanApplication, cleanContact, cleanProject, contacts, isOpen, projects, saveCareer, sortApplications } from '../src/model/career'
import { deleteCareerRecord } from '../src/model/edit'
import type { Application, CareerRecord } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Carrière: sollicitaties met de volgende actie als termijn, netwerk met alleen een voornaam, projecten. Verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

const app = (id: string, extra: Partial<Application>): Application => ({ id, kind: 'sollicitatie', company: 'Nepbedrijf', role: 'Nepfunctie', status: 'gesolliciteerd', updatedAt: NOW, deletedAt: null, ...extra })

describe('carrière', () => {
  it('opschonen: spaties, lengte, lege velden weg; van een naam alleen de voornaam', () => {
    expect(cleanApplication({ company: '  Nep   werf ', role: 'Skipper', status: 'gesprek', nextAction: ' Nabellen ', nextDate: '2027-01-20', note: '' })).toEqual({
      kind: 'sollicitatie',
      company: 'Nep werf',
      role: 'Skipper',
      status: 'gesprek',
      nextAction: 'Nabellen',
      nextDate: '2027-01-20',
    })
    expect(cleanApplication({ company: 'X', role: '', status: 'idee', nextAction: '', nextDate: 'morgen', note: ' ' })).toEqual({ kind: 'sollicitatie', company: 'X', role: '', status: 'idee' })
    expect(cleanContact({ firstName: '  Nepnoor Nepachternaam ', role: '', metAt: 'Nephaven' })).toEqual({ kind: 'contact', firstName: 'Nepnoor', metAt: 'Nephaven' })
    expect(cleanProject({ name: 'Nepproject', status: 'bezig', nextStep: '' })).toEqual({ kind: 'project', name: 'Nepproject', status: 'bezig' })
  })

  it('de volgende actie van een lopende sollicitatie is een termijn; afgerond of zonder datum niet', () => {
    const records: CareerRecord[] = [
      app('a', { nextAction: 'Nabellen', nextDate: '2027-01-20' }),
      app('b', { status: 'afgewezen', nextDate: '2027-01-10' }),
      app('c', {}),
      app('d', { nextDate: '2027-02-01', deletedAt: NOW }),
      { id: 'p', kind: 'project', name: 'Nepproject', status: 'bezig', updatedAt: NOW, deletedAt: null },
    ]
    expect(careerDueItems(records)).toEqual([{ id: 'a', title: 'Nepbedrijf: Nabellen', date: '2027-01-20', kind: 'deadline', source: 'career' }])
    expect(isOpen('gesprek')).toBe(true)
    expect(isOpen('aangenomen')).toBe(false)
    expect(applications(records).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(projects(records).map((r) => r.id)).toEqual(['p'])
    expect(contacts(records)).toEqual([])
    // Lopend eerst, op datum van de volgende actie.
    expect(sortApplications(applications(records)).map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })

  it('opslaan en verwijderen met ongedaan maken, in één bestand', async () => {
    const store = await Store.open(await openLogboekDb(`logboek-carriere-${++counter}`), masterKey, new GithubClient('github_pat_CAREER_0123456789abcdefghijklmnopqrstuvwxy', new FakeGithub().fetch))
    const saved = await saveCareer(store, null, cleanContact({ firstName: 'Nepnoor', role: 'Nepschipper', metAt: 'Nephaven' }))
    await saveCareer(store, null, cleanProject({ name: 'Nepproject', status: 'idee', nextStep: 'Nepstap' }))
    expect(store.list('career.json.enc').map((r) => r.kind).sort()).toEqual(['contact', 'project'])
    const undo = await deleteCareerRecord(store, saved)
    expect(contacts(store.list('career.json.enc'))).toEqual([])
    // Tombstone zonder inhoud: geen naam, rol of plek meer in het bestand.
    const tombstone = store.get('career.json.enc').find((r) => r.id === saved.id)!
    expect(tombstone).toEqual({ id: saved.id, kind: 'contact', firstName: '', updatedAt: tombstone.updatedAt, deletedAt: tombstone.deletedAt })
    await undo()
    expect(contacts(store.list('career.json.enc')).map((c) => ({ firstName: c.firstName, role: c.role, metAt: c.metAt }))).toEqual([{ firstName: 'Nepnoor', role: 'Nepschipper', metAt: 'Nephaven' }])
  })
})
