import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Afstand meten op de kaart (ronde 2, PR 4): knop Meten, twee of meer punten aantikken, de afstand over water (dezelfde
// waterroute als het mijlenvoorstel) en hemelsbreed, met de route getekend. Tikken zet in deze stand geen plaats.

async function shots(page: Page, name: string, lang: Lang) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/kaart/${name}-${scheme}-${lang}.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    // Bij Norman Island (BVI): water rondom.
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 }, geolocation: { latitude: 18.3, longitude: -64.62 }, permissions: ['geolocation'] })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`meten: over water en hemelsbreed, punt weg, klaar (${lang})`, async ({ page }) => {
      test.setTimeout(90_000)
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('button', { name: L('map.open', { field: L('field.to') }) }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.locator('.map-osm').first()).toBeAttached({ timeout: 15_000 })
      const canvas = sheet.locator('.sea-map-canvas')
      const box = (await canvas.boundingBox())!

      // Naar Norman Island (de huidige locatie ligt er net ten zuiden van) en inzoomen: de route over water moet om het
      // eiland heen.
      await sheet.getByRole('button', { name: L('map.here') }).click()
      await sheet.getByRole('button', { name: L('map.center') }).click()
      for (let i = 0; i < 2; i++) await sheet.getByRole('button', { name: L('map.zoomIn') }).click()
      await page.waitForTimeout(400)
      const marker = sheet.locator('.map-marker circle').first()
      const markerAt = async () => {
        const b = (await marker.boundingBox())!
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
      }
      const before = await markerAt()
      await sheet.getByRole('button', { name: L('map.measure'), exact: true }).click()
      await expect(sheet.getByRole('button', { name: L('map.measure'), exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(sheet.locator('.map-measure')).toContainText(L('map.measureHint'))
      // Twee punten op het water aan weerszijden van het eiland.
      await canvas.click({ position: { x: box.width / 2 - 75, y: box.height / 2 - 30 } })
      await expect(sheet.locator('.map-measure-point')).toHaveCount(1)
      await expect(sheet.locator('.map-measure')).toContainText(L('map.measureNext'))
      await canvas.click({ position: { x: box.width / 2 + 75, y: box.height / 2 - 30 } })
      await expect(sheet.locator('.map-measure-point')).toHaveCount(2)
      const result = sheet.locator('.map-measure-result')
      await expect(result).toContainText(L('map.measureWater'))
      await expect(result).toContainText(L('map.measureStraight'))
      await expect(result.locator('strong')).toHaveText(/^[\d.,]+ nm$/, { timeout: 15_000 })
      await expect(sheet.locator('.map-route.measure')).toBeAttached()
      const nm = (text: string) => Number(text.replace(/[^\d,.]/g, '').replace(lang === 'nl' ? /\./g : /,/g, '').replace(',', '.'))
      const water = nm((await result.locator('strong').textContent())!)
      const straight = nm((await result.locator('.muted .num').textContent())!)
      expect(water).toBeGreaterThanOrEqual(straight)
      expect(straight).toBeGreaterThan(0)
      // Een derde punt: de afstanden lopen op; het laatste punt weghalen zet ze terug.
      await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.2 } })
      await expect(sheet.locator('.map-measure-point')).toHaveCount(3)
      await expect.poll(async () => nm((await result.locator('.muted .num').textContent())!)).toBeGreaterThan(straight)
      await shots(page, 'meten', lang)
      await sheet.getByRole('button', { name: L('map.measureUndo') }).click()
      await expect(sheet.locator('.map-measure-point')).toHaveCount(2)
      await expect.poll(async () => nm((await result.locator('.muted .num').textContent())!)).toBe(straight)
      // Tikken in de meetstand verplaatst het gekozen punt niet.
      expect(await markerAt()).toEqual(before)
      // Klaar: de meetstand is weg; een tik zet weer een punt.
      await sheet.getByRole('button', { name: L('map.measureDone') }).click()
      await expect(sheet.locator('.map-measure')).toHaveCount(0)
      await expect(sheet.locator('.map-measure-point')).toHaveCount(0)
      await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.9 } })
      await expect.poll(async () => (await markerAt()).y).toBeGreaterThan(before.y + 50)
      await expect(sheet.getByLabel(L('map.placeName'))).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
