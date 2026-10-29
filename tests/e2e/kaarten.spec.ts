import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openMore } from './helpers/logbook'

// Meer → Kaarten (ronde 2, PR 5): per vaargebied de grootte en of het offline is; "Offline beschikbaar maken" zet alle
// kaartbestanden van het gebied in de kaartcache van de service worker, zodat de kaart daar zonder verbinding werkt,
// ook op plekken waar nog nooit gekeken is; "Verwijderen" haalt ze weg. Het gebied van de lopende trip gaat vanzelf.

async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
}

const cachedOsm = (page: Page, area: string) =>
  page.evaluate(async (id) => {
    const cache = await caches.open('kaart-osm')
    return (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith(`/logboek/osm/${id}/`)).length
  }, area)

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    // Bij Virgin Gorda (BVI), waar in deze test nog nooit gekeken is.
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 }, geolocation: { latitude: 18.45, longitude: -64.43 }, permissions: ['geolocation'] })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`kaarten: gebied offline maken, offline gebruiken, verwijderen (${lang})`, async ({ page, context }) => {
      test.setTimeout(120_000)
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await waitForServiceWorker(page)
      await openMore(page, L('maps.title'), L('nav.more'))
      await expect(page.getByRole('heading', { name: L('maps.title') })).toBeVisible()
      const rows = page.locator('.map-area')
      await expect(rows).toHaveCount(4)
      const bvi = rows.filter({ hasText: lang === 'nl' ? 'Bovenwindse Eilanden en BVI' : 'Leeward Islands and BVI' })
      await expect(bvi).toContainText(L('maps.notOffline'))
      await expect(bvi).toContainText(/MB/)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/kaart/kaarten-${lang}.png`, fullPage: true })

      await bvi.getByRole('button', { name: L('maps.makeOffline') }).click()
      await expect(bvi).toContainText(L('maps.offline'), { timeout: 60_000 })
      expect(await cachedOsm(page, 'bovenwinds')).toBeGreaterThan(10)
      await expect(bvi.getByRole('button', { name: L('maps.remove') })).toBeVisible()
      await page.screenshot({ path: `screenshots/kaart/kaarten-offline-${lang}.png`, fullPage: true })

      // Zonder verbinding: de kaart van een plek waar nog nooit gekeken is, op het fijnste detailniveau.
      await context.setOffline(true)
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('button', { name: L('map.open', { field: L('field.to') }) }).click()
      const sheet = page.getByRole('dialog')
      await sheet.getByRole('button', { name: L('map.here') }).click()
      await sheet.getByRole('button', { name: L('map.center') }).click()
      for (let i = 0; i < 4; i++) await sheet.getByRole('button', { name: L('map.zoomIn') }).click()
      await expect(sheet.locator('.map-osm').first()).toBeAttached({ timeout: 15_000 })
      await sheet.getByRole('button', { name: L('common.close') }).click()
      await context.setOffline(false)

      // Verwijderen: de bestanden van het gebied zijn weg uit de cache.
      await openMore(page, L('maps.title'), L('nav.more'))
      await page.locator('.map-area', { hasText: lang === 'nl' ? 'Bovenwindse Eilanden en BVI' : 'Leeward Islands and BVI' }).getByRole('button', { name: L('maps.remove') }).click()
      await expect(page.locator('.map-area').filter({ hasText: lang === 'nl' ? 'Bovenwindse' : 'Leeward' })).toContainText(L('maps.notOffline'))
      expect(await cachedOsm(page, 'bovenwinds')).toBe(0)
      expect(errors).toEqual([])
    })
  })
}

test.describe('lopende trip', () => {
test.use({ viewport: { width: 360, height: 800 }, geolocation: { latitude: 18.45, longitude: -64.43 }, permissions: ['geolocation'] })
test('het gebied van de lopende trip gaat vanzelf offline', async ({ page }) => {
  test.setTimeout(120_000)
  await mockGithub(page)
  await createNewLogbook(page)
  await waitForServiceWorker(page)
  // Een lopende trip met een dag naar een plaats met een punt in de BVI.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nepweek BVI')
  await fillBoat(sheet)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('button', { name: 'Naar op de kaart kiezen' }).click()
  const map = page.getByRole('dialog', { name: 'Naar: plaats op de kaart' })
  await map.getByRole('button', { name: 'Huidige locatie' }).click()
  await map.getByLabel('Naam van de plaats').fill('Nepgorda')
  await map.getByRole('button', { name: 'Kiezen' }).click()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await expect.poll(() => cachedOsm(page, 'bovenwinds'), { timeout: 60_000 }).toBeGreaterThan(10)
  await openMore(page, 'Kaarten')
  const bvi = page.locator('.map-area', { hasText: 'Bovenwindse Eilanden en BVI' })
  await expect(bvi).toContainText('Offline beschikbaar', { timeout: 60_000 })
  await expect(bvi).toContainText('lopende trip')
})
})
