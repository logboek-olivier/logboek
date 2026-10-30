import { describe, expect, it } from 'vitest'
import { applyBlockEdit, blockItems, cleanOwnThemes, draftPlan, newGroup, planText, splitBlock, updateBlock } from '../src/model/plans'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import type { PlanGroup, WeekPlan } from '../src/model/types'

// Planning grof: elke dag een ochtend en een middag, een blok standaard voor alle groepen samen, één thema per blok,
// een leeg dagdeel mag; per groep alleen als Olivier dat kiest; eigen thema's als tekst. Verzonnen groepen.

const asa101 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-101')!
const asa103 = SEED_CURRICULA.find((c) => c.id === 'seed-asa-103')!
const group = (name: string, curriculumId = asa101.id): PlanGroup => newGroup(name, curriculumId)
const draft = (groups: PlanGroup[], dayCount = 6): WeekPlan => draftPlan({ title: 'Nepweek', startDate: '2026-11-02', dayCount, groups }, SEED_CURRICULA, 'nl')

describe('grof concept', () => {
  it('twee groepen met dezelfde cursus delen elk blok, met één thema per blok', () => {
    const a = group('Groep A')
    const b = group('Groep B')
    const plan = draft([a, b])
    const themes = asa101.groups.filter((g) => g.topics.length > 0).length
    const teach = plan.days.slice(0, -1).flatMap((d) => d.blocks)
    expect(teach.every((x) => x.groupIds.length === 2)).toBe(true)
    if (themes <= teach.length) expect(teach.every((x) => x.themeIds!.length === 1)).toBe(true)
    // Elk thema één keer.
    expect(teach.flatMap((x) => x.themeIds!).sort()).toEqual(asa101.groups.filter((g) => g.topics.length > 0).map((g) => g.id).sort())
    // Laatste dag: herhaling en examen, ook samen.
    expect(plan.days.at(-1)!.blocks.map((x) => x.groupIds.length)).toEqual([2, 2])
  })

  it('verschillende cursussen: per cursus een blok in hetzelfde dagdeel', () => {
    const a = group('Groep A')
    const b = group('Groep B', asa103.id)
    const plan = draft([a, b], 3)
    const morning = plan.days[0]!.blocks.filter((x) => x.slot === 'ochtend')
    expect(morning.map((x) => x.groupIds)).toEqual(expect.arrayContaining([[a.id], [b.id]]))
  })

  it('een leeg dagdeel mag (meer dagdelen dan thema\'s)', () => {
    const plan = draft([group('Groep A')], 12)
    const teach = plan.days.slice(0, -1)
    expect(teach.some((d) => !d.blocks.some((x) => x.slot === 'ochtend') || !d.blocks.some((x) => x.slot === 'middag'))).toBe(true)
  })
})

describe('bewerken: samen of per groep, eigen thema\'s', () => {
  it('per groep splitst een gezamenlijk blok in één blok per groep, met dezelfde inhoud', () => {
    const a = group('Groep A')
    const b = group('Groep B')
    const plan = draft([a, b])
    const joint = plan.days[0]!.blocks[0]!
    const split = splitBlock(plan, joint.id, [a.id, b.id])
    const blocks = split.days[0]!.blocks.filter((x) => x.slot === joint.slot)
    expect(blocks.map((x) => x.groupIds)).toEqual([[a.id], [b.id]])
    expect(blocks.every((x) => x.themeIds!.join() === joint.themeIds!.join())).toBe(true)
    expect(new Set(blocks.map((x) => x.id)).size).toBe(2)
    // Via het blokblad: per groep, verplaatst naar de middag van dag 2.
    const edited = applyBlockEdit(plan, joint.id, { groupIds: [a.id, b.id], topicIds: joint.topicIds, themeIds: joint.themeIds, ownThemes: ['Mooring ball oppikken'] }, plan.days[1]!.date, 'middag', true)
    const moved = edited.days[1]!.blocks.filter((x) => x.ownThemes?.includes('Mooring ball oppikken'))
    expect(moved.map((x) => x.groupIds)).toEqual([[a.id], [b.id]])
    expect(moved.every((x) => x.slot === 'middag')).toBe(true)
    expect(edited.days[0]!.blocks.some((x) => x.id === joint.id)).toBe(false)
  })

  it("eigen thema's als tekst: in het blok, in de gedeelde tekst; leeg en dubbel valt weg", () => {
    const a = group('Groep A')
    const plan = draft([a], 2)
    const first = plan.days[0]!.blocks[0]!
    const next = updateBlock(plan, first.id, { groupIds: [a.id], topicIds: [], themeIds: [], ownThemes: ['Mooring ball oppikken', ' ', 'mooring ball oppikken'] })
    const b = next.days[0]!.blocks.find((x) => x.id === first.id)!
    expect(b.ownThemes).toEqual(['Mooring ball oppikken'])
    expect(blockItems(b, SEED_CURRICULA, 'nl').map((i) => i.title)).toEqual(['Mooring ball oppikken'])
    expect(planText(next, SEED_CURRICULA, 'nl')).toContain('- Mooring ball oppikken')
    expect(cleanOwnThemes(Array.from({ length: 20 }, (_, i) => `Nep ${i}`))).toHaveLength(10)
  })
})
