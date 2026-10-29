import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Gedetailleerde OpenStreetMap-kaart in de vier vaargebieden: kustlijnen, meren, namen van eilanden, havens en
// plaatsen en de naamsvermelding; alleen kaartbestanden van de eigen site. Schermafbeeldingen per gebied en zoom.

// Per gebied een naam op zoom 11 en de soorten die verder ingezoomd (zoom 13) verschijnen.
const AREAS = [
  { name: 'bvi', lat: 18.405, lon: -64.62, label: 'Norman Island', kinds: ['.map-poi-marina', '.map-label-baai'] },
  { name: 'dalmatie', lat: 43.49, lon: 16.44, label: 'Split', kinds: ['.map-poi-marina', '.map-label-baai'] },
  { name: 'saronisch', lat: 37.72, lon: 23.5, label: 'Aegina', kinds: ['.map-label-baai'] },
  { name: 'wadden', lat: 53.176, lon: 5.414, label: 'Harlingen', kinds: ['.map-poi-marina'] },
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
      // Ver inzoomen: het fijnste detailniveau, en meer soorten namen (baaien, marina's), elk met een eigen stijl.
      for (let i = 0; i < 2; i++) await sheet.getByRole('button', { name: 'Inzoomen' }).click()
      await expect(sheet.locator('.map-osm').first()).toBeAttached()
      for (const kind of area.kinds) await expect(sheet.locator(kind).first()).toBeVisible({ timeout: 15_000 })
      // Namen overlappen elkaar niet.
      const boxes = await sheet.locator('.map-label').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]))
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i]!, boxes[j]!]
          expect(a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1, `${i} en ${j} overlappen`).toBe(false)
        }
      await page.emulateMedia({ colorScheme: 'light' })
      await sheet.locator('.sea-map').screenshot({ path: `screenshots/kaart/${area.name}-z13-light.png` })
      await page.emulateMedia({ colorScheme: 'dark' })
      await sheet.locator('.sea-map').screenshot({ path: `screenshots/kaart/${area.name}-z13-dark.png` })
      expect(external).toEqual([])
      expect(errors).toEqual([])
    })
  })
}
