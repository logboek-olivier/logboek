import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook } from './helpers/logbook'

// Agenda: geïmporteerde tochten (zonder datums) staan vanzelf als werkdagen met trip, boot en nm; een dag zelf
// instellen en terug naar automatisch; vegen en "Naar vandaag"; het Logboek onder Meer en via de agenda.
// Alle gegevens verzonnen (tests/fixtures).

const fixture = new URL('../fixtures/mijlen-nep.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

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

async function swipe(page: Page, dx: number) {
  const box = (await page.locator('.cal').boundingBox())!
  const y = box.y + box.height / 2
  const x = box.x + box.width / 2
  await page.locator('.cal').dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x, clientY: y }], changedTouches: [{ identifier: 1, clientX: x, clientY: y }] })
  await page.locator('.cal').dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: x + dx, clientY: y }] })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1]) => translate(lang, key as 'common.next')

    test(`agenda: geïmporteerde tochten als werkdagen, dag zelf instellen, maanden wisselen (${lang})`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Onderbalk: Agenda in plaats van Logboek; het Logboek staat onder Meer.
      const nav = page.getByRole('navigation')
      await expect(nav.getByRole('button', { name: L('nav.logbook'), exact: true })).toHaveCount(0)
      await openLogbook(page, lang)
      await page.getByLabel(L('import.file')).setInputFiles(fixture)
      await page.getByRole('button', { name: L('import.import') }).click()
      await page.getByRole('button', { name: L('gaps.skip') }).click()

      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await expect(page.getByRole('heading', { name: L('nav.calendar'), exact: true })).toBeVisible()
      await shots(page, 'maand-nu', lang)
      // Snel naar juni 2024 met de maandkiezer: de geïmporteerde tocht van 10–12 juni staat er als werk, met nm.
      await page.getByLabel(L('calendar.chooseMonth')).fill('2024-06')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)
      for (const n of [10, 11, 12]) await expect(day(n)).toHaveClass(/day-werk/)
      await expect(day(9)).not.toHaveClass(/day-werk/)
      await expect(day(10)).toContainText('30')
      await expect(page.locator('.cal-bar').first()).toBeVisible()
      await expect(page.locator('.agenda-summary')).toContainText('110')
      await shots(page, 'maand-trip', lang)

      // Vegen: naar juli (de tocht van 20–21 juli) en terug.
      await swipe(page, -120)
      await expect(page.getByRole('heading', { level: 2 }).first()).toContainText(/juli|July/)
      await expect(day(20)).toHaveClass(/day-werk/)
      await swipe(page, 120)
      await expect(day(10)).toHaveClass(/day-werk/)

      // Dagblad van een werkdag: trip, boot van de trip, nm en "Dag loggen".
      await day(11).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('radio', { name: L('dayType.werk') })).toHaveAttribute('aria-checked', 'true')
      await expect(sheet.getByLabel(L('day.boat'))).toHaveAttribute('placeholder', /Nepboot Twee/)
      await expect(sheet.getByRole('button', { name: L('day.log') })).toBeVisible()
      await shots(page, 'dagblad-werk', lang)
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Een dag zelf instellen: reis met van, naar en vlucht; daarna terug naar automatisch.
      await page.getByRole('button', { name: L('calendar.toToday') }).click()
      await expect(page.locator('.cal-day.today')).toHaveCount(1)
      await page.locator('.cal-day.today').click()
      await sheet.getByRole('radio', { name: L('dayType.reis') }).click()
      await sheet.getByLabel(L('day.from')).fill('Nepstad')
      await sheet.getByLabel(L('day.to')).fill('Nephaven')
      await sheet.getByLabel(L('day.flight')).fill('NP 123')
      await shots(page, 'dagblad-reis', lang)
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.cal-day.today')).toHaveClass(/day-reis/)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect([...github.files.keys()]).toContain('calendar.json.enc')
      // Niets onversleuteld naar GitHub.
      expect(github.requests.some((r) => (r.body ?? '').includes('Nepstad'))).toBe(false)
      await page.locator('.cal-day.today').click()
      await sheet.getByRole('button', { name: L('day.auto') }).click()
      await expect(sheet.getByRole('radio', { name: L('dayType.beschikbaar') })).toHaveAttribute('aria-checked', 'true')
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Het Logboek ook via de agenda, met terug naar de agenda.
      await page.getByRole('button', { name: L('nav.logbook') }).click()
      await expect(page.getByRole('heading', { name: L('nav.logbook'), exact: true })).toBeVisible()
      await page.getByRole('button', { name: L('nav.calendar'), exact: true }).first().click()
      await expect(page.getByRole('heading', { name: L('nav.calendar'), exact: true })).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
