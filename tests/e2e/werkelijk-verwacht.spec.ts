import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Geld met twee weergaven (PR 3 van het periodemodel): Werkelijk en Verwacht. Een vaste last vanaf een voorbije maand
// staat per voorbije maand als echte uitgave bij Werkelijk (per maand aan te passen); komende maanden alleen bij
// Verwacht. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/werkelijk-verwacht/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)
    const money = (n: number) => (lang === 'nl' ? `€ ${n},00` : `€${n}.00`)

    test(`geld: werkelijk en verwacht, vaste lasten per voorbije maand geboekt (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      // Maandag 15 februari 2027. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Verwacht: een vaste last vanaf december 2026.
      await openMore(page, L('nav.money'), L('nav.more'))
      await expect(page.getByRole('tab', { name: L('money.actual') })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: L('money.expected') }).click()
      const costs = page.locator('.costs')
      await expect(costs).toContainText(L('actual.fixedHint'))
      await costs.getByRole('button', { name: L('costs.addFixed') }).click()
      const sheet = page.getByRole('dialog')
      await sheet.getByLabel(L('costs.name')).fill('Nephuur')
      await sheet.getByLabel(L('costs.amount')).fill('500')
      await sheet.getByLabel(L('costs.fromMonth')).fill('2026-12')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(sheet).toHaveCount(0)
      await shots(page, 'verwacht', lang)

      // Werkelijk: december en januari geboekt (februari loopt nog).
      await page.getByRole('tab', { name: L('money.actual') }).click()
      const table = page.locator('.actual-costs')
      await expect(table.locator('tbody tr')).toHaveCount(2)
      await expect(table).toContainText(money(500))
      await expect(page.locator('.tx', { hasText: 'Nephuur' })).toHaveCount(2)
      await shots(page, 'werkelijk', lang)

      // Eén maand aanpassen: alleen die maand verandert, en hij wordt niet opnieuw geboekt.
      await page.locator('.tx', { hasText: 'Nephuur' }).first().getByRole('button').click()
      await page.getByRole('dialog').getByRole('button', { name: L('common.edit'), exact: true }).click()
      await page.getByRole('dialog').getByLabel(L('field.amount')).fill('480')
      await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
      await expect(table).toContainText(money(480))
      await expect(page.locator('.tx', { hasText: 'Nephuur' })).toHaveCount(2)
      expect(errors).toEqual([])
    })
  })
}
