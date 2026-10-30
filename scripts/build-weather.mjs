// Bouwt public/weather.json met de verwachting voor vandaag en morgen in Oliviers vaste vaargebieden, voor deploy.yml
// (een paar keer per dag). De app haalt zelf nooit externe data op (beveiligingsregels 2 en 15): het weer komt mee als
// bestand op dezelfde origin, net als de wisselkoersen, en de Content-Security-Policy blijft gelijk.
//
// Bron: Open-Meteo (https://open-meteo.com, CC BY 4.0): wind en windstoten op 10 m in knopen, windrichting en neerslag
// uit de weersverwachting, golfhoogte uit de mariene verwachting. Geen sleutel en geen gegevens van Olivier: er gaan
// alleen de vaste punten hieronder naar Open-Meteo, vanuit GitHub Actions.
//
// Gebruik: node scripts/build-weather.mjs
// Lukt het ophalen voor een punt niet (Open-Meteo traag of weg), dan neemt het script dat punt over uit de weather.json
// die nu op de site staat, als die hoogstens 18 uur oud is, met zijn eigen tijd van ophalen; anders ontbreekt het punt.
// Lukt het voor geen enkel punt, dan geen weather.json (de app toont dan geen weer). Nooit verzonnen waarden: wat
// Open-Meteo niet geeft, wordt null.

import { mkdirSync, writeFileSync } from 'node:fs'

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine'
export const SOURCE = 'Open-Meteo.com (CC BY 4.0)'
/** De weather.json die nu op de site staat (eigen site; alleen om bij een storing een vers punt over te nemen). */
export const DEPLOYED_URL = 'https://logboek-olivier.github.io/logboek/weather.json'
/** Een overgenomen punt mag hoogstens zo oud zijn. */
export const KEEP_HOURS = 18

/** Vaste punten op het water in de vaargebieden waar Olivier vaart. */
export const POINTS = [
  { id: 'bvi', name: { nl: 'BVI', en: 'BVI' }, lat: 18.4, lon: -64.6 },
  { id: 'sint-maarten', name: { nl: 'Sint Maarten', en: 'Sint Maarten' }, lat: 18.0, lon: -63.1 },
  { id: 'saint-barthelemy', name: { nl: 'Saint-Barthélemy', en: 'Saint Barthélemy' }, lat: 17.92, lon: -62.87 },
  { id: 'sint-eustatius', name: { nl: 'Sint Eustatius', en: 'Sint Eustatius' }, lat: 17.47, lon: -62.99 },
  { id: 'antigua', name: { nl: 'Antigua', en: 'Antigua' }, lat: 17.0, lon: -61.85 },
  { id: 'split', name: { nl: 'Split en Brač', en: 'Split and Brač' }, lat: 43.42, lon: 16.45 },
  { id: 'saronisch', name: { nl: 'Saronische Golf', en: 'Saronic Gulf' }, lat: 37.65, lon: 23.45 },
  { id: 'cycladen', name: { nl: 'Cycladen', en: 'Cyclades' }, lat: 37.3, lon: 25.0 },
  { id: 'wadden', name: { nl: 'Waddenzee', en: 'Wadden Sea' }, lat: 53.25, lon: 5.25 },
  { id: 'ijsselmeer', name: { nl: 'IJsselmeer', en: 'IJsselmeer' }, lat: 52.8, lon: 5.4 },
]

const HOURLY = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation']

export function forecastUrl(point) {
  // Drie dagen: ook na middernacht en offline op zee is er dan nog een "morgen".
  const q = new URLSearchParams({ latitude: String(point.lat), longitude: String(point.lon), hourly: HOURLY.join(','), wind_speed_unit: 'kn', timezone: 'auto', forecast_days: '3' })
  return `${FORECAST_URL}?${q}`
}

export function marineUrl(point) {
  const q = new URLSearchParams({ latitude: String(point.lat), longitude: String(point.lon), hourly: 'wave_height', timezone: 'auto', forecast_days: '3' })
  return `${MARINE_URL}?${q}`
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const isTime = (t) => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)

/**
 * Eén punt uit de antwoorden van Open-Meteo: per uur (plaatselijke tijd van het punt, "jjjj-mm-ddTuu:mm") wind,
 * windstoten en richting, neerslag en golfhoogte. Onbekende of ontbrekende waarden worden null; nooit verzonnen.
 */
export function parsePoint(point, forecast, marine, fetchedAt) {
  const times = forecast?.hourly?.time
  if (!Array.isArray(times) || times.length === 0 || !times.every(isTime)) throw new Error(`${point.id}: geen verwachting`)
  const h = forecast.hourly
  const waveTimes = Array.isArray(marine?.hourly?.time) ? marine.hourly.time : []
  const waveAt = new Map(waveTimes.map((t, i) => [t, num(marine.hourly.wave_height?.[i])]))
  return {
    id: point.id,
    name: point.name,
    lat: point.lat,
    lon: point.lon,
    timezone: typeof forecast.timezone === 'string' && forecast.timezone ? forecast.timezone : 'UTC',
    ...(fetchedAt ? { fetchedAt } : {}),
    hours: times.map((t, i) => ({
      t,
      wind: num(h.wind_speed_10m?.[i]),
      gust: num(h.wind_gusts_10m?.[i]),
      dir: num(h.wind_direction_10m?.[i]),
      rain: num(h.precipitation?.[i]),
      wave: waveAt.get(t) ?? null,
    })),
  }
}

export function weatherFile(points, fetchedAt) {
  return { format: 'logboek-weather', source: SOURCE, fetchedAt, points }
}

/**
 * Een punt uit de vorige weather.json overnemen als het ophalen nu mislukte: alleen een vast punt met hetzelfde id,
 * hoogstens KEEP_HOURS oud (de tijd van ophalen van dat punt, anders van het bestand). Anders null.
 */
export function keptPoint(previous, id, now) {
  if (!previous || previous.format !== 'logboek-weather' || !Array.isArray(previous.points)) return null
  const point = previous.points.find((p) => p && p.id === id)
  if (!point || !Array.isArray(point.hours)) return null
  const at = Date.parse(point.fetchedAt ?? previous.fetchedAt)
  if (!Number.isFinite(at) || now - at > KEEP_HOURS * 3_600_000 || at > now) return null
  return { ...point, fetchedAt: new Date(at).toISOString() }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'logboek-weer (github.com/logboek-olivier/logboek)' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function main() {
  const fetchedAt = new Date().toISOString()
  const previous = fetchJson(DEPLOYED_URL).catch(() => null)
  // Alle punten tegelijk (elk verzoek stopt na 30 seconden), zodat een trage Open-Meteo de deploy niet ophoudt.
  const results = await Promise.all(
    POINTS.map(async (point) => {
      try {
        const forecast = await fetchJson(forecastUrl(point))
        // Golven zijn een aanvulling: zonder mariene verwachting toch wind en neerslag.
        const marine = await fetchJson(marineUrl(point)).catch(() => null)
        return parsePoint(point, forecast, marine, fetchedAt)
      } catch (error) {
        const kept = keptPoint(await previous, point.id, Date.now())
        console.warn(`Weer voor ${point.id} niet opgehaald (${error.message})${kept ? '; vorige verwachting behouden' : ''}`)
        return kept
      }
    }),
  )
  const points = results.filter(Boolean)
  if (points.length === 0) {
    console.warn('Geen weer opgehaald; geen weather.json')
    return
  }
  mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../public/weather.json', import.meta.url), JSON.stringify(weatherFile(points, fetchedAt)))
  console.log(`Weer: ${points.length} van ${POINTS.length} punten`)
}

if (process.argv[1]?.endsWith('build-weather.mjs')) await main()
