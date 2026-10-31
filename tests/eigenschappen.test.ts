import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { landperiodeZetten } from '../src/domain/agenda'
import type { Undo } from '../src/domain/commit'
import { dagBewerken, dagLoggen, dagVerwijderen } from '../src/domain/dagen'
import { geldToevoegen, geldVerwijderen } from '../src/domain/geld'
import { gezondheidHerstellen } from '../src/domain/gezondheid'
import { hardViolations, violations } from '../src/domain/invariants'
import { geschiedenisTerugzetten, terugzetten } from '../src/domain/prullenbak'
import { periodeMaken, periodeVervangen, periodeVerwijderen, samenvoegen } from '../src/domain/trips'
import { addDays } from '../src/basis/datum'
import { historyRows } from '../src/model/history-view'
import { trashItems } from '../src/model/trash'
import type { CollectionPath, StayKind, StayPeriod, SyncRecord, Transaction } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Eigenschappen over duizenden willekeurige reeksen acties (PR 4, docs/FUNDERING.md): na elke opdracht
// - geen nieuwe harde overtreding (src/domain/invariants.ts);
// - nooit stil verhuizen: een dag of geld krijgt alleen een andere periode door een opdracht die dat zegt;
// - nooit stil kwijt: een dag of geld verdwijnt alleen door een opdracht die verwijdert;
// - ongedaan maken direct erna zet alles precies terug;
// en met twee apparaten (ook zonder verbinding) komen beide na syncen op hetzelfde uit. Een vast zaad per reeks: een
// fout is altijd na te spelen (de melding noemt het zaad). Meer reeksen: EIGENSCHAPPEN=5000 npx vitest run tests/eigenschappen.

const RUNS = Number(process.env.EIGENSCHAPPEN ?? 2000)
const TWO_DEVICE_RUNS = Math.max(20, Math.round(RUNS / 10))
const STEPS = 14
const TOKEN = 'github_pat_EIGENSCHAPPEN_0123456789abcdefghijklmnopqrstuv'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

/** Klein, vast pseudo-toeval (mulberry32): dezelfde reeks bij hetzelfde zaad. */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(list: readonly T[]): T | undefined => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    chance: (p: number) => next() < p,
  }
}

async function device(github: FakeGithub): Promise<Store> {
  return Store.open(await openLogboekDb(`logboek-eigenschappen-${++counter}`), masterKey, new GithubClient(TOKEN, github.fetch))
}

const START = '2026-10-01'
const date = (r: ReturnType<typeof random>) => addDays(START, r.int(40))

/** Opdrachten die een dag of geld naar een andere periode mogen zetten (Olivier kiest dat zelf). */
const MOVES = new Set(['samenvoegen', 'periodeVervangen', 'terugzetten', 'geschiedenisTerugzetten', 'ongedaanMaken', 'dagBewerken'])
/** Opdrachten die een dag of geld mogen weghalen. */
const REMOVES = new Set(['dagVerwijderen', 'geldVerwijderen', 'periodeVerwijderen', 'geschiedenisTerugzetten', 'ongedaanMaken', 'terugzetten'])

type Snapshot = Map<string, SyncRecord>
const WATCHED: readonly CollectionPath[] = ['trips.json.enc', 'legs.json.enc', 'transactions.json.enc', 'periods.json.enc', 'calendar.json.enc', 'students.json.enc', 'settings.json.enc']

function snapshot(s: Store): Snapshot {
  const out: Snapshot = new Map()
  for (const path of WATCHED) for (const r of s.list(path)) out.set(`${path}\n${r.id}`, r)
  return out
}

/** Inhoud zonder updatedAt, los van de volgorde van de velden. */
const strip = (r: SyncRecord | undefined) => (r ? JSON.stringify(Object.fromEntries(Object.entries({ ...r, updatedAt: '' }).sort(([x], [y]) => (x < y ? -1 : 1)))) : undefined)

/** Een willekeurige opdracht; geeft de naam en ongedaan maken terug (of null als er niets te doen was). */
async function act(s: Store, r: ReturnType<typeof random>): Promise<{ name: string; undo: Undo } | null> {
  const trips = s.list('trips.json.enc')
  const legs = s.list('legs.json.enc')
  const money = s.list('transactions.json.enc')
  switch (r.int(12) % 11) {
    case 0: {
      const { undo } = await periodeMaken(s, { name: `Nep ${r.int(99)}`, type: 'skipper-charter', startDate: date(r), dayCount: 1 + r.int(8), boat: '', boatModel: '', boatLengthFt: null, base: '', charter: '', area: '', participants: [], note: '' }, 'nl', START)
      return { name: 'periodeMaken', undo }
    }
    case 1:
    case 2: {
      const { undo } = await dagLoggen(s, { date: date(r), tripId: r.chance(0.7) ? (r.pick(trips)?.id ?? null) : null, newTripName: 'Nep dag', fromPlace: 'Nephaven', toPlace: 'Nepbaai', role: 'schipper', boat: '', water: 'zee', nm: r.int(30), nightHours: 0, wind: '', notes: '' })
      return { name: 'dagLoggen', undo }
    }
    case 3: {
      // Zoals in het echt: geld meestal op een datum binnen zijn periode.
      const periods = [...trips.filter((t) => t.startDate && t.endDate).map((t) => ({ id: t.id, start: t.startDate!, end: t.endDate! })), ...s.list('periods.json.enc').map((p) => ({ id: p.id, start: p.startDate, end: p.endDate }))]
      const period = r.chance(0.85) ? r.pick(periods) : undefined
      const on = period ? addDays(period.start, r.int(Math.max(1, Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86_400_000) + 1))) : date(r)
      const { undo } = await geldToevoegen(s, { date: on, kind: r.chance(0.6) ? 'kosten' : 'fooi', amount: 1 + r.int(200), currency: 'EUR', source: 'overig' }, period?.id ?? null)
      return { name: 'geldToevoegen', undo }
    }
    case 4: {
      const leg = r.pick(legs)
      return leg ? { name: 'dagVerwijderen', undo: await dagVerwijderen(s, leg) } : null
    }
    case 5: {
      const tx = r.pick(money)
      return tx ? { name: 'geldVerwijderen', undo: await geldVerwijderen(s, tx) } : null
    }
    case 6: {
      const trip = r.pick(trips)
      return trip ? { name: 'periodeVerwijderen', undo: await periodeVerwijderen(s, trip, r.chance(0.5) ? 'behouden' : 'alles') } : null
    }
    case 7: {
      const from = date(r)
      const days = Array.from({ length: 1 + r.int(6) }, (_, i) => addDays(from, i))
      const kind = r.pick<StayKind | null>(['thuis', 'reis', 'vrij', null]) ?? null
      return { name: 'landperiodeZetten', undo: await landperiodeZetten(s, days, kind) }
    }
    case 8: {
      const [a, b] = [r.pick(trips), r.pick(trips)]
      if (!a || !b || a.id === b.id) return null
      return r.chance(0.5) ? { name: 'samenvoegen', undo: await samenvoegen(s, a, b) } : { name: 'periodeVervangen', undo: await periodeVervangen(s, a, b) }
    }
    case 9: {
      const item = r.pick(trashItems(s))
      if (item) return { name: 'terugzetten', undo: (await terugzetten(s, item.key)).undo }
      const row = r.pick(historyRows(s).filter((x) => !x.entry.undoneAt))
      return row ? { name: 'geschiedenisTerugzetten', undo: await geschiedenisTerugzetten(s, row.entry.id) } : null
    }
    default: {
      const leg = r.pick(legs)
      if (!leg) return null
      const { id: _i, updatedAt: _u, deletedAt: _d, source: _s, dateEstimated: _e, tripId, ...patch } = leg
      void [_i, _u, _d, _s, _e]
      return { name: 'dagBewerken', undo: await dagBewerken(s, leg, { ...patch, date: date(r), nmSea: r.int(20) }, { id: tripId }) }
    }
  }
}

/**
 * Geld op een dag die dezelfde soort aan land houdt maar een ander id krijgt (een periode gesplitst, of samengegaan met
 * een buurperiode van dezelfde soort): dezelfde periode, dus het geld gaat mee (src/model/periods.ts, stayDayChanges).
 */
function continued(before: Snapshot, after: Snapshot, was: Transaction, now: Transaction): boolean {
  const stay = (snap: Snapshot, id: string | undefined) => (id ? (snap.get(`periods.json.enc\n${id}`) as StayPeriod | undefined) : undefined)
  const from = stay(before, was.tripId)
  const to = stay(after, now.tripId)
  const within = (p: StayPeriod | undefined, d: string) => !!p && p.deletedAt === null && p.startDate <= d && d <= p.endDate
  const stillThere = stay(after, was.tripId)
  return !!from && !!to && from.kind === to.kind && within(from, was.date) && within(to, now.date) && !within(stillThere, now.date)
}

function checkStep(seed: number, step: number, name: string, before: Snapshot, after: Snapshot): void {
  const where = `zaad ${seed}, stap ${step}, ${name}`
  for (const [key, was] of before) {
    const path = key.split('\n')[0]
    if (path !== 'legs.json.enc' && path !== 'transactions.json.enc') continue
    const now = after.get(key) as (SyncRecord & { tripId?: string }) | undefined
    if (!now) expect(REMOVES.has(name), `${where}: ${path} verdween stil`).toBe(true)
    else if (now.tripId !== (was as SyncRecord & { tripId?: string }).tripId) expect(MOVES.has(name) || continued(before, after, was as Transaction, now as Transaction), `${where}: ${path} verhuisde stil`).toBe(true)
  }
}

describe('eigenschappen (willekeurige reeksen)', () => {
  it(`${RUNS} reeksen op één apparaat: geen harde overtreding, niets stil verhuisd of kwijt, ongedaan maken precies terug`, async () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = random(seed)
      const s = await device(new FakeGithub())
      for (let step = 0; step < STEPS; step++) {
        const before = snapshot(s)
        const done = await act(s, r)
        if (!done) continue
        const after = snapshot(s)
        checkStep(seed, step, done.name, before, after)
        expect(hardViolations(s), `zaad ${seed}, stap ${step}, ${done.name}`).toEqual([])
        // Soms direct ongedaan maken: alles weer zoals vooraf (los van updatedAt).
        if (r.chance(0.2)) {
          await done.undo()
          const back = snapshot(s)
          const changed = [...new Set([...before.keys(), ...back.keys()])].filter((k) => !k.startsWith('settings') && strip(before.get(k)) !== strip(back.get(k)))
          expect(changed, `zaad ${seed}, stap ${step}: ongedaan maken van ${done.name}`).toEqual([])
        }
      }
      s.lock()
    }
  }, 600_000)

  it(`${TWO_DEVICE_RUNS} reeksen op twee apparaten, ook zonder verbinding: na syncen hetzelfde, en de gezondheidscheck lost op wat tegelijk gebeurde`, async () => {
    for (let seed = 1; seed <= TWO_DEVICE_RUNS; seed++) {
      const r = random(10_000 + seed)
      const github = new FakeGithub()
      const a = await device(github)
      const b = await device(github)
      for (let step = 0; step < STEPS; step++) {
        github.offline = r.chance(0.3)
        const s = r.chance(0.5) ? a : b
        if (r.chance(0.25)) await s.sync()
        else await act(s, r)
      }
      github.offline = false
      for (let i = 0; i < 3; i++) {
        await a.sync()
        await b.sync()
      }
      for (const path of WATCHED) {
        const ids = (s: Store) => s.list(path).map((x) => strip(x)).sort()
        expect(ids(b), `zaad ${10_000 + seed}: ${path} verschilt tussen de apparaten`).toEqual(ids(a))
      }
      // Wat twee apparaten tegelijk deden (bijvoorbeeld twee periodes aan land op dezelfde dagen) lost de check op.
      for (const x of hardViolations(a)) await gezondheidHerstellen(a, x)
      expect(hardViolations(a).filter((x) => x.rule === 'land-overlap'), `zaad ${10_000 + seed}`).toEqual([])
      expect(violations(a).every((x) => typeof x.key === 'string')).toBe(true)
      a.lock()
      b.lock()
    }
  }, 600_000)
})
