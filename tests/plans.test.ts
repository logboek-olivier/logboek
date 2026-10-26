import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { allTopics } from '../src/model/curricula'
import {
  activePlan,
  addBlock,
  blocksOn,
  draftPlan,
  findBlock,
  moveBlock,
  newGroup,
  noteIn,
  planText,
  removeBlock,
  reschedule,
  savePlan,
  splitPlans,
  studentsFor,
  tickForGroup,
  topicChoices,
  topicDone,
  updateBlock,
  updateGroups,
} from '../src/model/plans'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import { statusOf, withStatus } from '../src/model/students'
import type { PlanGroup, Student, WeekPlan } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

const TOKEN = 'github_pat_PLANS_0123456789abcdefghijklmnopqrstuvwxyz'
const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device(github = new FakeGithub()) {
  const db = await openLogboekDb(`logboek-plans-${++counter}`)
  return { github, store: await Store.open(db, masterKey, new GithubClient(TOKEN, github.fetch)) }
}

const asa101 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-101')!
const asa103 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-103')!
const topics = allTopics(asa101)
const byId = new Map(topics.map((t) => [t.id, t]))

function group(patch: Partial<PlanGroup> = {}): PlanGroup {
  return { ...newGroup('Groep A', asa101.id), ...patch }
}

function draft(groups: PlanGroup[], dayCount = 5): WeekPlan {
  return draftPlan({ title: 'Nepweek', startDate: '2026-10-26', dayCount, groups }, SEED_CURRICULA, 'nl')
}

function student(id: string, patch: Partial<Student> = {}): Student {
  return { id, firstName: 'Nep', curriculumId: asa101.id, level: 'beginner', progress: {}, archivedAt: null, updatedAt: NOW, deletedAt: null, ...patch }
}

describe('concept', () => {
  it('theorie in de ochtend, praktijk in de middag, examenkritisch eerst, alles ingepland, laatste dag herhaling en examen', () => {
    const plan = draft([group()])
    expect(plan.days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'])
    const teach = plan.days.slice(0, 4).flatMap((d) => d.blocks)
    for (const b of teach) {
      const kinds = new Set(b.topicIds.map((id) => byId.get(id)!.kind))
      expect([...kinds]).toEqual([b.slot === 'ochtend' ? 'theorie' : 'praktijk'])
    }
    // Elk onderwerp precies één keer in de lesdagen.
    expect(teach.flatMap((b) => b.topicIds).sort()).toEqual(topics.map((t) => t.id).sort())
    // Examenkritisch eerst: binnen theorie en praktijk komt geen kritisch onderwerp na een niet-kritisch.
    for (const kind of ['theorie', 'praktijk'] as const) {
      const order = teach
        .filter((b) => b.slot === (kind === 'theorie' ? 'ochtend' : 'middag'))
        .flatMap((b) => b.topicIds)
        .map((id) => byId.get(id)!.examCritical)
      expect(order.indexOf(false) === -1 || order.lastIndexOf(true) < order.indexOf(false)).toBe(true)
    }
    const last = plan.days[4]!.blocks
    expect(last.map((b) => b.slot)).toEqual(['ochtend', 'middag'])
    expect(last[0]!.topicIds.sort()).toEqual(topics.filter((t) => t.examCritical).map((t) => t.id).sort())
    expect(last[1]!.note).toBe('Examen')
  })

  it('beginners gelijk verdeeld over alle dagen; gevorderden meer per blok en eerder klaar', () => {
    const beginner = draft([group({ level: 'beginner' })], 8)
    const advanced = draft([group({ level: 'gevorderd' })], 8)
    const busiest = (p: WeekPlan) => Math.max(...p.days.slice(0, -1).flatMap((d) => d.blocks.map((b) => b.topicIds.length)))
    const usedDays = (p: WeekPlan) => p.days.slice(0, -1).filter((d) => d.blocks.length > 0).length
    expect(busiest(beginner)).toBeLessThan(busiest(advanced))
    expect(usedDays(beginner)).toBeGreaterThan(usedDays(advanced))
  })

  it('twee groepen krijgen eigen blokken; één dag heeft geen aparte herhalingsdag', () => {
    const a = group()
    const b = group({ name: 'Groep B', curriculumId: asa103.id })
    const plan = draft([a, b], 3)
    expect(plan.days[0]!.blocks.some((x) => x.groupIds[0] === a.id)).toBe(true)
    expect(plan.days[0]!.blocks.some((x) => x.groupIds[0] === b.id)).toBe(true)
    const single = draft([a], 1)
    expect(single.days).toHaveLength(1)
    expect(single.days[0]!.blocks.every((x) => !x.note)).toBe(true)
  })
})

describe('bewerken', () => {
  it('blok aanpassen, verplaatsen naar een andere dag en dagdeel, toevoegen en verwijderen', () => {
    let plan = draft([group()])
    const first = plan.days[0]!.blocks[0]!
    plan = updateBlock(plan, first.id, { groupIds: first.groupIds, topicIds: [first.topicIds[0]!], location: ' Nephaven ', note: '' })
    expect(findBlock(plan, first.id)!.block).toMatchObject({ topicIds: [first.topicIds[0]], location: 'Nephaven' })
    expect(findBlock(plan, first.id)!.block.note).toBeUndefined()
    plan = moveBlock(plan, first.id, '2026-10-28', 'avond')
    expect(findBlock(plan, first.id)).toMatchObject({ date: '2026-10-28', block: { slot: 'avond' } })
    expect(blocksOn(plan, '2026-10-28').at(-1)!.id).toBe(first.id)
    const added = addBlock(plan, '2026-10-26', 'middag', [])
    expect(findBlock(added.plan, added.blockId)!.date).toBe('2026-10-26')
    expect(findBlock(removeBlock(added.plan, added.blockId), added.blockId)).toBeNull()
  })

  it('andere startdatum houdt blokken op hun dagnummer; minder dagen laat de laatste vallen', () => {
    const plan = draft([group()])
    const moved = reschedule(plan, { title: 'Nieuw', startDate: '2026-11-02', dayCount: 3 })
    expect(moved.days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(moved.days[0]!.blocks).toEqual(plan.days[0]!.blocks)
    expect(moved.dayCount).toBe(3)
    expect(moved.title).toBe('Nieuw')
  })

  it('een verwijderde groep verdwijnt uit de blokken; onderwerpen om uit te kiezen volgen de cursus van de groepen', () => {
    const a = group()
    const b = group({ name: 'Groep B', curriculumId: asa103.id })
    const plan = updateGroups(draft([a, b]), [a])
    expect(plan.days.flatMap((d) => d.blocks).every((x) => !x.groupIds.includes(b.id))).toBe(true)
    expect(topicChoices(draft([a, b]), [b.id], SEED_CURRICULA).every((t) => allTopics(asa103).includes(t))).toBe(true)
  })
})

describe('vandaag en afvinken', () => {
  it('vindt de lopende planning en splitst in lopend/komend en afgelopen', () => {
    const plan = { ...draft([group()]), updatedAt: NOW }
    const old = { ...draftPlan({ title: 'Oud', startDate: '2026-09-01', dayCount: 3, groups: [] }, SEED_CURRICULA, 'nl'), updatedAt: NOW }
    expect(activePlan([old, plan], '2026-10-28')?.id).toBe(plan.id)
    expect(activePlan([old, plan], '2026-10-31')).toBeNull()
    expect(activePlan([{ ...plan, deletedAt: NOW }], '2026-10-28')).toBeNull()
    const split = splitPlans([old, plan], '2026-10-27')
    expect(split.current.map((p) => p.id)).toEqual([plan.id])
    expect(split.past.map((p) => p.id)).toEqual([old.id])
  })

  it('tik op een onderwerp = geoefend voor de hele groep; verlaagt nooit; gearchiveerde en andere cursussen tellen niet mee', () => {
    const g = group({ studentIds: ['s1', 's2', 's3', 's4'] })
    const plan = draft([g])
    const b = plan.days[0]!.blocks[0]!
    const topicId = b.topicIds[0]!
    const students = [
      student('s1'),
      withStatus(student('s2'), topicId, 'beheerst', NOW),
      student('s3', { archivedAt: '2026-01-01' }),
      student('s4', { curriculumId: asa103.id }),
      student('s5'),
    ]
    const group1 = studentsFor(plan, b, asa101.id, students)
    expect(group1.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(topicDone(group1, topicId)).toBe(false)
    const changed = tickForGroup(group1, topicId, NOW)
    expect(changed.map((s) => s.id)).toEqual(['s1'])
    expect(statusOf(changed[0]!, topicId)).toBe('geoefend')
    expect(topicDone([changed[0]!, group1[1]!], topicId)).toBe(true)
    expect(topicDone([], topicId)).toBeNull()
  })
})

describe('delen', () => {
  it('tekst in de gekozen taal, met groepsnamen en zonder studentnamen; standaardnotities vertaald', () => {
    const plan = draft([group({ name: 'Groep A', studentIds: ['s1'] })], 2)
    const en = planText(plan, SEED_CURRICULA, 'en')
    expect(en).toContain('Nepweek')
    expect(en).toContain('Morning · Groep A')
    expect(en).toContain('Exam')
    expect(en).toContain(`- ${topics.find((t) => t.kind === 'theorie')!.title.en}`)
    expect(en).not.toContain('Ochtend')
    const nl = planText(plan, SEED_CURRICULA, 'nl')
    expect(nl).toContain('Ochtend · Groep A')
    expect(nl).toMatch(/^Nepweek\n26–27 oktober 2026\n\nMaandag 26 oktober/)
    expect(noteIn('Examen', 'en')).toBe('Exam')
    expect(noteIn('Eigen notitie', 'en')).toBe('Eigen notitie')
  })
})

describe('opslag', () => {
  it('versleuteld naar GitHub; een logboek van de vorige versie (zonder plans.json.enc) opent gewoon', async () => {
    const github = new FakeGithub()
    const a = await device(github)
    expect(a.store.get('plans.json.enc')).toEqual([])
    await savePlan(a.store, draft([group({ name: 'Nepgroep' })]))
    await a.store.sync()
    expect(github.files.has('plans.json.enc')).toBe(true)
    const wire = github.requests.map((r) => r.body ?? '').join('\n')
    expect(wire).not.toContain('Nepweek')
    expect(wire).not.toContain('Nepgroep')
    const b = await device(github)
    await b.store.sync()
    expect(b.store.get('plans.json.enc')[0]!.title).toBe('Nepweek')
  })
})
