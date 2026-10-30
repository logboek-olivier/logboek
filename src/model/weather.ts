import { compareLegs } from './derive'
import { addDays } from './money'
import { findPlace, greatCircleNm } from './places'
import type { Leg, Place, Trip } from './types'

// Wind en weer (Vandaag): de verwachting voor vandaag en morgen bij de lopende trip. Alleen uit public/weather.json op
// dezelfde origin, een paar keer per dag gebouwd door deploy.yml (scripts/build-weather.mjs, Open-Meteo); de app haalt
// zelf nooit externe data op en de CSP blijft gelijk (beveiligingsregels 2 en 15). De service worker bewaart de laatst
// opgehaalde versie voor offline; de tijd van ophalen staat erbij.

export interface WeatherHour {
  /** Plaatselijke tijd van het punt, "jjjj-mm-ddTuu:mm". */
  t: string
  /** Wind en windstoten in knopen; richting in graden (waar de wind vandaan komt). */
  wind: number | null
  gust: number | null
  dir: number | null
  /** Neerslag in mm in dat uur. */
  rain: number | null
  /** Golfhoogte in meters. */
  wave: number | null
}

export interface WeatherPoint {
  id: string
  name: { nl: string; en: string }
  lat: number
  lon: number
  timezone: string
  /** Wanneer dit punt werd opgehaald; bij een storing kan een punt uit een eerdere run komen (anders die van het bestand). */
  fetchedAt?: string
  hours: WeatherHour[]
}

export interface WeatherFile {
  format: 'logboek-weather'
  source: string
  /** Wanneer deploy.yml de verwachting ophaalde (ISO). */
  fetchedAt: string
  points: WeatherPoint[]
}

const isNum = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))

function isHour(h: unknown): h is WeatherHour {
  if (typeof h !== 'object' || h === null) return false
  const v = h as Record<string, unknown>
  return typeof v.t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.t) && isNum(v.wind) && isNum(v.gust) && isNum(v.dir) && isNum(v.rain) && isNum(v.wave)
}

function isPoint(p: unknown): p is WeatherPoint {
  if (typeof p !== 'object' || p === null) return false
  const v = p as Record<string, unknown>
  const name = v.name as Record<string, unknown> | null
  return (
    typeof v.id === 'string' &&
    typeof name === 'object' &&
    name !== null &&
    typeof name.nl === 'string' &&
    typeof name.en === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number' &&
    typeof v.timezone === 'string' &&
    (v.fetchedAt === undefined || (typeof v.fetchedAt === 'string' && !Number.isNaN(Date.parse(v.fetchedAt)))) &&
    Array.isArray(v.hours) &&
    v.hours.length <= MAX_HOURS &&
    v.hours.every(isHour)
  )
}

/** Grenzen: een kapot of vreemd bestand mag Vandaag nooit ophouden (drie dagen per uur, een paar vaste punten). */
const MAX_HOURS = 24 * 7
const MAX_POINTS = 50

export function isWeatherFile(value: unknown): value is WeatherFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.format === 'logboek-weather' && typeof v.source === 'string' && typeof v.fetchedAt === 'string' && !Number.isNaN(Date.parse(v.fetchedAt)) && Array.isArray(v.points) && v.points.length <= MAX_POINTS && v.points.every(isPoint)
}

let current: WeatherFile | null = null
const listeners = new Set<() => void>()

export function getWeather(): WeatherFile | null {
  return current
}

export function subscribeWeather(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setWeather(file: WeatherFile | null): void {
  current = file
  for (const l of listeners) l()
}

/** Haalt weather.json op van dezelfde origin (offline: de laatst bewaarde kopie van de service worker). */
export async function loadWeather(url = `${import.meta.env.BASE_URL}weather.json`, fetchImpl: typeof fetch = fetch): Promise<WeatherFile | null> {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!isWeatherFile(body)) return null
    setWeather(body)
    return body
  } catch {
    return null
  }
}

/** Opnieuw ophalen als het bestand in het geheugen ouder is dan dit (de app kan dagen open blijven). */
export const REFRESH_HOURS = 3

export function needsRefresh(file: WeatherFile | null, now: Date = new Date()): boolean {
  return !file || now.getTime() - Date.parse(file.fetchedAt) > REFRESH_HOURS * 3_600_000
}

/** Hoe ver een weerpunt hoogstens van de trip mag liggen. */
export const POINT_MAX_NM = 150

/** De punten (met een pin) van een trip: de basis en de van- en naar-plaatsen van zijn dagen, op datum (laatste achteraan). */
export function tripPoints(trip: Trip, legs: readonly Leg[], places: readonly Place[]): { lat: number; lon: number }[] {
  const own = legs.filter((l) => l.tripId === trip.id && !l.deletedAt).sort(compareLegs)
  const names = [trip.base ?? '', ...own.flatMap((l) => [l.fromPlace, l.toPlace])]
  const out: { lat: number; lon: number }[] = []
  for (const name of names) {
    const place = name.trim() ? findPlace(places, name) : null
    if (place) out.push({ lat: place.lat, lon: place.lon })
  }
  return out
}

/**
 * Het weerpunt bij een trip: het dichtst bij de laatste plaats met een pin (daar is Olivier nu), en hoogstens
 * POINT_MAX_NM daarvandaan. Zonder pins of buiten de vaste gebieden: geen weer.
 */
export function pointNear(file: WeatherFile | null, near: readonly { lat: number; lon: number }[]): WeatherPoint | null {
  const here = near.at(-1)
  if (!file || !here) return null
  let best: { point: WeatherPoint; nm: number } | null = null
  for (const point of file.points) {
    const nm = greatCircleNm(here, point)
    if (nm <= POINT_MAX_NM && (!best || nm < best.nm)) best = { point, nm }
  }
  return best?.point ?? null
}

/** Hoe het weerpunt gekozen is: zelf, bij de laatste plaats met pin, bij de eigen locatie (GPS) of bij het gebied van de trip. */
export type PointSource = 'zelf' | 'pin' | 'gps' | 'gebied'

const normalized = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Het weerpunt bij het gebied of de basis van een trip (op naam: "BVI", "Sint Maarten", "Split"), als dat er is. */
export function pointForArea(file: WeatherFile | null, texts: readonly (string | undefined)[]): WeatherPoint | null {
  if (!file) return null
  const words = texts.map((x) => normalized(x ?? '')).filter(Boolean)
  for (const text of words) {
    for (const point of file.points) {
      const names = [point.id.replace(/-/g, ' '), point.name.nl, point.name.en].map(normalized).filter(Boolean)
      if (names.some((n) => ` ${text} `.includes(` ${n} `) || ` ${n} `.includes(` ${text} `))) return point
    }
  }
  return null
}

/**
 * Het weerpunt voor Vandaag: zelf gekozen (als dat punt in het bestand staat); anders het dichtstbijzijnde bij de laatste
 * plaats met een pin van de lopende trip; anders bij de eigen locatie (alleen als GPS al is toegestaan); anders het punt
 * bij het gebied of de basis van de trip. Automatisch hoogstens POINT_MAX_NM ver.
 */
export function choosePoint(
  file: WeatherFile | null,
  opts: { chosen?: string | null; pins: readonly { lat: number; lon: number }[]; gps?: { lat: number; lon: number } | null; area?: readonly (string | undefined)[] },
): { point: WeatherPoint; source: PointSource } | null {
  if (!file) return null
  const own = opts.chosen ? file.points.find((p) => p.id === opts.chosen) : undefined
  if (own) return { point: own, source: 'zelf' }
  const byPin = pointNear(file, opts.pins)
  if (byPin) return { point: byPin, source: 'pin' }
  const byGps = opts.gps ? pointNear(file, [opts.gps]) : null
  if (byGps) return { point: byGps, source: 'gps' }
  const byArea = pointForArea(file, opts.area ?? [])
  return byArea ? { point: byArea, source: 'gebied' } : null
}

/** De richting waar de wind heen gaat, in graden (het pijltje wijst met de wind mee): de kompasstreek plus 180°. */
export function downwindDeg(dir: Compass): number {
  return (COMPASS.indexOf(dir) * 45 + 180) % 360
}

export type DayPart = 'ochtend' | 'middag' | 'avond'
export const DAY_PARTS: readonly DayPart[] = ['ochtend', 'middag', 'avond']
const PART_HOURS: Record<DayPart, [number, number]> = { ochtend: [6, 12], middag: [12, 18], avond: [18, 24] }

export interface PartSummary {
  part: DayPart
  /** Laagste en hoogste wind (kn), hoogste windstoot, de meest voorkomende richting. */
  windMin: number | null
  windMax: number | null
  gust: number | null
  dir: Compass | null
  wave: number | null
  /** Neerslag in mm over het dagdeel; null als die onbekend is. */
  rain: number | null
}

const COMPASS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'] as const
export type Compass = (typeof COMPASS)[number]

/** Kompasstreek van een windrichting in graden (acht streken; de vertaling volgt bij het tonen). */
export function compass(deg: number): Compass {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!
}

/** De uren van één dag (plaatselijke datum jjjj-mm-dd) per dagdeel samengevat; dagdelen zonder gegevens vallen weg. */
export function dayParts(point: WeatherPoint, date: string): PartSummary[] {
  const out: PartSummary[] = []
  for (const part of DAY_PARTS) {
    const [from, to] = PART_HOURS[part]
    const hours = point.hours.filter((h) => h.t.slice(0, 10) === date && Number(h.t.slice(11, 13)) >= from && Number(h.t.slice(11, 13)) < to)
    const values = (key: 'wind' | 'gust' | 'wave' | 'rain') => hours.map((h) => h[key]).filter((v): v is number => typeof v === 'number')
    const winds = values('wind')
    if (winds.length === 0) continue
    const gusts = values('gust')
    const waves = values('wave')
    const rains = values('rain')
    const dirs = new Map<Compass, number>()
    for (const h of hours) if (typeof h.dir === 'number') dirs.set(compass(h.dir), (dirs.get(compass(h.dir)) ?? 0) + 1)
    out.push({
      part,
      windMin: Math.round(Math.min(...winds)),
      windMax: Math.round(Math.max(...winds)),
      gust: gusts.length ? Math.round(Math.max(...gusts)) : null,
      dir: dirs.size ? [...dirs.entries()].sort((a, b) => b[1] - a[1])[0]![0] : null,
      wave: waves.length ? Math.round(Math.max(...waves) * 10) / 10 : null,
      rain: rains.length ? Math.round(rains.reduce((s, r) => s + r, 0) * 10) / 10 : null,
    })
  }
  return out
}

/** Dagdelen van vandaag die nog niet voorbij zijn (plaatselijk uur van het punt). */
export function upcoming(parts: readonly PartSummary[], hour: number): PartSummary[] {
  return parts.filter((p) => PART_HOURS[p.part][1] > hour)
}

/** Het plaatselijke uur (0–23) bij het punt. */
export function localHour(point: WeatherPoint, now: Date = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: point.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now)
    return Number(h) % 24
  } catch {
    return now.getUTCHours()
  }
}

/** Vandaag en morgen in de plaatselijke tijd van het punt. */
export function localDates(point: WeatherPoint, now: Date = new Date()): [string, string] {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: point.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  // Morgen = de plaatselijke datum plus één dag (niet 24 uur later: op de dag van de wintertijd zijn dat er 25).
  const today = fmt.format(now)
  return [today, addDays(today, 1)]
}

/** Wanneer de verwachting van een punt werd opgehaald. */
export function fetchedAtOf(file: WeatherFile, point: WeatherPoint): string {
  return point.fetchedAt ?? file.fetchedAt
}

/** Ouder dan 18 uur: de verwachting is verouderd (dan staat dat erbij). */
export function isStale(fetchedAt: string, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(fetchedAt) > 18 * 3_600_000
}
