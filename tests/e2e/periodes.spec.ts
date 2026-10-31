import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Periodemodel (docs/PERIODEMODEL.md): reis, thuis en vrij zijn periodes. Periode markeren maakt een periode, een dag
// ernaast maakt hem langer, een dagtoestand midden erin splitst hem. Een uitgave zonder periode staat in Nakijken
// (Vandaag toont alleen het aantal) en één tik lost het op. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/periodes/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`periodes in de agenda en Nakijken (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      // Maandag 15 februari 2027. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

      // Periode markeren: 1 tot en met 5 maart thuis.
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(1).click()
      await day(5).click()
      await sheet.getByRole('button', { name: L('dayType.thuis') }).click()
      for (const n of [1, 3, 5]) await expect(day(n)).toHaveClass(/day-thuis/)
      // Een dag ernaast wordt deel van dezelfde periode; de dagkaart noemt de periode.
      await day(6).click()
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await sheet.getByRole('radio', { name: L('dayType.thuis') }).click()
      await expect(day(6)).toHaveClass(/day-thuis/)
      await expect(sheet.locator('.day-trip')).toContainText(L('periodKind.thuis'))
      await sheet.getByRole('button', { name: L('common.close') }).click()
      await day(3).click()
      await expect(sheet.locator('.day-view-type')).toContainText(L('day.source.periode'))
      await expect(sheet.locator('.day-view-trip')).toContainText('6')
      await shots(page, 'dagkaart', lang)
      // Midden erin een dagtoestand: de periode splitst.
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await sheet.getByRole('radio', { name: L('dayType.optie') }).click()
      await expect(day(3)).toHaveClass(/day-optie/)
      await sheet.getByRole('button', { name: L('common.close') }).click()
      for (const n of [2, 4]) await expect(day(n)).toHaveClass(/day-thuis/)
      await shots(page, 'maand', lang)
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

      // Een uitgave op een dag zonder periode (10 februari): Nakijken.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabExpense') }).click()
      await page.getByLabel(L('field.amount')).fill('12')
      await page.getByRole('button', { name: L('common.more'), exact: true }).click()
      await page.getByLabel(L('field.date'), { exact: true }).fill('2027-02-10')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      const notice = page.locator('.review-notice')
      await expect(notice).toContainText(L('review.notice', { n: 1 }))
      // Vandaag toont geen bedragen.
      await expect(notice).not.toContainText('12')
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      await notice.getByRole('button', { name: L('review.open') }).click()
      await expect(page.getByRole('heading', { name: L('review.title') })).toBeVisible()
      await shots(page, 'nakijken', lang)
      await page.getByRole('button', { name: L('review.makeHome') }).click()
      await expect(page.getByText(L('review.empty'))).toBeVisible()
      await expect(page.getByText(L('review.fixed'))).toBeVisible()

      // Alles versleuteld naar GitHub, ook het nieuwe bestand met periodes.
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      await expect.poll(() => github.files.has('periods.json.enc')).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
