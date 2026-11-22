import { describe, expect, it } from 'vitest'
import type { LessonCourse, LessonStudent } from '../src/model/lesweek'
import { draftLessonPlan, examGaps, movedBlock, planDates, redraftFrom, unplanned, withDayInput } from '../src/model/lesweek-plan'
import type { LessonPlanDay } from '../src/model/types'

// Weekplanner van de lesweek: het voorstel volgens de regels uit het idee. Alle namen zijn verzonnen.

// 22 november 2026 is een zondag.
const trip = { startDate: '2026-11-22', endDate: '2026-11-28', boatKind: 'catamaran' as const }
const s = (id: string, courses: LessonCourse[]): LessonStudent => ({ id, name: id, courses })
const mixed = [s('a', ['101', '103']), s('b', ['104', '114'])]
const at = (plan: LessonPlanDay[], date: string) => plan.find((d) => d.date === date)!

describe('lesweekplanner: voorstel', () => {
  it('de standaardweek van het idee (catamaran, 2× 101/103 en 2× 104/114)', () => {
    const plan = draftLessonPlan(trip, mixed)
    expect(plan.map((d) => d.date)).toEqual(planDates(trip))
    expect(at(plan, '2026-11-22').middag).toEqual(['T1'])
    expect(at(plan, '2026-11-23')).toMatchObject({ ochtend: ['T2', 'P1'], middag: ['T3', 'P2', 'P3'] })
    expect(at(plan, '2026-11-24')).toMatchObject({ ochtend: ['T4'], middag: ['T5', 'P4'] })
    expect(at(plan, '2026-11-25')).toMatchObject({ ochtend: ['T6', 'T7', 'T12', 'P6'], middag: ['T8', 'P7'], avond: ['examen-101'] })
    expect(at(plan, '2026-11-26')).toMatchObject({ ochtend: ['T9', 'P8'], middag: ['T10', 'T11', 'P5'], avond: ['examen-104', 'examen-114', 'examen-103'] })
    expect(at(plan, '2026-11-27')).toMatchObject({ ochtend: ['P9'], middag: [], avond: [] })
    // Alles wat gepland hoort te worden, staat erin; theorie vóór elk examen.
    expect(unplanned(plan, mixed, trip)).toEqual([])
    expect(examGaps(plan, undefined, mixed, trip)).toEqual([])
  })

  it('alleen 101/103: mooring ball dinsdag, geen catamaran- of 104-blokken; monohull zonder 114', () => {
    const plan = draftLessonPlan(trip, [s('a', ['101', '103'])])
    expect(at(plan, '2026-11-24').ochtend).toEqual(['T4', 'P3'])
    expect(plan.flatMap((d) => [...d.ochtend, ...d.middag, ...d.avond])).not.toContain('T10')
    const mono = draftLessonPlan({ ...trip, boatKind: 'eenromp' }, [s('b', ['104', '114'])])
    const all = mono.flatMap((d) => [...d.ochtend, ...d.middag, ...d.avond])
    expect(all).not.toContain('examen-114')
    expect(all).not.toContain('T10')
    expect(all).toContain('examen-104')
  })

  it('wind en steiger per dag', () => {
    let inputs = draftLessonPlan(trip, mixed)
    inputs = withDayInput(inputs, '2026-11-24', { wind: 'veel', dock: true })
    inputs = withDayInput(inputs, '2026-11-23', { wind: 'weinig' })
    inputs = withDayInput(inputs, '2026-11-25', { wind: 'weinig' })
    const plan = draftLessonPlan(trip, mixed, inputs)
    // Veel wind op dinsdag: reven en bijliggen naar dinsdag; steiger dinsdagochtend.
    expect(at(plan, '2026-11-24').middag).toEqual(expect.arrayContaining(['T11', 'P5']))
    expect(at(plan, '2026-11-26').middag).not.toContain('P5')
    expect(at(plan, '2026-11-24').ochtend).toContain('P8')
    expect(at(plan, '2026-11-26').ochtend).not.toContain('P8')
    // Twee windstille dagen: extra motor op woensdag en man over boord naar voren.
    expect(at(plan, '2026-11-25').middag).toContain('P1')
    expect(at(plan, '2026-11-25').ochtend).toContain('P9')
    expect(at(plan, '2026-11-27').ochtend).not.toContain('P9')
    // Wind en steiger blijven bij de dag.
    expect(at(plan, '2026-11-24')).toMatchObject({ wind: 'veel', dock: true })
  })

  it('106 en extra uitdaging: nachttocht woensdagavond, examen 106 vrijdag', () => {
    const plan = draftLessonPlan(trip, [s('c', ['106'])])
    expect(at(plan, '2026-11-25').avond).toContain('P10')
    expect(at(plan, '2026-11-27').avond).toEqual(['examen-106'])
  })

  it('examen vóór de theorie: gemeld; verplaatsen en nieuw voorstel vanaf vandaag', () => {
    const plan = draftLessonPlan(trip, mixed)
    const moved = movedBlock(plan, 'T9', { date: '2026-11-26', slot: 'ochtend' }, { date: '2026-11-27', slot: 'ochtend' })
    expect(examGaps(moved, undefined, mixed, trip)).toEqual([{ course: '103', blocks: ['T9'] }])
    expect(examGaps(moved, { T9: { at: '2026-11-24' } }, mixed, trip)).toEqual([])
    // Nieuw voorstel op woensdag: maandag en dinsdag blijven, wat al gedaan is komt niet opnieuw.
    const edited = movedBlock(plan, 'T4', { date: '2026-11-24', slot: 'ochtend' }, null)
    const redraft = redraftFrom(withDayInput(edited, '2026-11-26', { dock: true }), { ...trip, lessonChecks: { T6: { at: '2026-11-25' } } }, mixed, '2026-11-25')
    expect(at(redraft, '2026-11-24').ochtend).toEqual([])
    // T6 is gedaan: niet opnieuw ingepland, maar blijft op zijn eigen dag staan.
    expect(at(redraft, '2026-11-25').ochtend.filter((id) => id === 'T6')).toHaveLength(1)
    expect(redraft.flatMap((d) => [...d.ochtend, ...d.middag, ...d.avond]).filter((id) => id === 'T6')).toHaveLength(1)
    expect(at(redraft, '2026-11-26').ochtend).toContain('P8')
  })
})
