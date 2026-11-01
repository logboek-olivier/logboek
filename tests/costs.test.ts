import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildIndex } from '../src/model/calendar'
import { costDayType, dayAverages, expectedCosts, fixedAmount, fixedInMonth, MIN_LEARNED_DAYS } from '../src/model/costs'
import { forecast } from '../src/model/position'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { CalendarDay, FixedCost, Settings, Transaction, WeekClosing } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'
import { vasteLastWijzigen } from '../src/domain/geld'

// Ronde 3 · PR 5: kosten. Vaste lasten met een bedrag dat vanaf een maand verandert (oude maanden blijven kloppen),
// variabele kosten per dag per dagsoort (eigen gemiddelde uit uitgaven en de weekschatting, anders het standaardbedrag,
// anders onbekend), en de vooruitblik die beide aftrekt. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
const TODAY = '2026-10-30'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  const db = await openLogboekDb(`logboek-kosten-${++counter}`)
  return Store.open(db, masterKey, new GithubClient('github_pat_KOSTEN_0123456789abcdefghijklmnopqrstuvwxyzAB', new FakeGithub().fetch))
}

const cost = (amounts: FixedCost['amounts'], extra: Partial<FixedCost> = {}): FixedCost => ({ id: 'f1', name: 'Nephuur', currency: 'EUR', amounts, updatedAt: T0, deletedAt: null, ...extra })
const day = (date: string, type: CalendarDay['type']): CalendarDay => ({ id: `dag:${date}`, date, type, updatedAt: T0, deletedAt: null })
const kosten = (id: string, date: string, amount: number): Transaction => ({ id, date, kind: 'kosten', amount, currency: 'EUR', source: 'overig', updatedAt: T0, deletedAt: null })
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra })

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('vaste lasten', () => {
  it('het bedrag van een maand: het laatste vanaf die maand; een wijziging geldt vanaf een maand', async () => {
    const c = cost([{ from: '2026-09', amount: 20 }, { from: '2026-11', amount: 25 }])
    expect(fixedAmount(c, '2026-08')).toBe(0)
    expect(fixedAmount(c, '2026-10')).toBe(20)
    expect(fixedAmount(c, '2026-12')).toBe(25)
    const s = await store()
    await put(s, 'fixedcosts.json.enc', c)
    // Vanaf oktober 30: de wijziging van november vervalt, september blijft.
    const undo = await vasteLastWijzigen(s, c, { amount: 30, from: '2026-10' })
    const changed = s.list('fixedcosts.json.enc')[0]!
    expect(changed.amounts).toEqual([{ from: '2026-09', amount: 20 }, { from: '2026-10', amount: 30 }])
    expect(fixedAmount(changed, '2026-09')).toBe(20)
    // Stoppen vanaf december.
    const undoStop = await vasteLastWijzigen(s, changed, { amount: 0, from: '2026-12' })
    expect(fixedAmount(s.list('fixedcosts.json.enc')[0]!, '2027-01')).toBe(0)
    // De eerste wijziging ongedaan maken overschrijft de latere niet; na het ongedaan maken van de latere wel terug.
    await undo()
    expect(fixedAmount(s.list('fixedcosts.json.enc')[0]!, '2027-01')).toBe(0)
    await undoStop()
    await undo()
    expect(s.list('fixedcosts.json.enc')[0]!.amounts).toEqual(c.amounts)
    expect(fixedInMonth([c, cost([{ from: '2026-01', amount: 100 }], { id: 'f2', currency: 'GBP' })], '2026-12', null)).toEqual({ eur: 25, other: { GBP: 100 } })
  })
})

describe('variabele kosten per dagsoort', () => {
  it('dagsoorten: werk, rust en reis zoals de agenda; de rest thuis', () => {
    expect(costDayType('werk')).toBe('werk')
    expect(costDayType('onbeschikbaar')).toBe('thuis')
    expect(costDayType(null)).toBe('thuis')
  })

  it('eigen gemiddelde met genoeg dagen; anders het standaardbedrag; anders onbekend', () => {
    // Vier weken thuis met elke week een schatting van 140 (20 per dag) en een uitgave van 14 op een maandag.
    const calendar: CalendarDay[] = []
    const closings: WeekClosing[] = []
    const transactions: Transaction[] = []
    const monday = '2026-09-28'
    for (let w = 0; w < 4; w++) {
      const start = addDays(monday, w * 7)
      for (let i = 0; i < 7; i++) calendar.push(day(addDays(start, i), 'thuis'))
      closings.push({ id: `week:${w}`, week: `2026-W${41 + w}`, start, spent: { amount: 140, currency: 'EUR' }, updatedAt: T0, deletedAt: null })
      transactions.push(kosten(`k${w}`, start, 14))
    }
    const index = buildIndex(calendar, [], [])
    const a = dayAverages(transactions, closings, index, TODAY, settings({ costDefaults: { reis: 45 } }), null)
    expect(a.thuis.source).toBe('geleerd')
    expect(a.thuis.days).toBeGreaterThanOrEqual(MIN_LEARNED_DAYS)
    expect(a.thuis.perDay).toBe(22)
    expect(a.reis).toEqual({ perDay: 45, source: 'standaard', days: 0 })
    expect(a.werk).toEqual({ perDay: 0, source: 'onbekend', days: 0 })
  })

  it('verwachte kosten per maand: de lopende maand naar rato, per dag het gemiddelde van de dagsoort', () => {
    const index = buildIndex([day('2026-10-31', 'werk')], [], [])
    const averages = { thuis: { perDay: 20, source: 'standaard' as const, days: 0 }, reis: { perDay: 40, source: 'standaard' as const, days: 0 }, werk: { perDay: 5, source: 'standaard' as const, days: 0 }, rust: { perDay: 0, source: 'onbekend' as const, days: 0 } }
    const months = expectedCosts([cost([{ from: '2026-01', amount: 310 }])], averages, index, TODAY, '2026-11', null)
    // Oktober: nog één dag (31 oktober, werk): 1/31 van de vaste last en 5 variabel. November: alles thuis.
    expect(months[0]).toEqual({ month: '2026-10', fixedEur: 10, variableEur: 5, unknown: false })
    expect(months[1]).toEqual({ month: '2026-11', fixedEur: 310, variableEur: 600, unknown: false })
  })

  it('de vooruitblik trekt de kosten af', () => {
    const index = buildIndex([], [], [])
    const averages = { thuis: { perDay: 10, source: 'standaard' as const, days: 0 }, reis: { perDay: 10, source: 'standaard' as const, days: 0 }, werk: { perDay: 10, source: 'standaard' as const, days: 0 }, rust: { perDay: 10, source: 'standaard' as const, days: 0 } }
    const f = forecast({ accounts: [], balances: [], trips: [], legs: [], transactions: [], rates: null }, settings(), TODAY, '2026-11-30', 6, { fixed: [cost([{ from: '2026-01', amount: 300 }])], averages, index })
    // 31 oktober: 300/31 vast + 10; november: 300 + 300.
    expect(f.costsEur).toBeCloseTo(-619.68, 2)
    expect(f.addsEur).toBe(f.costsEur)
    expect(f.items.map((i) => i.kind)).toEqual(['vaste-lasten', 'kosten', 'vaste-lasten', 'kosten'])
  })
})
