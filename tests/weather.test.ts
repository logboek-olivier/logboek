import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: Node-script zonder typen
import { FORECAST_URL, KEEP_HOURS, MARINE_URL, POINTS, SOURCE, forecastUrl, keptPoint, marineUrl, parsePoint, weatherFile } from '../scripts/build-weather.mjs'
import type { Leg, Place, Trip } from '../src/model/types'
import { choosePoint, compass, dayParts, downwindDeg, pointForArea, fetchedAtOf, isStale, isWeatherFile, loadWeather, localDates, localHour, needsRefresh, pointNear, POINT_MAX_NM, tripPoints, upcoming, type WeatherFile, type WeatherPoint } from '../src/model/weather'

// Wind en weer: public/weather.json wordt door deploy.yml gebouwd uit Open-Meteo; de app leest alleen dat bestand.
// Verzonnen antwoorden in de vorm die Open-Meteo documenteert (hourly.time in plaatselijke tijd, timezone=auto).

const NOW = '2026-10-29T10:00:00.000Z'

/** Een verzonnen weersverwachting van 48 uur vanaf middernacht op `day`, in de vorm van Open-Meteo. */
function fakeForecast(day: string, timezone = 'UTC') {
  const time: string[] = []
  for (let d = 0; d < 2; d++) {
    const date = new Date(`${day}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + d)
    for (let h = 0; h < 24; h++) time.push(`${date.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00`)
  }
  return {
    latitude: 18.4,
    longitude: -64.6,
    timezone,
    hourly_units: { time: 'iso8601', wind_speed_10m: 'kn' },
    hourly: {
      time,
      wind_speed_10m: time.map((_, i) => 10 + (i % 6)),
      wind_gusts_10m: time.map((_, i) => 18 + (i % 6)),
      wind_direction_10m: time.map(() => 120),
      precipitation: time.map((_, i) => (i % 24 === 14 ? 1.2 : 0)),
    },
  }
}

function fakeMarine(day: string) {
  const f = fakeForecast(day)
  return { hourly: { time: f.hourly.time, wave_height: f.hourly.time.map((_, i) => (i < 30 ? 1.23 : null)) } }
}

describe('build-weather.mjs', () => {
  it('alleen de vaste punten naar Open-Meteo, wind in knopen, plaatselijke tijd, twee dagen', () => {
    expect(POINTS.length).toBeGreaterThan(3)
    const url = new URL(forecastUrl(POINTS[0]))
    expect(`${url.origin}${url.pathname}`).toBe(FORECAST_URL)
    expect(url.searchParams.get('wind_speed_unit')).toBe('kn')
    expect(url.searchParams.get('timezone')).toBe('auto')
    expect(url.searchParams.get('forecast_days')).toBe('3')
    expect(url.searchParams.get('hourly')).toBe('wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation')
    const marine = new URL(marineUrl(POINTS[0]))
    expect(`${marine.origin}${marine.pathname}`).toBe(MARINE_URL)
    expect(marine.searchParams.get('hourly')).toBe('wave_height')
  })

  it('één punt uit de antwoorden: per uur wind, stoten, richting, regen en golven; ontbrekend wordt null', () => {
    const point = parsePoint(POINTS[0], fakeForecast('2026-10-29', 'America/Tortola'), fakeMarine('2026-10-29'))
    expect(point).toMatchObject({ id: POINTS[0].id, timezone: 'America/Tortola' })
    expect(point.hours).toHaveLength(48)
    expect(point.hours[0]).toEqual({ t: '2026-10-29T00:00', wind: 10, gust: 18, dir: 120, rain: 0, wave: 1.2 })
    expect(point.hours[40].wave).toBeNull()
    // Zonder mariene verwachting: toch wind en regen, golven onbekend.
    expect(parsePoint(POINTS[0], fakeForecast('2026-10-29'), null).hours[0].wave).toBeNull()
    // Geen verwachting: een fout, nooit verzonnen waarden.
    expect(() => parsePoint(POINTS[0], { hourly: {} }, null)).toThrow()
    expect(() => parsePoint(POINTS[0], { hourly: { time: ['gisteren'] } }, null)).toThrow()
  })

  it('bij een storing een punt uit de vorige verwachting overnemen, alleen als die hoogstens 18 uur oud is', () => {
    const now = Date.parse('2026-10-29T12:00:00Z')
    const old = weatherFile([parsePoint(POINTS[0], fakeForecast('2026-10-29'), null, '2026-10-29T06:00:00.000Z')], '2026-10-29T06:00:00.000Z')
    expect(keptPoint(old, POINTS[0].id, now)).toMatchObject({ id: POINTS[0].id, fetchedAt: '2026-10-29T06:00:00.000Z' })
    // Te oud, een ander punt, een vreemd bestand of geen bestand: niets overnemen.
    expect(keptPoint(old, POINTS[0].id, now + KEEP_HOURS * 3_600_000)).toBeNull()
    expect(keptPoint(old, 'nergens', now)).toBeNull()
    expect(keptPoint({ format: 'iets anders' }, POINTS[0].id, now)).toBeNull()
    expect(keptPoint(null, POINTS[0].id, now)).toBeNull()
    // Een punt zonder eigen tijd krijgt de tijd van het bestand.
    const withoutOwn = { ...old, points: [{ ...old.points[0], fetchedAt: undefined }] }
    expect(keptPoint(withoutOwn, POINTS[0].id, now)?.fetchedAt).toBe('2026-10-29T06:00:00.000Z')
  })

  it('het bestand is geldig voor de app', () => {
    const file = weatherFile([parsePoint(POINTS[0], fakeForecast('2026-10-29'), fakeMarine('2026-10-29'))], NOW)
    expect(file.source).toBe(SOURCE)
    expect(isWeatherFile(file)).toBe(true)
    expect(isWeatherFile({ ...file, format: 'iets anders' })).toBe(false)
    expect(isWeatherFile({ ...file, fetchedAt: 'nooit' })).toBe(false)
    expect(isWeatherFile({ ...file, points: [{ ...file.points[0], hours: [{ t: '2026-10-29T00:00', wind: 'veel' }] }] })).toBe(false)
    // Te groot (een kapot bestand mag Vandaag niet ophouden): geweigerd.
    const hour = file.points[0].hours[0]
    expect(isWeatherFile({ ...file, points: [{ ...file.points[0], hours: Array.from({ length: 1000 }, () => hour) }] })).toBe(false)
    expect(isWeatherFile({ ...file, points: Array.from({ length: 51 }, () => file.points[0]) })).toBe(false)
    expect(isWeatherFile({ ...file, points: [{ ...file.points[0], fetchedAt: 'nooit' }] })).toBe(false)
  })
})

describe('weer in de app', () => {
  const point: WeatherPoint = parsePoint(POINTS[0], fakeForecast('2026-10-29'), fakeMarine('2026-10-29'))
  const file: WeatherFile = weatherFile([point, parsePoint(POINTS.find((p: { id: string }) => p.id === 'split'), fakeForecast('2026-10-29'), null)], NOW)

  it('per dagdeel: laagste en hoogste wind, hoogste stoot, richting, hoogste golf en de regen samen', () => {
    const parts = dayParts(point, '2026-10-29')
    expect(parts.map((p) => p.part)).toEqual(['ochtend', 'middag', 'avond'])
    expect(parts[1]).toEqual({ part: 'middag', windMin: 10, windMax: 15, gust: 23, dir: 'ZO', wave: 1.2, rain: 1.2 })
    expect(parts[0]!.rain).toBe(0)
    // Morgenavond geen golven meer in de verwachting: onbekend, niet nul.
    expect(dayParts(point, '2026-10-30')[2]!.wave).toBeNull()
    expect(dayParts(point, '2026-11-05')).toEqual([])
    // Van vandaag alleen wat nog komt.
    expect(upcoming(parts, 13).map((p) => p.part)).toEqual(['middag', 'avond'])
    expect(upcoming(parts, 23).map((p) => p.part)).toEqual(['avond'])
  })

  it('kompas', () => {
    expect(compass(0)).toBe('N')
    expect(compass(359)).toBe('N')
    expect(compass(120)).toBe('ZO')
    expect(compass(-90)).toBe('W')
  })

  it('vandaag en morgen en het uur in de plaatselijke tijd van het punt', () => {
    const at = new Date('2026-10-30T02:30:00Z')
    expect(localDates({ ...point, timezone: 'UTC' }, at)).toEqual(['2026-10-30', '2026-10-31'])
    // In de BVI (UTC−4) is het dan nog 29 oktober, half elf 's avonds.
    expect(localDates({ ...point, timezone: 'America/Tortola' }, at)).toEqual(['2026-10-29', '2026-10-30'])
    expect(localHour({ ...point, timezone: 'America/Tortola' }, at)).toBe(22)
    // Op de dag van de wintertijd (25 uur) is morgen echt de volgende dag, ook vlak na middernacht.
    expect(localDates({ ...point, timezone: 'Europe/Amsterdam' }, new Date('2026-10-24T22:30:00Z'))).toEqual(['2026-10-25', '2026-10-26'])
    // Een onbekende tijdzone valt terug op UTC.
    expect(localDates({ ...point, timezone: 'Nergens/Nergens' }, at)).toEqual(['2026-10-30', '2026-10-31'])
  })

  it('het weerpunt bij de trip: het dichtst bij de laatste plaats met een pin, hoogstens 150 nm ver', () => {
    const T = '2026-10-01T00:00:00.000Z'
    const places: Place[] = [
      { id: 'p1', name: 'Nepbaai', lat: 18.33, lon: -64.75, updatedAt: T, deletedAt: null },
      { id: 'p2', name: 'Nepstad', lat: 43.5, lon: 16.44, updatedAt: T, deletedAt: null },
    ]
    const trip: Trip = { id: 'trip', name: 'Nepweek', base: 'Nepbaai', updatedAt: T, deletedAt: null }
    const leg = { id: 'l1', tripId: 'trip', date: '2026-10-28', fromPlace: 'Nepbaai', toPlace: 'Zonder pin', updatedAt: T, deletedAt: null } as Leg
    const near = tripPoints(trip, [leg], places)
    expect(near).toEqual([{ lat: 18.33, lon: -64.75 }, { lat: 18.33, lon: -64.75 }])
    // De laatste plaats is die van de laatste dag op datum, niet de volgorde in het bestand (die volgt de id's).
    const later = { ...leg, id: 'a-eerder-id', date: '2026-10-30', fromPlace: 'Nepbaai', toPlace: 'Nepstad' } as Leg
    expect(tripPoints(trip, [later, leg], places).at(-1)).toEqual({ lat: 43.5, lon: 16.44 })
    expect(pointNear(file, tripPoints(trip, [later, leg], places))?.id).toBe('split')
    expect(pointNear(file, near)?.id).toBe('bvi')
    expect(pointNear(file, [{ lat: 43.5, lon: 16.44 }])?.id).toBe('split')
    // Ver van elk punt (midden op de Atlantische Oceaan) of zonder pins: geen weer.
    expect(pointNear(file, [{ lat: 30, lon: -40 }])).toBeNull()
    expect(pointNear(file, [])).toBeNull()
    expect(pointNear(null, near)).toBeNull()
    expect(POINT_MAX_NM).toBe(150)
  })

  it('verouderd na 18 uur, per punt; opnieuw ophalen als het bestand in het geheugen ouder is dan 3 uur', () => {
    expect(isStale(file.fetchedAt, new Date('2026-10-30T03:00:00Z'))).toBe(false)
    expect(isStale(file.fetchedAt, new Date('2026-10-30T05:00:00Z'))).toBe(true)
    expect(fetchedAtOf(file, { ...point, fetchedAt: '2026-10-28T10:00:00.000Z' })).toBe('2026-10-28T10:00:00.000Z')
    expect(fetchedAtOf(file, { ...point, fetchedAt: undefined })).toBe(NOW)
    expect(needsRefresh(null)).toBe(true)
    expect(needsRefresh(file, new Date('2026-10-29T12:00:00Z'))).toBe(false)
    expect(needsRefresh(file, new Date('2026-10-29T13:30:00Z'))).toBe(true)
  })

  it('laden van dezelfde origin; een ongeldig of ontbrekend bestand geeft geen weer', async () => {
    const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
    expect(await loadWeather('/weather.json', ok(file))).toMatchObject({ format: 'logboek-weather' })
    expect(await loadWeather('/weather.json', ok({ format: 'nep' }))).toBeNull()
    expect(await loadWeather('/weather.json', (async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toBeNull()
    expect(await loadWeather('/weather.json', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
})

describe('beveiliging', () => {
  it('de Content-Security-Policy blijft precies zoals in CLAUDE.md: het weer komt van de eigen origin', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
    expect(csp).toBe("default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
    // De app noemt Open-Meteo alleen als bron, nooit als adres om op te halen.
    for (const file of ['../src/model/weather.ts', '../src/components/WeatherCard.tsx']) expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/open-meteo\.com|https?:\/\//)
  })
})

describe('welk weerpunt', () => {
  const at = (id: string) => parsePoint(POINTS.find((p: { id: string }) => p.id === id), fakeForecast('2026-10-29'), null) as WeatherPoint
  const file: WeatherFile = weatherFile([at('bvi'), at('sint-maarten'), at('saint-barthelemy'), at('sint-eustatius'), at('antigua'), at('split')], NOW)

  it('nieuwe punten in de Bovenwindse Eilanden', () => {
    for (const id of ['saint-barthelemy', 'sint-eustatius', 'antigua']) expect(POINTS.some((p: { id: string }) => p.id === id)).toBe(true)
  })

  it('zelf gekozen gaat voor; dan de laatste pin; dan GPS; dan het gebied van de trip', () => {
    const statia = { lat: 17.48, lon: -62.98 }
    expect(choosePoint(file, { chosen: 'antigua', pins: [statia] })).toMatchObject({ point: { id: 'antigua' }, source: 'zelf' })
    expect(choosePoint(file, { chosen: 'bestaat-niet', pins: [statia] })).toMatchObject({ point: { id: 'sint-eustatius' }, source: 'pin' })
    expect(choosePoint(file, { pins: [], gps: { lat: 17.9, lon: -62.85 } })).toMatchObject({ point: { id: 'saint-barthelemy' }, source: 'gps' })
    expect(choosePoint(file, { pins: [], gps: null, area: ['Nep Sint Maarten'] })).toMatchObject({ point: { id: 'sint-maarten' }, source: 'gebied' })
    expect(choosePoint(file, { pins: [], area: ['BVI'] })?.point.id).toBe('bvi')
    expect(choosePoint(file, { pins: [], area: ['Nepgebied'] })).toBeNull()
    expect(pointForArea(file, ['split'])?.id).toBe('split')
  })

  it('het pijltje wijst met de wind mee: wind uit het oosten gaat naar het westen', () => {
    expect(downwindDeg('O')).toBe(270)
    expect(downwindDeg('N')).toBe(180)
    expect(downwindDeg('ZW')).toBe(45)
  })
})
