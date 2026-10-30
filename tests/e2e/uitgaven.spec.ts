import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Uitgaven logisch koppelen (PR 2 van het periodemodel): bedrag, soort, omschrijving en datum, en "Hoort bij" met de
// periodes rond die datum. Een vlucht op een reisdag hoort bij de werkweek; een uitgave op een dag zonder periode maakt
// een thuisperiode. Geen bron en geen knop Kosten/Investering meer. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/uitgaven/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`uitgaven: Hoort bij, vlucht bij de werkweek, thuisperiode op een vrije dag (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      // Maandag 15 februari 2027. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

      // Maart: 2 maart reis, 3–9 maart een werkweek.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(2).click()
      await day(2).click()
      await sheet.getByRole('button', { name: L('dayType.reis') }).click()
      await expect(day(2)).toHaveClass(/day-reis/)
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(3).click()
      await day(9).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Uitgave')
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(page.locator('.cal-bar', { hasText: 'Nepweek Uitgave' }).first()).toBeVisible()
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

      // Een vlucht op de reisdag: soort reizen, Hoort bij = de werkweek.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabExpense') }).click()
      await expect(page.getByLabel(L('field.source'))).toHaveCount(0)
      await expect(page.getByRole('radio', { name: L('kind.investering') })).toHaveCount(0)
      await page.getByLabel(L('field.amount')).fill('300')
      await page.getByRole('radiogroup', { name: L('costs.category') }).getByRole('radio', { name: L('costCategory.vervoer') }).click()
      await page.getByLabel(L('field.description')).fill('Nepvlucht')
      await page.getByLabel(L('field.date'), { exact: true }).fill('2027-03-02')
      const belongs = page.getByRole('radiogroup', { name: L('belongsTo.title') })
      await expect(belongs.getByRole('radio', { name: 'Nepweek Uitgave' })).toHaveAttribute('aria-checked', 'true')
      await expect(belongs.getByRole('radio', { name: L('periodKind.reis') })).toBeVisible()
      await shots(page, 'uitgave-reisdag', lang)
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

      // Eten op een dag zonder periode (20 februari): een nieuwe thuisperiode.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabExpense') }).click()
      await page.getByLabel(L('field.amount')).fill('15')
      await page.getByRole('radiogroup', { name: L('costs.category') }).getByRole('radio', { name: L('costCategory.eten') }).click()
      await page.getByLabel(L('field.date'), { exact: true }).fill('2027-02-20')
      await expect(belongs.getByRole('radio', { name: L('belongsTo.new', { kind: L('periodKind.thuis') }) })).toHaveAttribute('aria-checked', 'true')
      await shots(page, 'uitgave-vrije-dag', lang)
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await expect(day(20)).toHaveClass(/day-thuis/)
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

      // De vlucht staat bij de werkweek; de thuisperiode heeft zijn eigen uitgave.
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await day(4).click()
      await sheet.locator('.day-view-trip').click()
      await expect(sheet.locator('.period-page')).toContainText(L('week.amountsHidden', { n: 1 }))
      await sheet.getByRole('button', { name: L('common.close') }).first().click()
      await page.getByRole('button', { name: L('calendar.prev') }).click()
      await day(20).click()
      await sheet.locator('.day-view-trip').click()
      await expect(sheet.locator('.period-page')).toContainText(L('week.amountsHidden', { n: 1 }))
      await shots(page, 'thuisperiode', lang)

      // Niets onversleuteld naar GitHub.
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect(github.requests.some((r) => /Nepvlucht|Nepweek/.test(r.body ?? ''))).toBe(false)
      expect(errors).toEqual([])
    })
  })
}
