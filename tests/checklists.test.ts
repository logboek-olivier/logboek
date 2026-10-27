import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { addChecklist, checkedItems, checklistsFor, deleteChecklist, effectiveChecklists, saveChecklist, toggleCheck } from '../src/model/checklists'
import { sailtime } from '../src/model/sailtime'
import { SEED_CHECKLISTS } from '../src/model/seed-checklists'
import { DEFAULT_SETTINGS } from '../src/model/settings'
import type { Leg, Trip } from '../src/model/types'
import { closeWeek } from '../src/model/weeks'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Trip afsluiten, vaste checklists en de export van de zeiltijd. Alle gegevens zijn verzonnen.

const NOW = '2026-10-26T10:00:00.000Z'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
async function device() {
  return Store.open(await openLogboekDb(`logboek-checklists-${++counter}`), masterKey, new GithubClient('github_pat_LISTS_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
}
const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, updatedAt: NOW, deletedAt: null, ...extra })
function leg(id: string, tripId: string, date: string, role: Leg['role'], sea: number, tidal = 0, night = 0, boat = 'Nepzon (Nepgoon 42)'): Leg {
  return {
    id, tripId, date, fromPlace: 'Nepa', fromCountry: '', toPlace: 'Nepb', toCountry: '', role, boat,
    nmInland: 0, nmSea: sea, nmTidal: tidal, nightHours: night, dateEstimated: false, source: 'manual', updatedAt: NOW, deletedAt: null,
  }
}

describe('vaste checklists', () => {
  it('meegeleverde lijsten per soort trip; afvinken op de trip; sjabloon bewerken en verwijderen met ongedaan maken', async () => {
    const all = effectiveChecklists([])
    expect(all).toHaveLength(SEED_CHECKLISTS.length)
    expect(checklistsFor(all, 'skipper-charter').map((c) => c.id)).toEqual(['seed-veiligheid', 'seed-check-in', 'seed-check-out', 'seed-paklijst-charter'])
    expect(checklistsFor(all, 'delivery').map((c) => c.id)).toEqual(['seed-paklijst-tocht'])
    expect(SEED_CHECKLISTS.every((c) => c.items.every((i) => i.text.nl && i.text.en))).toBe(true)

    const store = await device()
    const t1 = trip('t1', { type: 'skipper-charter' })
    await store.put('trips.json.enc', t1)
    const briefing = all[0]!
    await toggleCheck(store, t1, briefing.id, briefing.items[0]!.id)
    await toggleCheck(store, t1, briefing.id, briefing.items[1]!.id)
    await toggleCheck(store, t1, briefing.id, briefing.items[0]!.id)
    const saved = store.get('trips.json.enc')[0]!
    expect([...checkedItems(saved, briefing)]).toEqual([briefing.items[1]!.id])

    // Sjabloon: eerste punt anders (alleen in het Nederlands), tweede weg, nieuw punt erbij.
    await saveChecklist(store, briefing, { title: 'Nepbriefing', items: [{ id: briefing.items[0]!.id, text: 'Nepvesten' }, { text: 'Nieuw nep-punt' }] }, 'nl')
    const edited = effectiveChecklists(store.get('checklists.json.enc'))[0]!
    expect(edited).toMatchObject({ id: 'seed-veiligheid', source: 'seed', title: { nl: 'Nepbriefing', en: 'Guest safety briefing' } })
    expect(edited.items[0]!.text).toEqual({ nl: 'Nepvesten', en: briefing.items[0]!.text.en })
    expect(edited.items[1]!.text).toEqual({ nl: 'Nieuw nep-punt', en: 'Nieuw nep-punt' })
    // Het afgevinkte punt bestaat niet meer: telt niet mee.
    expect(checkedItems(saved, edited).size).toBe(0)

    const own = await addChecklist(store, 'Nep eigen lijst', 'delivery')
    expect(checklistsFor(effectiveChecklists(store.get('checklists.json.enc')), 'delivery').map((c) => c.id)).toContain(own.id)
    const undo = await deleteChecklist(store, edited)
    expect(effectiveChecklists(store.get('checklists.json.enc')).some((c) => c.id === 'seed-veiligheid')).toBe(false)
    await undo()
    expect(effectiveChecklists(store.get('checklists.json.enc')).some((c) => c.id === 'seed-veiligheid')).toBe(true)
  })
})

describe('trip afsluiten', () => {
  it('cijfer en één zin "wat leerde ik" naast de review van gasten', async () => {
    const store = await device()
    const t1 = trip('t1', { startDate: '2026-10-01', endDate: '2026-10-07' })
    await store.put('trips.json.enc', t1)
    await closeWeek(store, t1, { quotes: [' '], rating: 8, lesson: '  Nep: eerder reven.  ' }, '2026-10-08', DEFAULT_SETTINGS)
    expect(store.get('trips.json.enc')[0]).toMatchObject({ closedAt: '2026-10-08', review: { quotes: [], rating: 8, lesson: 'Nep: eerder reven.' } })
    await closeWeek(store, t1, { quotes: [], rating: 11 }, '2026-10-08', DEFAULT_SETTINGS)
    expect(store.get('trips.json.enc')[0]!.review?.rating).toBeUndefined()
  })
})

describe('zeiltijd exporteren', () => {
  const trips = [trip('a', { boat: 'Nepster', boatModel: 'Nepcat 45', boatLengthFt: 45 }), trip('b')]
  const legs = [
    leg('1', 'a', '2026-01-01', 'schipper', 20, 0, 2),
    leg('2', 'a', '2026-01-02', 'schipper', 10, 5),
    leg('3', 'b', '2026-02-01', 'trainee', 30, 0, 6),
    leg('4', 'b', '2026-03-01', 'schipper', 0, 12),
  ]

  it('per dag en per trip met boot, model en lengte; totalen per rol', () => {
    const data = sailtime(trips, legs, { from: '', to: '', role: '' })
    expect(data.days[0]).toMatchObject({ date: '2026-01-01', boat: 'Nepster', model: 'Nepcat 45', lengthFt: 45, nm: 20, night: 2 })
    // Zonder bootgegevens op de trip: naam en model uit de kolom Schip.
    expect(data.days[2]).toMatchObject({ boat: 'Nepzon', model: 'Nepgoon 42' })
    expect(data.trips).toMatchObject([
      { id: 'a', days: 2, nm: 35, tidal: 5, night: 2, roles: ['schipper'] },
      { id: 'b', days: 2, nm: 42, tidal: 12, night: 6, roles: ['trainee', 'schipper'] },
    ])
    expect(data.totals).toEqual([
      { role: 'schipper', days: 3, nm: 47, tidal: 17, night: 2 },
      { role: 'trainee', days: 1, nm: 30, tidal: 0, night: 6 },
    ])
    expect(data.total).toEqual({ days: 4, nm: 77, tidal: 17, night: 8 })
  })

  it('filter op periode en rol', () => {
    const data = sailtime(trips, legs, { from: '2026-01-02', to: '2026-02-28', role: 'schipper' })
    expect(data.days.map((d) => d.id)).toEqual(['2'])
    expect(data.total).toEqual({ days: 1, nm: 15, tidal: 5, night: 0 })
  })
})
