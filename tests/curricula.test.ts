import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addGroup,
  addTopic,
  allTopics,
  CurriculumFileError,
  deleteCurriculum,
  effectiveCurricula,
  exportCurriculum,
  importCurriculum,
  localized,
  moveGroup,
  moveTopic,
  removeTopic,
  saveCurriculum,
  toggleExamCritical,
  updateTopic,
} from '../src/model/curricula'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import type { Curriculum } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

const TOKEN = 'github_pat_CURRICULUM_0123456789abcdefghijklmnopqrstuvwxyz'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device(github = new FakeGithub()) {
  const db = await openLogboekDb(`logboek-curricula-${++counter}`)
  return { github, store: await Store.open(db, masterKey, new GithubClient(TOKEN, github.fetch)) }
}

const asa101 = () => SEED_CURRICULA.find((c) => c.id === 'seed-asa-101')!

describe('meegeleverde cursussen', () => {
  it('ASA 101, 103, 104 en 114 hebben onderwerpen in beide talen; RYA en CWO alleen de structuur', () => {
    for (const code of ['101', '103', '104', '114']) {
      const c = SEED_CURRICULA.find((s) => s.body === 'ASA' && s.courseCode === code)!
      expect(allTopics(c).length, code).toBeGreaterThanOrEqual(12)
      for (const tp of allTopics(c)) {
        expect(tp.title.nl.trim(), tp.id).not.toBe('')
        expect(tp.title.en.trim(), tp.id).not.toBe('')
      }
      expect(allTopics(c).some((tp) => tp.examCritical)).toBe(true)
      expect(c.source).toBe('seed')
    }
    const rya = SEED_CURRICULA.filter((c) => c.body === 'RYA')
    expect(rya.map((c) => c.courseCode)).toEqual(['Competent Crew', 'Day Skipper', 'Coastal Skipper', 'Yachtmaster Offshore'])
    expect(rya.every((c) => c.groups.length === 0)).toBe(true)
    expect(SEED_CURRICULA.filter((c) => c.body === 'CWO').every((c) => c.groups.length === 0)).toBe(true)
  })

  it('alle id\'s zijn uniek en vast (twee apparaten herkennen dezelfde cursus)', () => {
    const ids = [...SEED_CURRICULA.map((c) => c.id), ...SEED_CURRICULA.flatMap((c) => [...c.groups.map((g) => g.id), ...allTopics(c).map((tp) => tp.id)])]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('een opgeslagen versie vervangt de meegeleverde; een tombstone verbergt hem; eigen cursussen erbij', () => {
    const edited: Curriculum = { ...asa101(), name: { nl: 'Mijn 101', en: 'My 101' }, updatedAt: '2026-10-26T10:00:00.000Z' }
    const removed: Curriculum = { ...SEED_CURRICULA.find((c) => c.id === 'seed-rya-cc')!, deletedAt: '2026-10-26T10:00:00.000Z' }
    const own: Curriculum = { ...edited, id: 'eigen-1', body: 'eigen', source: 'eigen' }
    const list = effectiveCurricula([edited, removed, own])
    expect(list.find((c) => c.id === 'seed-asa-101')?.name.nl).toBe('Mijn 101')
    expect(list.some((c) => c.id === 'seed-rya-cc')).toBe(false)
    expect(list.at(-1)?.id).toBe('eigen-1')
    expect(effectiveCurricula([]).length).toBe(SEED_CURRICULA.length)
  })

  it('een lege vertaling valt terug op de andere taal', () => {
    expect(localized({ nl: '', en: 'Bowline' }, 'nl')).toBe('Bowline')
    expect(localized({ nl: 'Paalsteek', en: ' ' }, 'en')).toBe('Paalsteek')
  })
})

describe('bewerken', () => {
  it('groep en onderwerp toevoegen, wijzigen, verplaatsen, examenkritisch en verwijderen', () => {
    let c: Curriculum = { ...SEED_CURRICULA.find((s) => s.id === 'seed-rya-ds')! }
    c = addGroup(c, { nl: ' Navigatie ', en: '' })
    c = addGroup(c, { nl: 'Veiligheid', en: 'Safety' })
    const [nav, safety] = c.groups
    c = addTopic(c, nav!.id, { title: { nl: 'Peilen', en: 'Bearings' }, kind: 'theorie', examCritical: false })
    c = addTopic(c, nav!.id, { title: { nl: 'Getijden', en: 'Tides' }, kind: 'theorie', examCritical: true })
    expect(c.groups[0]!.title.nl).toBe('Navigatie')
    const [first, second] = c.groups[0]!.topics
    c = moveTopic(c, second!.id, -1)
    expect(c.groups[0]!.topics.map((tp) => tp.title.en)).toEqual(['Tides', 'Bearings'])
    c = toggleExamCritical(c, first!.id)
    expect(allTopics(c).find((tp) => tp.id === first!.id)?.examCritical).toBe(true)
    c = updateTopic(c, first!.id, { title: { nl: 'Kruispeiling', en: 'Cross bearing' }, kind: 'praktijk', examCritical: true }, safety!.id)
    expect(c.groups[1]!.topics.map((tp) => tp.title.nl)).toEqual(['Kruispeiling'])
    expect(c.groups[0]!.topics).toHaveLength(1)
    c = moveGroup(c, safety!.id, -1)
    expect(c.groups.map((g) => g.title.en)).toEqual(['Safety', ''])
    c = removeTopic(c, first!.id)
    expect(allTopics(c)).toHaveLength(1)
  })

  it('opslaan van een meegeleverde cursus versleuteld naar GitHub; verwijderen met ongedaan maken', async () => {
    const { github, store } = await device()
    await saveCurriculum(store, addTopic(asa101(), asa101().groups[0]!.id, { title: { nl: 'Geheimknoop', en: 'Secret knot' }, kind: 'praktijk', examCritical: false }))
    await store.sync()
    expect(github.files.has('curricula.json.enc')).toBe(true)
    const wire = github.requests.map((r) => r.body ?? '').join('\n')
    expect(wire).not.toContain('Geheimknoop')
    expect(wire).not.toContain('Keelboat')
    const list = effectiveCurricula(store.get('curricula.json.enc'))
    expect(allTopics(list.find((c) => c.id === 'seed-asa-101')!).some((tp) => tp.title.nl === 'Geheimknoop')).toBe(true)
    const undo = await deleteCurriculum(store, list.find((c) => c.id === 'seed-asa-101')!)
    expect(effectiveCurricula(store.get('curricula.json.enc')).some((c) => c.id === 'seed-asa-101')).toBe(false)
    await undo()
    expect(effectiveCurricula(store.get('curricula.json.enc')).some((c) => c.id === 'seed-asa-101')).toBe(true)
  })

  it('een tweede apparaat ziet de bewerking na sync; een logboek van de vorige versie (zonder curricula) opent gewoon', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    expect(a.store.get('curricula.json.enc')).toEqual([])
    await saveCurriculum(a.store, { ...asa101(), name: { nl: 'Aangepast', en: 'Changed' } })
    await a.store.sync()
    const b = await device(github)
    await b.store.sync()
    expect(effectiveCurricula(b.store.get('curricula.json.enc')).find((c) => c.id === 'seed-asa-101')?.name.nl).toBe('Aangepast')
  })
})

describe('import en export', () => {
  it('export en import geven dezelfde inhoud met nieuwe id\'s', () => {
    const json = exportCurriculum(asa101())
    expect(JSON.parse(json)).toMatchObject({ format: 'logboek-curriculum', version: 1 })
    expect(json).not.toContain('seed-asa-101')
    const imported = importCurriculum(json)
    expect(imported.id).not.toBe('seed-asa-101')
    expect(imported.source).toBe('eigen')
    expect(imported.groups.map((g) => g.title)).toEqual(asa101().groups.map((g) => g.title))
    expect(allTopics(imported).map((tp) => [tp.title, tp.kind, tp.examCritical])).toEqual(allTopics(asa101()).map((tp) => [tp.title, tp.kind, tp.examCritical]))
    expect(allTopics(imported).every((tp, i) => tp.id !== allTopics(asa101())[i]!.id)).toBe(true)
  })

  it('weigert ongeldige en te grote bestanden', () => {
    expect(() => importCurriculum('geen json')).toThrow(CurriculumFileError)
    expect(() => importCurriculum('{"format":"iets anders","version":1,"curriculum":{}}')).toThrow(CurriculumFileError)
    const base = JSON.parse(exportCurriculum(asa101()))
    base.curriculum.groups[0].topics[0].kind = 'zwemmen'
    expect(() => importCurriculum(JSON.stringify(base))).toThrow(CurriculumFileError)
    const big = JSON.parse(exportCurriculum(asa101()))
    big.curriculum.groups = Array.from({ length: 101 }, () => ({ title: { nl: 'x', en: 'x' }, topics: [] }))
    expect(() => importCurriculum(JSON.stringify(big))).toThrow(CurriculumFileError)
    const long = JSON.parse(exportCurriculum(asa101()))
    long.curriculum.name.nl = 'x'.repeat(5000)
    expect(importCurriculum(JSON.stringify(long)).name.nl).toHaveLength(200)
  })
})
