import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Eén periodepagina, overal hetzelfde (PR 1 van het periodemodel): vaste volgorde Overzicht · Route en dagen · Mensen ·
// Planning · Geld · Notities, in Deze trip en in het tripoverzicht uit de agenda. Bewerken toont de gelogde dagen, die
// daar direct te bewerken en te verwijderen zijn. Geld direct bij de periode. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang, fullPage = false) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/periodepagina/${name}-${width}-${scheme}-${lang}.png`, fullPage })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`periodepagina: Deze trip en tripoverzicht, dagen bewerken, geld bij de periode (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      // Maandag 15 februari 2027. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

      // Een trip van 14 tot en met 20 februari: soort werk, subtype les geven.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(14).click()
      await day(20).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Pagina')
      await expect(sheet.getByRole('radio', { name: L('periodKind.werk') })).toHaveAttribute('aria-checked', 'true')
      await sheet.getByRole('radio', { name: L('weekType.skipper-charter') }).click()
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(page.locator('.cal-bar', { hasText: 'Nepweek Pagina' }).first()).toBeVisible()

      // Een dag loggen (vandaag, 15 februari).
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

      // Deze trip: vaste volgorde van de onderdelen.
      await nav.getByRole('button', { name: L('nav.week'), exact: true }).click()
      const headings = page.locator('.period-page > .section > h2, .period-page > .section h2:first-child')
      await expect(headings.first()).toHaveText(L('period.routeAndDays'))
      const order = await page.locator('.period-page h2').allTextContents()
      const at = (text: string) => order.indexOf(text)
      expect(at(L('period.routeAndDays'))).toBeGreaterThanOrEqual(0)
      expect(at(L('period.routeAndDays'))).toBeLessThan(at(L('checklist.section')))
      await expect(page.locator('.trip-head')).toContainText(`${L('periodKind.werk')} · ${L('weekType.skipper-charter')}`)
      await expect(page.locator('.leg-row')).toHaveCount(1)
      await shots(page, 'deze-trip', lang, true)

      // Geld direct bij de periode: + Uitgave.
      await page.getByRole('button', { name: L('period.addExpense'), exact: true }).click()
      await expect(sheet.getByRole('heading')).toContainText('Nepweek Pagina')
      await sheet.getByLabel(L('field.amount')).fill('20')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(sheet).toHaveCount(0)
      await expect(page.locator('.period-page')).toContainText(L('week.amountsHidden', { n: 1 }))
      // Geld komt na de checklists, in de vaste volgorde.
      const after = await page.locator('.period-page h2').allTextContents()
      expect(after.indexOf(L('checklist.section'))).toBeLessThan(after.indexOf(L('week.money')))

      // Bewerken (potlood): de gelogde dagen staan erbij, direct te bewerken en te verwijderen.
      await page.locator('.trip-head').getByRole('button', { name: new RegExp(L('week.edit')) }).click()
      await expect(sheet.locator('.leg-row')).toHaveCount(1)
      await shots(page, 'trip-bewerken', lang)
      await sheet.locator('.leg-row .btn.icon').click()
      await expect(page.getByRole('dialog', { name: L('edit.day') })).toBeVisible()
      await page.getByRole('dialog', { name: L('edit.day') }).getByRole('button', { name: L('common.delete') }).click()
      await expect(page.getByText(L('toast.deleted'))).toBeVisible()
      await page.getByRole('button', { name: L('common.undo') }).click()
      await expect(sheet.locator('.leg-row')).toHaveCount(1)
      await sheet.getByRole('button', { name: L('common.close') }).first().click()

      // Dezelfde pagina vanuit de agenda: dagkaart → trip.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await day(15).click()
      await sheet.locator('.day-view-trip').click()
      await expect(sheet.locator('.period-page h3').first()).toHaveText(L('period.routeAndDays'))
      await expect(sheet.locator('.leg-row')).toHaveCount(1)
      await shots(page, 'tripoverzicht', lang)
      expect(errors).toEqual([])
    })
  })
}
