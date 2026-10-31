import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Losse fouten uit de schermafbeeldingen (PR 5 van het periodemodel): de dagkaart zonder "geen fooi", geld per periode
// alleen als er iets is; geen placeholders die op ingevulde waarden lijken; cursusgeld bij een training als uitgave
// (soort opleiding) vanaf de periode, met een negatief resultaat. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/losse-fouten/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`losse fouten: dagkaart, placeholders, cursusgeld bij een training (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

      // Een training (zelf leren): RYA Offshore prep, 15–19 februari.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(15).click()
      await day(19).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('RYA Offshore prep')
      await sheet.getByRole('radio', { name: L('periodKind.training'), exact: true }).click()
      // Geen voorbeeldwaarden die op ingevulde waarden lijken.
      await expect(sheet.getByLabel(L('boat.model'))).toHaveAttribute('placeholder', L('boat.modelPlaceholder'))
      expect(L('boat.modelPlaceholder')).toMatch(lang === 'nl' ? /^bijv\./ : /^e\.g\./)
      await expect(sheet.getByLabel(L('boat.length'))).not.toHaveAttribute('placeholder', /.+/)
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(sheet).toHaveCount(0)
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

      // De dagkaart zonder geld: geen regel "geen fooi".
      await day(16).click()
      await expect(sheet.locator('.day-view')).not.toContainText(L('day.tipNo'))
      await expect(sheet.locator('.day-tips')).toHaveCount(0)
      // Cursusgeld vanaf de periode: + Uitgave, standaard soort opleiding.
      await sheet.locator('.day-view-trip').click()
      await sheet.getByRole('button', { name: L('period.addExpense'), exact: true }).click()
      const form = page.getByRole('dialog').last()
      await expect(form.getByRole('radio', { name: L('costCategory.opleiding') })).toHaveAttribute('aria-checked', 'true')
      await form.getByLabel(L('field.amount')).fill('450')
      await form.getByLabel(L('field.description')).fill('Nepcursusgeld')
      await form.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(1)
      const page1 = page.getByRole('dialog')
      await page1.getByRole('button', { name: L('week.showAmounts') }).click()
      await expect(page1.locator('.trip-result')).toContainText(lang === 'nl' ? '€ 450,00' : '€450.00')
      await expect(page1.locator('.trip-result .negative')).toBeVisible()
      // Training: geen regel voor salaris zonder bedrag.
      await expect(page1.locator('.trip-result')).not.toContainText(L('tripResult.salaryExpected'))
      await shots(page, 'training-geld', lang)
      await page1.getByRole('button', { name: L('common.close') }).first().click()

      // De dagkaart met geld (vandaag, 15 februari): per periode, bedragen pas na een tik.
      await day(15).click()
      await expect(sheet.locator('.day-tips')).toContainText('RYA Offshore prep')
      await shots(page, 'dagkaart', lang)
      expect(errors).toEqual([])
    })
  })
}
