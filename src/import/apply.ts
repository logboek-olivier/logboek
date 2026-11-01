import { sameValue } from '../basis/gelijk'
import { active } from '../model/derive'
import { placeKey } from '../model/places'
import { hasOtherData } from '../model/trip-dates'
import { keepUnknownFields, type Leg, type Trip } from '../model/types'
import type { Reader, Tx } from '../domain/tx'
import type { ImportResult } from './mileage-csv'

// Excel opnieuw importeren als schone herstart (CLAUDE.md, uitgangspunt 1: het Excel-logboek is de waarheid). Een blok
// tussen twee lege regels is een trip, met de eerste en laatste dag van het blok als begin en eind. Alleen wat uit een
// import komt, wordt vervangen; wat Olivier in de app maakte, blijft staan. Geen samenvoegen, geen heuristiek:
// - een geïmporteerde trip is een trip met geïmporteerde dagen;
// - een blok dat op dezelfde dag begint als de geïmporteerde dagen van zo'n trip, is die trip (bij twee: die met dezelfde
//   naam). Hij houdt zijn id en naam (organisatie, salaris, deelnemers en geld blijven eraan hangen); zijn begin en eind
//   worden die van het blok;
// - een dag houdt zijn vaste id (`import:<trip>:<datum>:<n>`): opnieuw importeren schrijft niets als er niets veranderde;
// - geïmporteerde dagen en trips die niet meer in het bestand staan, gaan naar de prullenbak (met de geschiedenis terug
//   te zetten), behalve een trip waar iets aan hangt (zelf gelogde dagen, geld, deelnemers, salaris, ...): die blijft,
//   zonder die dagen;
// - boten en plaatsen worden op naam hergebruikt: dezelfde naam (zonder hoofdletters, spaties of accenten) krijgt de
//   schrijfwijze die al in het logboek staat, nooit een tweede.

export interface ImportPlan {
  /** Nieuwe en bijgewerkte trips (begin en eind uit het bestand). */
  trips: Trip[]
  /** Nieuwe en gewijzigde dagen. */
  legs: Leg[]
  /** Geïmporteerde trips die niet meer in het bestand staan: naar de prullenbak. */
  removedTrips: Trip[]
  /** Geïmporteerde dagen die niet meer in het bestand staan: naar de prullenbak. */
  removedLegs: Leg[]
  /** Geïmporteerde trips die niet meer in het bestand staan maar blijven, omdat er iets aan hangt. */
  keptTrips: Trip[]
  /** Bestaande geïmporteerde trips die het bestand bijwerkt (zelfde eerste dag). */
  matched: number
  /** Zelf gelogde dagen: blijven onaangeroerd. */
  manualLegs: number
}

/** Wat een import zou doen. Schrijft niets (het voorbeeld toont het). */
export function planImport(reader: Reader, input: ImportResult, now: string = new Date().toISOString()): ImportPlan {
  const trips = active(reader.get('trips.json.enc'))
  const legs = active(reader.get('legs.json.enc'))
  const imported = importedTrips(trips, legs)

  // Bestaande geïmporteerde trips op hun eerste geïmporteerde dag.
  const byFirstDay = new Map<string, Trip[]>()
  for (const trip of imported) {
    const first = legs.filter((l) => l.tripId === trip.id && l.source === 'import').map((l) => l.date).sort()[0]!
    byFirstDay.set(first, [...(byFirstDay.get(first) ?? []), trip])
  }

  const boats = boatNames(trips)
  const places = placeNames(reader)
  const rename = new Map<string, string>()
  const used = new Set<string>()
  const outTrips: Trip[] = []
  for (const parsed of input.trips) {
    // Begin en eind: de eerste en laatste dag van het blok.
    const dates = input.legs.filter((l) => l.tripId === parsed.id).map((l) => l.date).sort()
    const block: Trip = { ...parsed, startDate: dates[0] ?? parsed.startDate, endDate: dates.at(-1) ?? parsed.endDate }
    const candidates = (byFirstDay.get(block.startDate ?? '') ?? []).filter((t) => !used.has(t.id))
    const match = candidates.find((t) => sameName(t.name, block.name)) ?? candidates[0]
    const boat = block.boat ? (boats.get(boatNameKey(block.boat)) ?? block.boat) : undefined
    if (match) {
      used.add(match.id)
      rename.set(block.id, match.id)
      // Alleen begin en eind komen uit het bestand; wat Olivier aan de trip toevoegde, blijft.
      const { datesFromDays: _follows, ...rest } = match
      void _follows
      const next: Trip = { ...rest, startDate: block.startDate, endDate: block.endDate, ...(match.boat || !boat ? {} : { boat }), ...(match.boatModel || !block.boatModel ? {} : { boatModel: block.boatModel }), updatedAt: now }
      if (!sameValue({ ...match, updatedAt: '' }, { ...next, updatedAt: '' })) outTrips.push(next)
    } else {
      outTrips.push({ ...block, ...(boat ? { boat } : {}), ...boatDetails(trips, boat, block.boatModel), updatedAt: now })
    }
  }

  // Dagen met vaste id's, in de trip van hun blok; een dag die Olivier zelf naar een andere trip zette, blijft daar.
  const stored = new Map(reader.get('legs.json.enc').map((l) => [l.id, l]))
  const incoming = withFixedIds(input.legs.map((l) => ({ ...l, tripId: rename.get(l.tripId) ?? l.tripId }))).map((l) => {
    const leg: Leg = {
      ...l,
      fromPlace: places.get(placeKey(l.fromPlace)) ?? l.fromPlace,
      toPlace: places.get(placeKey(l.toPlace)) ?? l.toPlace,
      boat: l.boat ? (boats.get(boatNameKey(l.boat)) ?? l.boat) : l.boat,
      updatedAt: now,
    }
    const before = stored.get(leg.id)
    const next = keepUnknownFields(before, leg, IMPORT_FIELDS)
    return before && before.deletedAt === null && before.tripId !== next.tripId ? { ...next, tripId: before.tripId } : next
  })
  const ids = new Set(incoming.map((l) => l.id))
  const removedLegs = legs.filter((l) => l.source === 'import' && !ids.has(l.id)).map((l) => ({ ...l, updatedAt: now, deletedAt: now }))

  const gone = imported.filter((t) => !used.has(t.id))
  const manualTrips = new Set(legs.filter((l) => l.source !== 'import').map((l) => l.tripId))
  const keptTrips = gone.filter((t) => manualTrips.has(t.id) || !!t.organisation || hasOtherData(reader, t))
  const kept = new Set(keptTrips.map((t) => t.id))
  return {
    trips: outTrips,
    legs: incoming.filter((l) => !sameLeg(stored.get(l.id), l)),
    removedTrips: gone.filter((t) => !kept.has(t.id)).map((t) => ({ ...t, updatedAt: now, deletedAt: now })),
    removedLegs,
    keptTrips,
    matched: used.size,
    manualLegs: legs.filter((l) => l.source !== 'import').length,
  }
}

/** Excel importeren: het plan in één opdracht (met geschiedenis, dus wat weggaat staat in de prullenbak). */
export async function applyImport(tx: Tx, input: ImportResult): Promise<void> {
  const plan = planImport(tx, input, tx.now)
  await tx.putMany('trips.json.enc', [...plan.removedTrips, ...plan.trips])
  await tx.putMany('legs.json.enc', [...plan.removedLegs, ...plan.legs])
}

/** Trips met geïmporteerde dagen. */
function importedTrips(trips: readonly Trip[], legs: readonly Leg[]): Trip[] {
  const withImport = new Set(legs.filter((l) => l.source === 'import').map((l) => l.tripId))
  return trips.filter((t) => withImport.has(t.id))
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const boatNameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/** Bootnamen zoals ze al in het logboek staan (de trips), op naam zonder hoofdletters en dubbele spaties. */
function boatNames(trips: readonly Trip[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const trip of trips) if (trip.boat?.trim() && !out.has(boatNameKey(trip.boat))) out.set(boatNameKey(trip.boat), trip.boat.trim())
  return out
}

/** Lengte en soort van een boot die al in het logboek staat (zelfde naam en model), zodat ze niet opnieuw gevraagd worden. */
function boatDetails(trips: readonly Trip[], boat: string | undefined, model: string | undefined): Pick<Trip, 'boatLengthFt' | 'boatKind'> {
  if (!boat) return {}
  const same = trips.find((t) => t.boat && boatNameKey(t.boat) === boatNameKey(boat) && (t.boatModel ?? '').trim().toLowerCase() === (model ?? '').trim().toLowerCase() && (t.boatLengthFt || t.boatKind))
  return same ? { ...(same.boatLengthFt ? { boatLengthFt: same.boatLengthFt } : {}), ...(same.boatKind ? { boatKind: same.boatKind } : {}) } : {}
}

/** Plaatsnamen zoals ze al in het logboek staan: eerst de plaatsen met een punt, dan de zelf gelogde dagen. */
function placeNames(reader: Reader): Map<string, string> {
  const out = new Map<string, string>()
  const add = (name: string) => {
    const key = placeKey(name)
    if (key && !out.has(key)) out.set(key, name.trim())
  }
  for (const place of active(reader.get('places.json.enc'))) add(place.name)
  for (const leg of active(reader.get('legs.json.enc'))) {
    if (leg.source === 'import') continue
    add(leg.fromPlace)
    add(leg.toPlace)
  }
  return out
}

/** Wat de import van een dag bepaalt (src/import/mileage-csv.ts); de rest van een opgeslagen dag blijft staan. */
const IMPORT_FIELDS = ['id', 'tripId', 'date', 'fromPlace', 'fromCountry', 'toPlace', 'toCountry', 'role', 'boat', 'skipperName', 'coSkipperName', 'windBft', 'nmInland', 'nmSea', 'nmTidal', 'nightHours', 'notes', 'dateEstimated', 'source', 'updatedAt', 'deletedAt'] as const

/** `import:<trip>:<datum>:<n>`: de n-de dag op die datum in die tocht, in de volgorde van het bestand. */
function withFixedIds(legs: readonly Leg[]): Leg[] {
  const seen = new Map<string, number>()
  return legs.map((leg) => {
    const key = `${leg.tripId}:${leg.date}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return { ...leg, id: `import:${key}:${n}` }
  })
}

/** Dezelfde dag, los van updatedAt (en van de volgorde van de velden). */
function sameLeg(stored: Leg | undefined, next: Leg): boolean {
  return !!stored && stored.deletedAt === null && sameValue({ ...stored, updatedAt: '' }, { ...next, updatedAt: '' })
}
