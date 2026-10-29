import type { Store } from '../storage/store'
import { active } from './derive'
import { saveSettings } from './settings'
import type { BoatKind, Leg, Settings, Trip } from './types'
import { FEET_PER_METRE } from './weeks'

// Boten uit de mijlenregistratie. De kolom "Schip" is meestal "Naam (Model)", soms alleen een model ("Nepsport 680",
// "Nepaak 38ft") of alleen een naam. De bootlijst is afgeleid uit de trips: per trip de opgeslagen bootgegevens, en
// anders de boot uit de dagen. Een lengte uit het model is alleen een voorstel, nooit stil opgeslagen.

export interface ParsedShip {
  name: string
  model: string
}

/** "Naam (Model)" → naam en model; zonder haakjes is tekst met een getal een model, anders een naam. */
export function parseShip(raw: string): ParsedShip {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return { name: '', model: '' }
  const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(text)
  if (paren) return { name: paren[1]!.trim(), model: paren[2]!.trim() }
  return /\d/.test(text) ? { name: '', model: text } : { name: text, model: '' }
}

/**
 * Voorstel voor de lengte in voet uit het model: een getal met ft ("38ft", "48 ft"), een lengte in meter ("12 m"),
 * of een modelnummer: "4.2" = 42 ft (catamarans), "42" of "38.1" = 42 en 38 ft, "519" = 52 ft, en vanaf 600 een
 * lengte in centimeters ("680" = 6,8 m = 22 ft). Geen getal of buiten 10–120 ft: geen voorstel.
 */
export function suggestLengthFt(model: string): number | null {
  const text = model.replace(',', '.')
  const plausible = (ft: number) => (ft >= 10 && ft <= 120 ? Math.round(ft) : null)
  const feet = /(\d+(?:\.\d+)?)\s*(?:ft|feet|voet|')/i.exec(text)
  if (feet) return plausible(Number(feet[1]))
  const metres = /(\d+(?:\.\d+)?)\s*m\b/i.exec(text)
  if (metres) return plausible(Number(metres[1]) * FEET_PER_METRE)
  const number = /(?:^|\D)(\d{1,3})(?:\.(\d+))?(?!\d)/.exec(text)
  if (!number) return null
  const whole = number[1]!
  if (whole.length === 1 && number[2]) return plausible(Number(`${whole}.${number[2]}`) * 10)
  if (whole.length === 2) return plausible(Number(whole))
  if (whole.length === 3) {
    const n = Number(whole)
    return plausible(n >= 600 ? (n / 100) * FEET_PER_METRE : n / 10)
  }
  return null
}

const CATAMARANS = /\b(lagoon|bali|leopard|fountaine|nautitech|excess|seawind|catana|privilege|catamaran|cat)\b/i

/** Catamaran als het model een bekend catamaranmerk noemt; anders geen voorstel. */
export function suggestKind(model: string): BoatKind | undefined {
  return CATAMARANS.test(model) ? 'catamaran' : undefined
}

export interface BoatEntry {
  /** Naam en model zonder hoofdletters; hetzelfde schip in meerdere trips. */
  key: string
  name: string
  model: string
  lengthFt?: number
  kind?: BoatKind
  /** Voorstel uit het model (niet opgeslagen). */
  suggestedLengthFt: number | null
  suggestedKind?: BoatKind
  tripIds: string[]
  /** Laatste datum van een trip met deze boot, voor de volgorde. */
  lastDate: string
}

export function boatKey(name: string, model: string): string {
  return `${name.trim().toLowerCase()}|${model.trim().toLowerCase()}`
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) if (v.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** Naam en model van een trip: opgeslagen, anders uit de opgeslagen naam of de boot in de dagen. */
export function tripShip(trip: Trip, legs: readonly Leg[]): ParsedShip {
  if (trip.boatModel?.trim()) return { name: trip.boat?.trim() ?? '', model: trip.boatModel.trim() }
  // Een zelf getypte bootnaam blijft een naam (ook met een getal); alleen "Naam (Model)" wordt gesplitst.
  const own = trip.boat?.trim()
  if (own) return own.includes('(') ? parseShip(own) : { name: own, model: '' }
  return parseShip(mostCommon(legs.filter((l) => l.tripId === trip.id && l.deletedAt === null).map((l) => l.boat)))
}

/** De bootlijst: één regel per boot met de trips erbij, nieuwste eerst. */
export function boatList(trips: readonly Trip[], legs: readonly Leg[]): BoatEntry[] {
  const liveLegs = active(legs)
  const byKey = new Map<string, BoatEntry>()
  for (const trip of active(trips)) {
    const ship = tripShip(trip, liveLegs)
    if (!ship.name && !ship.model) continue
    const key = boatKey(ship.name, ship.model)
    const dates = liveLegs.filter((l) => l.tripId === trip.id).map((l) => l.date)
    const lastDate = [trip.endDate ?? '', ...dates].sort().at(-1) ?? ''
    const entry = byKey.get(key) ?? {
      key,
      name: ship.name,
      model: ship.model,
      suggestedLengthFt: suggestLengthFt(ship.model),
      suggestedKind: suggestKind(ship.model),
      tripIds: [],
      lastDate: '',
    }
    entry.tripIds.push(trip.id)
    if (trip.boatLengthFt && !entry.lengthFt) entry.lengthFt = trip.boatLengthFt
    if (trip.boatKind && !entry.kind) entry.kind = trip.boatKind
    if (lastDate > entry.lastDate) entry.lastDate = lastDate
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0))
}

/** Boten met ontbrekende gegevens die Olivier nog niet bevestigd of overgeslagen heeft. */
export function uncheckedBoats(boats: readonly BoatEntry[], settings: Settings): BoatEntry[] {
  const checked = new Set(settings.boatsChecked ?? [])
  return boats.filter((b) => !checked.has(b.key) && (!b.name || !b.model || !b.lengthFt))
}

export interface BoatInput {
  key: string
  name: string
  model: string
  lengthFt: number | null
  kind?: BoatKind
}

/** Bevestigen: naam, model, lengte en soort op alle trips van elke boot; daarna niet meer vragen. */
export async function confirmBoats(store: Store, boats: readonly BoatEntry[], inputs: readonly BoatInput[]): Promise<void> {
  const now = new Date().toISOString()
  const trips = store.get('trips.json.enc')
  const changed: Trip[] = []
  const checked = new Set(currentChecked(store))
  for (const input of inputs) {
    const boat = boats.find((b) => b.key === input.key)
    if (!boat) continue
    const name = input.name.trim().slice(0, 120)
    const model = input.model.trim().slice(0, 120)
    const length = input.lengthFt !== null && Number.isFinite(input.lengthFt) && input.lengthFt > 0 ? Math.round(input.lengthFt * 10) / 10 : null
    for (const id of boat.tripIds) {
      const trip = trips.find((t) => t.id === id && t.deletedAt === null)
      if (!trip) continue
      const { boat: _b, boatModel: _m, boatLengthFt: _l, boatKind: _k, ...rest } = trip
      void [_b, _m, _l, _k]
      const next: Trip = {
        ...rest,
        ...(name ? { boat: name } : {}),
        ...(model ? { boatModel: model } : {}),
        ...(length !== null ? { boatLengthFt: length } : {}),
        ...(input.kind ? { boatKind: input.kind } : {}),
        updatedAt: now,
      }
      if (JSON.stringify({ ...next, updatedAt: '' }) !== JSON.stringify({ ...trip, updatedAt: '' })) changed.push(next)
    }
    checked.add(boat.key)
    checked.add(boatKey(name, model))
  }
  if (changed.length > 0) await store.putMany('trips.json.enc', changed)
  await saveSettings(store, { boatsChecked: [...checked] })
  void store.sync()
}

/** Overslaan: deze boten niet meer vragen (aanvullen kan later via Meer → Boten of de zondagkaart). */
export async function skipBoats(store: Store, boats: readonly BoatEntry[]): Promise<void> {
  const checked = new Set(currentChecked(store))
  for (const b of boats) checked.add(b.key)
  await saveSettings(store, { boatsChecked: [...checked] })
  void store.sync()
}

function currentChecked(store: Store): string[] {
  return store.get('settings.json.enc').find((s) => s.id === 'settings' && s.deletedAt === null)?.boatsChecked ?? []
}

/** Hoe een boot in de kolom boot van een dag staat: "Naam (Model)", of alleen naam of model. */
export function shipText(name: string, model: string): string {
  const n = name.trim()
  const m = model.trim()
  return n && m ? `${n} (${m})` : n || m
}

/** Dagen met deze boot (de tekst in de kolom boot wijst naar dezelfde naam en hetzelfde model). */
function legsOf(legs: readonly Leg[], boat: BoatEntry): Leg[] {
  return active(legs).filter((l) => {
    const ship = parseShip(l.boat)
    return (ship.name || ship.model) && boatKey(ship.name, ship.model) === boat.key
  })
}

/** Na een wijziging van trips en dagen: alles terugzetten zoals het was (met een latere updatedAt). */
function restore(store: Store, trips: readonly Trip[], legs: readonly Leg[]): () => Promise<void> {
  return async () => {
    const later = (iso: string) => new Date(Math.max(Date.now(), Date.parse(iso) + 1)).toISOString()
    if (trips.length > 0) await store.putMany('trips.json.enc', trips.map((t) => ({ ...t, updatedAt: later(t.updatedAt) })))
    if (legs.length > 0) await store.putMany('legs.json.enc', legs.map((l) => ({ ...l, updatedAt: later(l.updatedAt) })))
    void store.sync()
  }
}

function tripsOf(store: Store, boat: BoatEntry): Trip[] {
  return store.list('trips.json.enc').filter((t) => boat.tripIds.includes(t.id))
}

/** Een boot weghalen: de trips en dagen houden geen bootgegevens meer (bijvoorbeeld een tikfout als "xxx"). */
export async function deleteBoat(store: Store, boat: BoatEntry): Promise<() => Promise<void>> {
  const now = new Date().toISOString()
  const trips = tripsOf(store, boat)
  const legs = legsOf(store.get('legs.json.enc'), boat)
  const nextTrips = trips.map((t) => {
    const { boat: _b, boatModel: _m, boatLengthFt: _l, boatKind: _k, ...rest } = t
    void [_b, _m, _l, _k]
    return { ...rest, updatedAt: now }
  })
  if (nextTrips.length > 0) await store.putMany('trips.json.enc', nextTrips)
  if (legs.length > 0) await store.putMany('legs.json.enc', legs.map((l) => ({ ...l, boat: '', updatedAt: now })))
  void store.sync()
  return restore(store, trips, legs)
}

/**
 * Een boot samenvoegen met een andere: de trips en dagen van `from` krijgen de naam, het model, de lengte en de soort van
 * `into`. Daarna is er nog één boot.
 */
export async function mergeBoat(store: Store, from: BoatEntry, into: BoatEntry): Promise<() => Promise<void>> {
  const now = new Date().toISOString()
  const trips = tripsOf(store, from)
  const legs = legsOf(store.get('legs.json.enc'), from)
  const nextTrips = trips.map((t) => {
    const { boat: _b, boatModel: _m, boatLengthFt: _l, boatKind: _k, ...rest } = t
    void [_b, _m, _l, _k]
    return {
      ...rest,
      ...(into.name ? { boat: into.name } : {}),
      ...(into.model ? { boatModel: into.model } : {}),
      ...(into.lengthFt ? { boatLengthFt: into.lengthFt } : {}),
      ...(into.kind ? { boatKind: into.kind } : {}),
      updatedAt: now,
    }
  })
  const text = shipText(into.name, into.model)
  if (nextTrips.length > 0) await store.putMany('trips.json.enc', nextTrips)
  if (legs.length > 0) await store.putMany('legs.json.enc', legs.map((l) => ({ ...l, boat: text, updatedAt: now })))
  void store.sync()
  return restore(store, trips, legs)
}
