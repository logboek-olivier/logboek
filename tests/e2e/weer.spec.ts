import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat } from './helpers/logbook'

// Wind en weer op Vandaag: de verwachting voor vandaag en morgen bij de lopende trip, alleen uit public/weather.json op
// dezelfde origin (deploy.yml bouwt het uit Open-Meteo). De app praat nooit met Open-Meteo. Alle waarden verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.locator('.weather-card').screenshot({ path: `screenshots/weer/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

/** Verzonnen weather.json: 48 uur vanaf vandaag middernacht (UTC), wind 10–15 kn uit 120°, golven 1,2 m. */
function fakeWeather(fetchedAt: Date) {
  const hours = []
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  for (let i = 0; i < 48; i++) {
    const t = new Date(start.getTime() + i * 3_600_000).toISOString().slice(0, 16)
    hours.push({ t, wind: 10 + (i % 6), gust: 18 + (i % 6), dir: 120, rain: i % 24 === 14 ? 1.2 : 0, wave: 1.2 })
  }
  return {
    format: 'logboek-weather',
    source: 'Open-Meteo.com (CC BY 4.0)',
    fetchedAt: fetchedAt.toISOString(),
    points: [
      { id: 'bvi', name: { nl: 'BVI', en: 'BVI' }, lat: 18.4, lon: -64.6, timezone: 'UTC', hours },
      { id: 'split', name: { nl: 'Split en Brač', en: 'Split and Brač' }, lat: 43.42, lon: 16.45, timezone: 'UTC', hours },
    ],
  }
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    // De service worker haalt weather.json zelf op (page.route ziet dat niet): hier geblokkeerd.
    test.use({
      locale: lang === 'nl' ? 'nl-NL' : 'en-GB',
      timezoneId: 'UTC',
      viewport: { width: 360, height: 800 },
      serviceWorkers: 'block',
      geolocation: { latitude: 18.45, longitude: -64.43 },
      permissions: ['geolocation'],
    })

    test(`weer: wind, golven en regen voor vandaag en morgen bij de lopende trip, met de tijd van ophalen (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const hosts = new Set<string>()
      page.on('request', (r) => hosts.add(new URL(r.url()).host))
      await mockGithub(page)
      let weather = fakeWeather(new Date(Date.now() - 2 * 3_600_000))
      await page.route('**/logboek/weather.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weather) }))
      await createNewLogbook(page, lang)

      // Zonder lopende trip: geen weer.
      await expect(page.locator('.weather-card')).toHaveCount(0)

      // Een lopende trip met een dag naar een plaats met een pin in de BVI.
      const nav = page.getByRole('navigation')
      await nav.getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.getByRole('main').getByRole('button', { name: L('week.new') }).click()
      const sheet = page.getByRole('dialog')
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek BVI')
      await fillBoat(sheet, lang)
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('button', { name: L('map.open', { field: L('field.to') }) }).click()
      const map = page.getByRole('dialog', { name: L('map.titleTo') })
      await map.getByRole('button', { name: L('map.here') }).click()
      await map.getByLabel(L('map.placeName')).fill('Nepgorda')
      await map.getByRole('button', { name: L('map.choose') }).click()
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today'), level: 1 })).toBeVisible()

      const card = page.locator('.weather-card')
      await expect(card.getByRole('heading', { name: L('weather.title', { area: 'BVI' }) })).toBeVisible()
      await expect(card.getByRole('heading', { name: L('weather.tomorrow') })).toBeVisible()
      // Morgenmiddag: wind 10–15 kn uit het zuidoosten (pijltje met de wind mee, geen windkracht); stoten 23 kn, golven 1,2 m, regen 1,2 mm.
      const tomorrowMiddag = card.locator('.weather-day', { hasText: L('weather.tomorrow') }).locator('li', { hasText: L('weather.part.middag') })
      await expect(tomorrowMiddag).toContainText(L('weather.windFrom', { dir: L('weather.dir.ZO'), range: '10–15' }))
      await expect(tomorrowMiddag.locator('.wind-arrow')).toBeVisible()
      await expect(card).not.toContainText('Bft')
      await expect(card).toContainText(L('weather.source.pin'))
      // Zelf een ander punt kiezen; terug naar automatisch.
      await card.getByRole('combobox', { name: L('weather.choosePoint') }).selectOption('split')
      await expect(card.getByRole('heading', { name: L('weather.title', { area: lang === 'nl' ? 'Split en Brač' : 'Split and Brač' }) })).toBeVisible()
      await expect(card).toContainText(L('weather.source.zelf'))
      // "Automatisch" noemt het punt dat het zou kiezen.
      await expect(card.getByRole('combobox', { name: L('weather.choosePoint') }).locator('option[value=""]')).toHaveText(L('weather.automaticPoint', { point: 'BVI' }))
      await card.getByRole('combobox', { name: L('weather.choosePoint') }).selectOption('')
      await expect(card.getByRole('heading', { name: L('weather.title', { area: 'BVI' }) })).toBeVisible()
      await expect(tomorrowMiddag).toContainText(L('weather.gust', { kn: '23' }))
      await expect(tomorrowMiddag).toContainText(L('weather.wave', { m: lang === 'nl' ? '1,2' : '1.2' }))
      await expect(tomorrowMiddag).toContainText(L('weather.rain', { mm: lang === 'nl' ? '1,2' : '1.2' }))
      await expect(card.locator('.weather-day', { hasText: L('weather.tomorrow') }).locator('li', { hasText: L('weather.part.ochtend') })).toContainText(L('weather.dry'))
      await expect(card).toContainText(L('weather.fetched', { at: '' }).trim())
      await expect(card).not.toContainText(L('weather.stale', { at: '' }).split(':')[0]!)
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      await shots(page, 'vandaag', lang)

      // Een verwachting van twee dagen oud (zoals een oude kopie uit de cache van de service worker): verouderd, met de
      // tijd van ophalen.
      weather = fakeWeather(new Date(Date.now() - 48 * 3_600_000))
      await page.reload()
      await expect(page.getByRole('heading', { name: L('nav.today'), level: 1 })).toBeVisible()
      await expect(card.locator('.weather-stale')).toBeVisible()

      // Geen weather.json (404): geen kaart, de rest van Vandaag werkt gewoon.
      await page.unroute('**/logboek/weather.json')
      await page.route('**/logboek/weather.json', (route) => route.fulfill({ status: 404, body: '' }))
      await page.reload()
      await expect(page.getByRole('heading', { name: L('nav.today'), level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: L('today.logDay') })).toBeVisible()
      await expect(card).toHaveCount(0)

      // De app praat alleen met de eigen origin en api.github.com; nooit met Open-Meteo.
      expect([...hosts].every((h) => h.startsWith('localhost') || h === 'api.github.com')).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
