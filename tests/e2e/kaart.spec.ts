import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Gedetailleerde OpenStreetMap-kaart in de vier vaargebieden: kustlijnen, meren, namen van eilanden, havens en
// plaatsen en de naamsvermelding; alleen kaartbestanden van de eigen site. Schermafbeeldingen per gebied en zoom.

const AREAS = [
  { name: 'bvi', lat: 18.405, lon: -64.62, label: 'Norman Island' },
  { name: 'dalmatie', lat: 43.49, lon: 16.44, label: 'Split' },
  { name: 'saronisch', lat: 37.72, lon: 23.5, label: 'Aegina' },
  { name: 'wadden', lat: 53.19, lon: 5.39, label: 'Harlingen' },
] as const

async function openMapAt(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('button', { name: 'Naar op de kaart kiezen' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Huidige locatie' }).click()
  await sheet.getByRole('button', { name: 'Naar het gekozen punt' }).click()
  return sheet
}

for (const area of AREAS) {
  test.describe(area.name, () => {
    test.use({ viewport: { width: 360, height: 800 }, geolocation: { latitude: area.lat, longitude: area.lon }, permissions: ['geolocation'] })

    test(`kaart ${area.name}: OpenStreetMap-detail, namen en naamsvermelding`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const external: string[] = []
      page.on('request', (r) => {
        const url = new URL(r.url())
        if (url.hostname !== 'localhost' && url.hostname !== 'api.github.com') external.push(url.hostname)
      })
      await mockGithub(page)
      await createNewLogbook(page)
      const sheet = await openMapAt(page)
      await expect(sheet.locator('.map-osm').first()).toBeAttached({ timeout: 15_000 })
      await expect(sheet.locator('.map-attribution')).toHaveText('© OpenStreetMap-bijdragers')
      for (let i = 0; i < 2; i++) await sheet.getByRole('button', { name: 'Inzoomen' }).click()
      if (area.label) await expect(sheet.locator('.map-label', { hasText: area.label }).first()).toBeVisible({ timeout: 15_000 })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await expectNoHorizontalOverflow(page)
        await sheet.locator('.sea-map').screenshot({ path: `screenshots/kaart/${area.name}-z11-${scheme}.png` })
      }
      // Ver inzoomen: het fijnste detailniveau.
      for (let i = 0; i < 2; i++) await sheet.getByRole('button', { name: 'Inzoomen' }).click()
      await expect(sheet.locator('.map-osm').first()).toBeAttached()
      await sheet.locator('.sea-map').screenshot({ path: `screenshots/kaart/${area.name}-z13-dark.png` })
      expect(external).toEqual([])
      expect(errors).toEqual([])
    })
  })
}
