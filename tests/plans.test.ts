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
  splitPlans,
  studentsFor,
  tickItemForGroup,
  itemDone,
  blockItems,
  shiftBlock,
  themeChoices,
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
import { planningOpslaan } from '../src/domain/training'

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
  it("grote thema's: theorie-thema's 's ochtends, praktijk 's middags, examenkritische thema's eerst, elk thema één keer, laatste dag herhaling en examen", () => {
    const plan = draft([group()])
    expect(plan.days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'])
    const teach = plan.days.slice(0, 4).flatMap((d) => d.blocks)
    const themeById = new Map(asa101.groups.map((g) => [g.id, g]))
    for (const b of teach) {
      expect(b.themeIds!.length).toBeGreaterThan(0)
      expect(b.themeIds!.length).toBeLessThanOrEqual(2)
      // De onderwerpen van een blok zijn precies die van zijn thema's.
      expect(b.topicIds.sort()).toEqual(b.themeIds!.flatMap((id) => themeById.get(id)!.topics.map((t) => t.id)).sort())
      for (const id of b.themeIds!) {
        const th = themeById.get(id)!
        const theory = th.topics.filter((t) => t.kind === 'theorie').length * 2 > th.topics.length
        expect(b.slot).toBe(theory ? 'ochtend' : 'middag')
      }
    }
    // Elk thema met onderwerpen precies één keer in de lesdagen.
    expect(teach.flatMap((b) => b.themeIds!).sort()).toEqual(asa101.groups.filter((g) => g.topics.length > 0).map((g) => g.id).sort())
    // Thema's met examenkritische onderwerpen eerst (per dagdeel).
    for (const slot of ['ochtend', 'middag'] as const) {
      const order = teach.filter((b) => b.slot === slot).flatMap((b) => b.themeIds!).map((id) => themeById.get(id)!.topics.some((t) => t.examCritical))
      expect(order.indexOf(false) === -1 || order.lastIndexOf(true) < order.indexOf(false)).toBe(true)
    }
    const last = plan.days[4]!.blocks
    expect(last.map((b) => b.slot)).toEqual(['ochtend', 'middag'])
    expect(last[0]!.topicIds.sort()).toEqual(topics.filter((t) => t.examCritical).map((t) => t.id).sort())
    expect(last[0]!.themeIds!.length).toBeGreaterThan(0)
    expect(last[1]!.note).toBe('Examen')
  })

  it('meer dagen dan thema\'s laat dagdelen vrij om te oefenen; nooit tientallen onderwerpen in een lijst', () => {
    const plan = draft([group()], 10)
    const teach = plan.days.slice(0, -1)
    expect(teach.some((d) => d.blocks.length === 0)).toBe(true)
    for (const d of teach) for (const b of d.blocks) expect(blockItems(b, SEED_CURRICULA, 'nl').length).toBeLessThanOrEqual(2)
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
    const changed = tickItemForGroup(group1, [topicId], NOW)
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
    expect(en).toContain(`- ${asa101.groups[0]!.title.en}`)
    expect(en).not.toContain(`- ${topics[0]!.title.en}`)
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
    await planningOpslaan(a.store, draft([group({ name: 'Nepgroep' })]))
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

describe('thema\'s snel veranderen', () => {
  it('één tik een dag eerder of later; aan de rand blijft het blok staan', () => {
    const plan = draft([group()])
    const first = plan.days[0]!.blocks[0]!
    const later = shiftBlock(plan, first.id, 1)
    expect(findBlock(later, first.id)).toMatchObject({ date: '2026-10-27', block: { slot: first.slot } })
    expect(shiftBlock(plan, first.id, -1)).toBe(plan)
  })

  it("thema's aan en uit: onderwerpen volgen; thema afvinken = alle onderwerpen geoefend voor de groep", () => {
    let plan = draft([group({ studentIds: ['s1', 's2'] })])
    const b = plan.days[0]!.blocks[0]!
    const choices = themeChoices(plan, b.groupIds, SEED_CURRICULA)
    expect(choices.map((c) => c.id)).toEqual(asa101.groups.map((g) => g.id))
    const other = choices.find((c) => !b.themeIds!.includes(c.id))!
    plan = updateBlock(plan, b.id, { groupIds: b.groupIds, topicIds: other.topicIds, themeIds: [other.id] })
    const items = blockItems(findBlock(plan, b.id)!.block, SEED_CURRICULA, 'nl')
    expect(items).toEqual([{ id: other.id, title: asa101.groups.find((g) => g.id === other.id)!.title.nl, topicIds: other.topicIds, theme: true }])

    const done = withStatus(student('s1'), other.topicIds[0]!, 'beheerst', NOW)
    const group1 = [done, student('s2')]
    expect(itemDone(group1, other.topicIds)).toBe(false)
    const changed = tickItemForGroup(group1, other.topicIds, NOW)
    expect(changed.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(statusOf(changed.find((s) => s.id === 's1')!, other.topicIds[0]!)).toBe('beheerst')
    expect(itemDone(changed, other.topicIds)).toBe(true)
  })

  it('een oudere planning met losse onderwerpen blijft gewoon werken', () => {
    const old: WeekPlan = { ...draft([group()]), days: [{ date: '2026-10-26', blocks: [{ id: 'x', slot: 'ochtend', groupIds: [], topicIds: [topics[0]!.id] }] }] }
    expect(blockItems(old.days[0]!.blocks[0]!, SEED_CURRICULA, 'nl')).toEqual([{ id: topics[0]!.id, title: topics[0]!.title.nl, topicIds: [topics[0]!.id], theme: false }])
  })
})
