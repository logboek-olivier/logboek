import type { Store } from '../storage/store'
import { active } from './derive'
import { eurOf, round2 } from './money'
import { weekView } from './weeks'
import type { Leg, Participant, TipFrom, Transaction, Trip, WeekType } from './types'

// Gasten en fooi per persoon (regel 14): een deelnemer heeft alleen een voornaam, optioneel een land en optioneel een
// kort kenmerk (initiaal of bijnaam). Dubbele voornamen binnen een trip worden "Nick B." of "Nick (VS)". Een fooi komt
// van één of meer personen (per persoon een bedrag of samen gegeven), van de hele groep, of van onbekend. Terugkerende
// gasten worden pas gekoppeld als Olivier "ja" zegt op "Is dit dezelfde persoon als in <trip>?".

export const MAX_COUNTRY = 30
export const MAX_TAG = 12

/** Vergelijken zonder hoofdletters, accenten, punten en dubbele spaties ("Nick B." = "nick b"). */
export function norm(text: string | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type Named = Pick<Participant, 'firstName' | 'tag' | 'country'>

function tagText(tag: string): string {
  const clean = tag.trim()
  // Eén letter is een initiaal: "B" → "B.".
  return /^\p{L}$/u.test(clean) ? `${clean.toUpperCase()}.` : clean
}

/** Naam binnen een trip: de voornaam, bij een dubbele voornaam met kenmerk ("Nick B.") of land ("Nick (VS)"). */
export function participantName(p: Named, all: readonly Named[]): string {
  const first = p.firstName.trim()
  const duplicate = all.filter((o) => norm(o.firstName) === norm(first)).length > 1
  if (!duplicate) return first
  if (p.tag?.trim()) return `${first} ${tagText(p.tag)}`
  if (p.country?.trim()) return `${first} (${p.country.trim()})`
  return first
}

/** Naam in overzichten over trips heen: voornaam, kenmerk en land. */
export function guestLabel(p: Named): string {
  const name = [p.firstName.trim(), p.tag?.trim() ? tagText(p.tag) : ''].filter(Boolean).join(' ')
  return p.country?.trim() ? `${name} (${p.country.trim()})` : name
}

/**
 * Regels (index) met een dubbele voornaam zonder land of kenmerk, of met dezelfde naam als een andere regel: daar
 * vraagt de app om land of kenmerk.
 */
export function needsDistinction(rows: readonly Named[]): Set<number> {
  const out = new Set<number>()
  const filled = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.firstName.trim() !== '')
  const names = filled.map(({ r }) => r)
  for (const { r, i } of filled) {
    const twins = filled.filter(({ r: o, i: j }) => j !== i && norm(o.firstName) === norm(r.firstName))
    if (twins.length === 0) continue
    const label = norm(participantName(r, names))
    if ((!r.tag?.trim() && !r.country?.trim()) || twins.some(({ r: o }) => norm(participantName(o, names)) === label)) out.add(i)
  }
  return out
}

/** Een gast over trips heen: het gekoppelde id, anders het eigen id. */
export function guestKey(p: Participant): string {
  return p.guestId ?? p.id
}

export interface ReturningGuest {
  participant: Participant
  previousTrip: Trip
  previous: Participant
}

/**
 * Terugkerende gasten in deze trip: een deelnemer met dezelfde voornaam en hetzelfde land als een deelnemer van een
 * eerdere trip, waarover nog niets gevraagd is. Per deelnemer de meest recente eerdere trip.
 */
export function returningGuests(trip: Trip, trips: readonly Trip[], legs: readonly Leg[]): ReturningGuest[] {
  const start = weekView(trip, legs).startDate
  const earlier = active(trips)
    .filter((t) => t.id !== trip.id)
    .map((t) => ({ trip: t, start: weekView(t, legs).startDate }))
    .filter((x) => !start || !x.start || x.start < start)
    .sort((a, b) => (a.start < b.start ? 1 : -1))
  const own = trip.participants ?? []
  // Een eerdere gast die al aan iemand in deze trip gekoppeld is, komt niet nog eens in aanmerking.
  const used = new Set(own.filter((p) => p.guestId && p.guestId !== p.id).map((p) => p.guestId!))
  const out: ReturningGuest[] = []
  for (const p of own) {
    if (p.guestId || !p.country?.trim()) continue
    for (const { trip: t } of earlier) {
      const previous = (t.participants ?? []).find(
        (q) =>
          norm(q.firstName) === norm(p.firstName) &&
          norm(q.country) === norm(p.country) &&
          // Twee verschillende kenmerken ("Nick B." en "Nick K.") zijn twee mensen.
          !(q.tag?.trim() && p.tag?.trim() && norm(q.tag) !== norm(p.tag)) &&
          guestKey(q) !== p.id &&
          !used.has(guestKey(q)),
      )
      if (previous) {
        out.push({ participant: p, previousTrip: t, previous })
        break
      }
    }
  }
  return out
}

/** Antwoord op "Is dit dezelfde persoon?": ja koppelt aan de eerdere gast, nee onthoudt dat het iemand anders is. */
export async function answerReturning(store: Store, tripId: string, participantId: string, same: Participant | null): Promise<void> {
  const trip = store.list('trips.json.enc').find((t) => t.id === tripId)
  if (!trip) return
  // Al aan iemand anders in deze trip gekoppeld (twee keer "ja" op dezelfde eerdere gast): niet nog eens koppelen.
  const taken = !!same && (trip.participants ?? []).some((p) => p.id !== participantId && p.guestId === guestKey(same))
  const participants = (trip.participants ?? []).map((p) => (p.id === participantId ? { ...p, guestId: same && !taken ? guestKey(same) : p.id } : p))
  await store.put('trips.json.enc', { ...trip, participants, updatedAt: new Date().toISOString() })
  void store.sync()
}

// ---------- Fooi per persoon ----------

/** Een fooi controleren tegen de deelnemers van de trip: onbekende personen vallen weg, bedragen per persoon tellen op. */
export function cleanTipFrom(from: TipFrom | undefined, participants: readonly Participant[]): TipFrom | undefined {
  if (!from || from.kind === 'onbekend') return undefined
  if (from.kind === 'groep') return from
  const ids = [...new Set(from.participantIds)].filter((id) => participants.some((p) => p.id === id))
  if (ids.length === 0) return undefined
  if (!from.amounts || ids.length === 1) return { kind: 'personen', participantIds: ids }
  const amounts: Record<string, number> = {}
  for (const id of ids) {
    const a = from.amounts[id]
    if (a !== undefined && Number.isFinite(a) && a > 0) amounts[id] = round2(a)
  }
  return { kind: 'personen', participantIds: ids, ...(Object.keys(amounts).length > 0 ? { amounts } : {}) }
}

/** Totaal van de bedragen per persoon (het fooibedrag als Olivier per persoon invoert). */
export function splitTotal(amounts: Record<string, number>): number {
  return round2(Object.values(amounts).reduce((n, a) => n + a, 0))
}

/**
 * Fooi per deelnemer in EUR: per persoon het eigen bedrag, samen gegeven gelijk verdeeld, de hele groep gelijk over
 * alle deelnemers. Onbekend telt niet per persoon (wel in het totaal van de trip). Zonder koers: null.
 */
export function tipShares(tx: Transaction, trip: Trip | undefined): Map<string, number> | null {
  const eur = eurOf(tx)
  if (eur === null || tx.kind !== 'fooi') return null
  const participants = trip?.participants ?? []
  const from = tx.tipFrom
  const out = new Map<string, number>()
  if (!from || from.kind === 'onbekend') return out
  if (from.kind === 'groep') {
    for (const p of participants) out.set(p.id, eur / participants.length)
    return out
  }
  // Een persoon die niet meer bij de trip hoort: zijn deel telt als onbekend (gaat niet naar de anderen).
  const present = [...new Set(from.participantIds)].filter((id) => participants.some((p) => p.id === id))
  for (const id of present) {
    if (from.amounts) {
      const a = from.amounts[id] ?? 0
      if (a > 0 && tx.amount > 0) out.set(id, (a / tx.amount) * eur)
    } else out.set(id, eur / new Set(from.participantIds).size)
  }
  return out
}

export interface GuestTips {
  key: string
  label: string
  country: string
  trips: number
  eur: number
}

export interface TripTips {
  trip: Trip
  type: WeekType
  guests: number
  eur: number
  perGuest: number | null
}

export interface GroupTips {
  key: string
  label: string
  trips: number
  guests: number
  eur: number
  perGuest: number | null
}

const tips = (transactions: readonly Transaction[]) => active(transactions).filter((tx) => tx.kind === 'fooi')

/** Fooi per gast (terugkerende gasten samen), meeste eerst. */
export function tipsPerGuest(trips: readonly Trip[], transactions: readonly Transaction[]): GuestTips[] {
  const byId = new Map(active(trips).map((t) => [t.id, t]))
  const guests = new Map<string, GuestTips & { tripIds: Set<string> }>()
  for (const tx of tips(transactions)) {
    const trip = tx.tripId ? byId.get(tx.tripId) : undefined
    const shares = tipShares(tx, trip)
    if (!trip || !shares) continue
    for (const [id, eur] of shares) {
      const p = trip.participants?.find((x) => x.id === id)
      if (!p) continue
      const key = guestKey(p)
      const g = guests.get(key) ?? { key, label: guestLabel(p), country: p.country?.trim() ?? '', trips: 0, eur: 0, tripIds: new Set<string>() }
      g.eur += eur
      g.tripIds.add(trip.id)
      guests.set(key, g)
    }
  }
  return [...guests.values()].map(({ tripIds, ...g }) => ({ ...g, trips: tripIds.size, eur: round2(g.eur) })).sort((a, b) => b.eur - a.eur || a.label.localeCompare(b.label))
}

/** Fooi per trip en het gemiddelde per gast (alle fooien van de trip, ook van onbekend), nieuwste trip eerst. */
export function tipsPerTrip(trips: readonly Trip[], transactions: readonly Transaction[], legs: readonly Leg[]): TripTips[] {
  const sums = new Map<string, number>()
  for (const tx of tips(transactions)) {
    const eur = eurOf(tx)
    if (eur === null || !tx.tripId) continue
    sums.set(tx.tripId, (sums.get(tx.tripId) ?? 0) + eur)
  }
  return active(trips)
    .filter((t) => sums.has(t.id))
    .map((trip) => {
      const view = weekView(trip, legs)
      const guests = trip.participants?.length ?? 0
      const eur = round2(sums.get(trip.id)!)
      return { tip: { trip, type: view.type, guests, eur, perGuest: guests > 0 ? round2(eur / guests) : null }, start: view.startDate }
    })
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .map((x) => x.tip)
}

/** Gemiddelde fooi per gast per soort trip (alleen trips met deelnemers). */
export function tipsPerTripType(perTrip: readonly TripTips[]): GroupTips[] {
  const groups = new Map<WeekType, GroupTips>()
  for (const t of perTrip) {
    if (t.guests === 0) continue
    const g = groups.get(t.type) ?? { key: t.type, label: t.type, trips: 0, guests: 0, eur: 0, perGuest: null }
    g.trips++
    g.guests += t.guests
    g.eur += t.eur
    groups.set(t.type, g)
  }
  return [...groups.values()].map((g) => ({ ...g, eur: round2(g.eur), perGuest: round2(g.eur / g.guests) })).sort((a, b) => (b.perGuest ?? 0) - (a.perGuest ?? 0))
}

/** Fooi per land: totaal van de gasten uit dat land en het gemiddelde per gast. Gasten zonder land staan apart. */
export function tipsPerCountry(trips: readonly Trip[], transactions: readonly Transaction[]): GroupTips[] {
  const groups = new Map<string, GroupTips & { guestKeys: Set<string>; tripIds: Set<string> }>()
  const byId = new Map(active(trips).map((t) => [t.id, t]))
  for (const tx of tips(transactions)) {
    const trip = tx.tripId ? byId.get(tx.tripId) : undefined
    const shares = tipShares(tx, trip)
    if (!trip || !shares) continue
    for (const [id, eur] of shares) {
      const p = trip.participants?.find((x) => x.id === id)
      if (!p) continue
      const key = norm(p.country)
      const g = groups.get(key) ?? { key, label: p.country?.trim() ?? '', trips: 0, guests: 0, eur: 0, perGuest: null, guestKeys: new Set<string>(), tripIds: new Set<string>() }
      g.eur += eur
      g.guestKeys.add(guestKey(p))
      g.tripIds.add(trip.id)
      groups.set(key, g)
    }
  }
  return [...groups.values()]
    .map(({ guestKeys, tripIds, ...g }) => ({ ...g, guests: guestKeys.size, trips: tripIds.size, eur: round2(g.eur), perGuest: round2(g.eur / Math.max(1, guestKeys.size)) }))
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.eur - a.eur))
}

/** Alle landen die Olivier al gebruikte (voor suggesties), meest gebruikt eerst. */
export function usedCountries(trips: readonly Trip[]): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const t of active(trips)) {
    for (const p of t.participants ?? []) {
      const label = p.country?.trim()
      if (!label) continue
      const c = counts.get(norm(label)) ?? { label, n: 0 }
      c.n++
      counts.set(norm(label), c)
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.label)
}

