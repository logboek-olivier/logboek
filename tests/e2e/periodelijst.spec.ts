import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// De lijst met periodes (PR 4 van het periodemodel): Nu · Komend · Afgelopen, per maand ingeklapt, filters en zoeken,
// tik = de periodepagina. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/periodelijst/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`periodes: nu, komend, afgelopen, filters en zoeken (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      // Maandag 15 februari 2027. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

      // Een trip deze week (14–20 februari), thuis 1–5 februari, en een trip in maart (zonder gelogde dagen).
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      for (const [from, to, kind, name] of [[14, 20, 'werk', 'Nepweek Nu'], [1, 5, 'thuis', '']] as const) {
        await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
        await day(from).click()
        await day(to).click()
        await sheet.getByRole('button', { name: L(`dayType.${kind}`) }).click()
        if (name) {
          await sheet.getByLabel(L('field.name'), { exact: true }).fill(name)
          await sheet.getByRole('button', { name: L('week.start') }).click()
        }
        await expect(sheet).toHaveCount(0)
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      }
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(10).click()
      await day(16).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Maart')
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(sheet).toHaveCount(0)

      await openMore(page, L('periods.title'), L('nav.more'))
      const list = page.locator('.periods')
      await expect(list.getByRole('heading', { name: L('periods.now') })).toBeVisible()
      await expect(list.locator('.section', { hasText: L('periods.now') })).toContainText('Nepweek Nu')
      // Komend en afgelopen per maand ingeklapt.
      await expect(list.getByText('Nepweek Maart')).toBeHidden()
      await list.locator('.section', { hasText: L('periods.upcoming') }).locator('summary').first().click()
      await expect(list.getByText('Nepweek Maart')).toBeVisible()
      await list.locator('.section', { hasText: L('periods.past') }).locator('summary').first().click()
      await expect(list.locator('.period-row', { hasText: L('periodKind.thuis') })).toBeVisible()
      await shots(page, 'lijst', lang)

      // Filter: reis en thuis; zoeken op naam.
      await page.getByRole('radio', { name: L('periods.filter.land') }).click()
      await expect(list.getByText('Nepweek Nu')).toHaveCount(0)
      await page.getByRole('radio', { name: L('periods.filter.alles') }).click()
      await page.getByRole('searchbox').fill('maart')
      await expect(list.locator('.period-row')).toHaveCount(1)
      await list.locator('.period-row').click()
      await expect(sheet.locator('.period-page')).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
