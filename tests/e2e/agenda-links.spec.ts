import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Koppelingen: Vandaag volgt de dagsoort (werk: loggen; reis: reisgegevens; thuis: niets te loggen); een trip
// verlengen en inkorten vanuit de agenda; termijnen op hun dag; inkomsten per werkdag en per maand (bedragen pas na
// een tik). Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/agenda/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`agenda-koppelingen: Vandaag, trip verlengen en inkorten, termijnen, geld per werkdag (${lang})`, async ({ page }) => {
      // Maandag 8 maart 2027; de tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-03-08T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)
      const today = page.locator('.today-kind')

      // Een trip van 6 tot en met 13 maart, via periode markeren.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(6).click()
      await day(13).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Koppel')
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(page.locator('.cal-bar', { hasText: 'Nepweek Koppel' }).first()).toBeVisible()

      // Vandaag (werk): de trip en "Dag van vandaag loggen".
      await nav.getByRole('button', { name: L('nav.today'), exact: true }).click()
      await expect(today).toHaveClass(/day-werk/)
      await expect(today).toContainText('Nepweek Koppel')
      await expect(page.getByRole('button', { name: L('today.logDay') })).toBeVisible()

      // Thuis: niets te loggen.
      await today.click()
      await sheet.getByRole('radio', { name: L('dayType.thuis') }).click()
      await sheet.getByRole('button', { name: L('common.close') }).click()
      await expect(today).toHaveClass(/day-thuis/)
      await expect(today).toContainText(L('today.nothingToLog'))
      await expect(page.getByRole('button', { name: L('today.logDay') })).toHaveCount(0)

      // Reis: de reisgegevens.
      await today.click()
      await sheet.getByRole('radio', { name: L('dayType.reis') }).click()
      await sheet.getByLabel(L('day.from')).fill('Nepstad')
      await sheet.getByLabel(L('day.to')).fill('Nephaven')
      await sheet.getByLabel(L('day.flight')).fill('NP 42')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(today).toHaveClass(/day-reis/)
      await expect(today).toContainText('Nepstad → Nephaven · NP 42')
      await expect(page.getByRole('button', { name: L('today.logDay') })).toHaveCount(0)
      await shots(page, 'vandaag-reis', lang)

      // Terug naar automatisch: weer werk.
      await today.click()
      await sheet.getByRole('button', { name: L('day.auto') }).click()
      await sheet.getByRole('button', { name: L('common.close') }).click()
      await expect(today).toHaveClass(/day-werk/)

      // Agenda → trip: werk op 15 maart verlengt de trip (14 maart komt erbij); rust op de laatste dag maakt hem korter.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await day(15).click()
      await sheet.getByRole('radio', { name: L('dayType.werk') }).click()
      await shots(page, 'dagblad-verlengen', lang)
      await sheet.getByRole('button', { name: new RegExp(`Nepweek Koppel`) }).click()
      for (const n of [14, 15]) await expect(day(n)).toHaveClass(/day-werk/)
      await expect(page.locator('.cal-week').nth(2).locator('.cal-bar')).toHaveText('Nepweek Koppel')
      await day(15).click()
      await expect(sheet.getByText(L('day.source.trip'))).toBeVisible()
      await sheet.getByRole('radio', { name: L('dayType.rust') }).click()
      await expect(page.getByText(/Nepweek Koppel: /)).toBeVisible()
      await sheet.getByRole('button', { name: L('common.close') }).click()
      await expect(day(15)).toHaveClass(/day-rust/)
      await expect(day(14)).toHaveClass(/day-werk/)

      // Termijn op zijn dag: toevoegen vanuit het dagblad van 20 maart, met een stip in de agenda.
      await day(20).click()
      await sheet.getByRole('button', { name: L('reminder.new') }).click()
      await sheet.getByLabel(L('reminder.title')).fill('Neptermijn')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(day(20).locator('.cal-dot')).toHaveCount(1)
      await day(20).click()
      await expect(sheet.locator('.day-reminders')).toContainText('Neptermijn')
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Inkomsten: per maand en per werkdag in de agenda (pas na Toon bedragen) en onder Geld.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await page.getByLabel(L('field.amount')).fill('300')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await expect(page.locator('.agenda-income')).not.toContainText('300')
      await page.getByRole('button', { name: L('week.showAmounts') }).click()
      // 6, 7 en 8 maart zijn tot en met vandaag werk: € 300 / 3 = € 100 per werkdag.
      await expect(page.locator('.agenda-income')).toContainText(lang === 'nl' ? '€ 300,00' : '€300.00')
      await expect(page.locator('.agenda-income')).toContainText(L('calendar.perWorkday', { amount: lang === 'nl' ? '€ 100,00' : '€100.00' }))
      await openMore(page, L('nav.money'), L('nav.more'))
      const table = page.locator('.workday-table')
      await expect(table).toContainText(lang === 'nl' ? '€ 100,00' : '€100.00')
      await shots(page, 'geld-per-werkdag', lang)

      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect(github.requests.some((r) => /Nepweek|Nepstad|Neptermijn/.test(r.body ?? ''))).toBe(false)
      expect(errors).toEqual([])
    })
  })
}
