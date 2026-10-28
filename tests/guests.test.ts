import { describe, expect, it } from 'vitest'
import { cleanTipFrom, guestLabel, needsDistinction, participantName, returningGuests, splitTotal, tipShares, tipsPerCountry, tipsPerGuest, tipsPerTrip, tipsPerTripType } from '../src/model/guests'
import { cleanParticipants } from '../src/model/weeks'
import { draftFromTip, draftTotal, tipFromDraft, totalWhenLeavingSplit } from '../src/model/tip-draft'
import type { Participant, Transaction, Trip } from '../src/model/types'

// Gasten en fooi per persoon (regel 14: voornaam, optioneel land en kort kenmerk). Alle namen verzonnen.

const NOW = '2026-10-01T10:00:00.000Z'
const p = (id: string, firstName: string, extra: Partial<Participant> = {}): Participant => ({ id, firstName, ...extra })
const trip = (id: string, startDate: string, participants: Participant[], extra: Partial<Trip> = {}): Trip => ({ id, name: `Nep ${id}`, startDate, endDate: startDate, participants, updatedAt: NOW, deletedAt: null, ...extra })
const tip = (id: string, tripId: string, amount: number, tipFrom?: Transaction['tipFrom'], currency: Transaction['currency'] = 'EUR'): Transaction => ({
  id,
  date: '2027-03-10',
  kind: 'fooi',
  amount,
  currency,
  ...(currency === 'EUR' ? { amountEur: amount } : {}),
  source: 'yacht-week',
  tripId,
  ...(tipFrom ? { tipFrom } : {}),
  updatedAt: NOW,
  deletedAt: null,
})

describe('namen', () => {
  it('dubbele voornaam: "Nick B." met kenmerk, "Nick (VS)" met land; anders gewoon de voornaam', () => {
    const all = [p('1', 'Nick', { tag: 'B' }), p('2', 'nick', { country: 'VS' }), p('3', 'Nepanna', { country: 'NL' })]
    expect(all.map((x) => participantName(x, all))).toEqual(['Nick B.', 'nick (VS)', 'Nepanna'])
    expect(guestLabel(all[2]!)).toBe('Nepanna (NL)')
    expect(guestLabel(p('4', 'Nepbob', { tag: 'Bobby', country: 'Duitsland' }))).toBe('Nepbob Bobby (Duitsland)')
  })

  it('vraagt om land of kenmerk zolang twee namen niet uit elkaar te houden zijn', () => {
    expect([...needsDistinction([p('1', 'Nick'), p('2', 'Nick '), p('3', 'Nepanna'), p('4', '')])]).toEqual([0, 1])
    expect([...needsDistinction([p('1', 'Nick', { country: 'VS' }), p('2', 'Nick', { country: 'VS' })])]).toEqual([0, 1])
    expect([...needsDistinction([p('1', 'Nick', { country: 'VS' }), p('2', 'Nick', { tag: 'B' })])]).toEqual([])
    expect([...needsDistinction([p('1', 'Nick', { country: 'VS' }), p('2', 'Nick')])]).toEqual([1])
  })

  it('opslaan bewaart alleen voornaam, niveau, cursus, land, kenmerk en de koppeling', () => {
    const [clean] = cleanParticipants([{ id: 'x', firstName: ' Nick ', country: ' VS ', tag: 'B', guestId: 'g', ...({ lastName: 'Geheim', phone: '06' } as object) }])
    expect(clean).toEqual({ id: 'x', firstName: 'Nick', country: 'VS', tag: 'B', guestId: 'g' })
    expect(cleanParticipants([{ firstName: 'Nep', country: 'x'.repeat(50), tag: 'y'.repeat(30) }])[0]).toMatchObject({ country: 'x'.repeat(30), tag: 'y'.repeat(12) })
  })
})

describe('terugkerende gasten', () => {
  it('zelfde voornaam en land in een eerdere trip: vragen; na ja of nee niet meer', () => {
    const older = trip('a', '2026-06-01', [p('a1', 'Nick', { country: 'VS' }), p('a2', 'Nepanna')])
    const newer = trip('b', '2027-03-06', [p('b1', 'nick', { country: 'vs' }), p('b2', 'Nepanna'), p('b3', 'Nick', { country: 'NL' })])
    const found = returningGuests(newer, [older, newer], [])
    expect(found.map((r) => [r.participant.id, r.previousTrip.id, r.previous.id])).toEqual([['b1', 'a', 'a1']])
    const answered = { ...newer, participants: newer.participants!.map((x) => (x.id === 'b1' ? { ...x, guestId: 'a1' } : x)) }
    expect(returningGuests(answered, [older, answered], [])).toEqual([])
    // Een latere trip vraagt niet terug naar een nog latere.
    expect(returningGuests(older, [older, newer], [])).toEqual([])
  })

  it('twee verschillende kenmerken zijn twee mensen; een al gekoppelde eerdere gast niet nog eens', () => {
    const older = trip('a', '2026-06-01', [p('a1', 'Nick', { country: 'VS', tag: 'K' }), p('a2', 'Nick', { country: 'VS', tag: 'B' })])
    const newer = trip('b', '2027-03-06', [p('b1', 'Nick', { country: 'VS', tag: 'B' })])
    expect(returningGuests(newer, [older, newer], []).map((r) => r.previous.id)).toEqual(['a2'])
    const one = trip('c', '2026-06-01', [p('c1', 'Nick', { country: 'VS' })])
    const both = trip('d', '2027-03-06', [p('d1', 'Nick', { country: 'VS', tag: 'B', guestId: 'c1' }), p('d2', 'Nick', { country: 'VS', tag: 'Z' })])
    expect(returningGuests(both, [one, both], [])).toEqual([])
  })
})

describe('fooi per persoon', () => {
  const t1 = trip('a', '2026-06-01', [p('a1', 'Nick', { country: 'VS' }), p('a2', 'Nepanna', { country: 'NL' }), p('a3', 'Nepbob')], { type: 'skipper-charter' })
  const t2 = trip('b', '2027-03-06', [p('b1', 'Nick', { country: 'VS', guestId: 'a1' }), p('b2', 'Nepcees', { country: 'NL' })], { type: 'training-geven' })

  it('controleert personen en bedragen tegen de deelnemers', () => {
    expect(cleanTipFrom({ kind: 'onbekend' }, t1.participants!)).toBeUndefined()
    expect(cleanTipFrom({ kind: 'personen', participantIds: ['zz'] }, t1.participants!)).toBeUndefined()
    expect(cleanTipFrom({ kind: 'personen', participantIds: ['a1', 'a1', 'zz'], amounts: { a1: 10 } }, t1.participants!)).toEqual({ kind: 'personen', participantIds: ['a1'] })
    expect(cleanTipFrom({ kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 10.004, a2: -1 } }, t1.participants!)).toEqual({ kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 10 } })
    expect(splitTotal({ a: 10.1, b: 20.2 })).toBe(30.3)
  })

  it('per persoon, samen gegeven, hele groep en onbekend', () => {
    const share = (tx: Transaction) => Object.fromEntries(tipShares(tx, t1) ?? [])
    expect(share(tip('1', 'a', 60, { kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 40, a2: 20 } }))).toEqual({ a1: 40, a2: 20 })
    expect(share(tip('2', 'a', 60, { kind: 'personen', participantIds: ['a1', 'a2'] }))).toEqual({ a1: 30, a2: 30 })
    expect(share(tip('3', 'a', 60, { kind: 'groep' }))).toEqual({ a1: 20, a2: 20, a3: 20 })
    expect(share(tip('4', 'a', 60))).toEqual({})
    // Zonder koers: niet omrekenen.
    expect(tipShares(tip('5', 'a', 60, { kind: 'groep' }, 'XCD'), t1)).toBeNull()
  })

  it('een persoon die niet meer bij de trip hoort: zijn deel telt als onbekend, niet bij de anderen', () => {
    const smaller = { ...t1, participants: t1.participants!.filter((x) => x.id !== 'a2') }
    const share = (tx: Transaction) => Object.fromEntries(tipShares(tx, smaller) ?? [])
    expect(share(tip('1', 'a', 50, { kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 30, a2: 20 } }))).toEqual({ a1: 30 })
    expect(share(tip('2', 'a', 50, { kind: 'personen', participantIds: ['a1', 'a2'] }))).toEqual({ a1: 25 })
    // Bewerken: alleen de huidige deelnemers staan nog in de keuze.
    const draft = draftFromTip({ kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 30, a2: 20 } }, smaller.participants!)
    expect(draft).toEqual({ kind: 'personen', ids: ['a1'], split: false, amounts: { a1: '30' } })
    expect(tipFromDraft(draft, smaller.participants!)).toEqual({ kind: 'personen', participantIds: ['a1'] })
  })

  it('per persoon invoeren: het totaal is de som, en blijft staan bij teruggaan naar samen gegeven', () => {
    const split = { kind: 'personen' as const, ids: ['a1', 'a2'], split: true, amounts: { a1: '12,5', a2: '7,5' } }
    expect(draftTotal(split)).toBe(20)
    expect(draftTotal({ ...split, amounts: { a1: '12,5' } })).toBeNull()
    expect(totalWhenLeavingSplit(split, { ...split, split: false })).toBe(20)
    expect(totalWhenLeavingSplit({ ...split, split: false }, split)).toBeNull()
    expect(tipFromDraft(split, t1.participants!)).toEqual({ kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 12.5, a2: 7.5 } })
  })

  it('overzichten: per gast (terugkerend samen), per trip, per soort trip en per land', () => {
    const txs = [
      tip('1', 'a', 60, { kind: 'personen', participantIds: ['a1', 'a2'], amounts: { a1: 40, a2: 20 } }),
      tip('2', 'a', 30, { kind: 'groep' }),
      tip('3', 'a', 15),
      tip('4', 'b', 50, { kind: 'personen', participantIds: ['b1'] }),
    ]
    const guests = tipsPerGuest([t1, t2], txs)
    expect(guests.map((g) => [g.label, g.trips, g.eur])).toEqual([
      ['Nick (VS)', 2, 100],
      ['Nepanna (NL)', 1, 30],
      ['Nepbob', 1, 10],
    ])
    const perTrip = tipsPerTrip([t1, t2], txs, [])
    expect(perTrip.map((t) => [t.trip.id, t.guests, t.eur, t.perGuest])).toEqual([
      ['b', 2, 50, 25],
      ['a', 3, 105, 35],
    ])
    expect(tipsPerTripType(perTrip).map((g) => [g.key, g.perGuest])).toEqual([
      ['skipper-charter', 35],
      ['training-geven', 25],
    ])
    expect(tipsPerCountry([t1, t2], txs).map((g) => [g.label, g.guests, g.eur, g.perGuest])).toEqual([
      ['VS', 1, 100, 100],
      ['NL', 1, 30, 30],
      ['', 1, 10, 10],
    ])
  })
})
