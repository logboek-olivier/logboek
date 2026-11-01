import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Meer → Opslag → Excel opnieuw importeren (CLAUDE.md, uitgangspunt 1): eerst een voorbeeld met de getallen, per trip
// de eerste en laatste dag en wat er vervangen wordt; pas na Importeren verandert er iets. Een tocht die uit de Excel
// ging, staat daarna in de prullenbak. De terugknop sluit het voorbeeld zonder te importeren. Verzonnen gegevens.

const fixture = new URL('../fixtures/mijlen-nep.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** De nep-mijlenregistratie zonder de laatste tocht (die begint op 20 juli 2024). */
function withoutLastTrip(): Buffer {
  const lines = readFileSync(fixture, 'utf8').split(/\r?\n/)
  const last = lines.findIndex((l) => l.startsWith('2024-07-20'))
  return Buffer.from(lines.slice(0, last).join('\r\n'), 'utf8')
}

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/excel-herstart/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`Excel opnieuw importeren: voorbeeld, terug, importeren, prullenbak (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })

      await openMore(page, L('nav.storage'), L('nav.more'))
      await expect(page.getByRole('heading', { name: L('storage.reimport') })).toBeVisible()
      await page.getByLabel(L('import.file')).setInputFiles(fixture)
      await expect(page.getByRole('heading', { name: L('import.check') })).toBeVisible()
      await expect(page.locator('.import-plan')).toContainText(L('import.planNew', { trips: '3', days: '8' }))
      // Per trip de eerste en laatste dag van zijn blok.
      await expect(page.locator('.import-trips > li')).toHaveCount(3)
      await expect(page.locator('.import-trips > li').first()).toContainText(L('import.days', { n: 2 }))
      await shots(page, 'voorbeeld', lang)

      // De terugknop sluit het voorbeeld; er is niets geïmporteerd.
      await page.goBack()
      await expect(page.getByRole('heading', { name: L('storage.reimport') })).toBeVisible()

      await page.getByLabel(L('import.file')).setInputFiles(fixture)
      await page.getByRole('button', { name: L('import.import') }).click()
      await expect(page.getByText(L('import.done'), { exact: true })).toBeVisible()

      // Opnieuw, zonder de laatste tocht: die gaat naar de prullenbak, de rest blijft.
      await page.getByLabel(L('import.file')).setInputFiles({ name: 'mijlen.csv', mimeType: 'text/csv', buffer: withoutLastTrip() })
      await expect(page.locator('.import-plan')).toContainText(L('import.planMatched', { n: '2' }))
      await expect(page.locator('.import-plan')).toContainText(L('import.planTrash', { trips: '1', days: '2' }))
      await shots(page, 'vervangen', lang)
      await page.getByRole('button', { name: L('import.import') }).click()
      await expect(page.getByText(L('import.done'), { exact: true })).toBeVisible()

      await openMore(page, L('trash.title'), L('nav.more'))
      const item = page.locator('li', { hasText: L('trash.kind.import') })
      await expect(item).toHaveCount(1)
      await shots(page, 'prullenbak', lang)
      expect(errors).toEqual([])
    })
  })
}
