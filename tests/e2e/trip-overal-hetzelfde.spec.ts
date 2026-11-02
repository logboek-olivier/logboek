import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Een trip is overal hetzelfde (CLAUDE.md, Periodepagina): Trip bewerken heeft dezelfde onderdelen in dezelfde volgorde
// als de periodepagina (overzicht, route en dagen met "Dag toevoegen" en per dag bekijken en bewerken, mensen, geld,
// notitie). De vaste checklists passen bij de soort trip: geen paklijst voor delivery en oversteek bij een training.
// Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/trip-overal-hetzelfde/${name}-360-${scheme}-${lang}.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`Trip bewerken zoals de periodepagina, met Dag toevoegen; checklists bij de soort (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      // Maandag 15 maart 2027, na de trip. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-03-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

      // Een trip van 6 tot en met 13 maart, soort werk · les geven.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(6).click()
      await day(13).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Gelijk')
      await sheet.getByRole('radio', { name: L('weekType.training-geven') }).click()
      await sheet.getByRole('button', { name: L('week.start') }).click()

      // Tripoverzicht → potlood → Trip bewerken: Dag toevoegen, opslaan, en Trip bewerken staat er weer met de dag.
      await day(7).click()
      await sheet.locator('.day-view-trip', { hasText: 'Nepweek Gelijk' }).click()
      await expect(sheet.getByRole('heading', { name: L('checklist.section') })).toBeVisible()
      await expect(sheet).not.toContainText(lang === 'nl' ? 'Paklijst delivery' : 'Packing list delivery')
      await sheet.getByRole('button', { name: L('common.edit') }).first().click()
      const edit = page.getByRole('dialog').last()
      await edit.getByRole('button', { name: L('trip.addDay') }).click()
      const layer = page.locator('.add-layer')
      await layer.getByLabel(L('field.to'), { exact: true }).fill('Nepbaai')
      await layer.getByRole('button', { name: L('common.save') }).click()
      await expect(layer).toHaveCount(0)
      await expect(edit.locator('.leg-button')).toHaveCount(1)
      // Dezelfde volgorde als de periodepagina: dagen vóór mensen, mensen vóór geld.
      const order = await edit.evaluate((root) => {
        const pos = (sel: string) => [...root.querySelectorAll('*')].indexOf(root.querySelector(sel)!)
        return [pos('.leg-button'), pos('.participants'), pos('.trip-income')]
      })
      expect(order[0]).toBeLessThan(order[1]!)
      expect(order[1]).toBeLessThan(order[2]!)
      await shots(page, 'trip-bewerken', lang)
      // Per dag bewerken en verwijderen in Trip bewerken.
      await edit.locator('.leg-row .btn.icon').first().click()
      await page.getByRole('dialog').last().getByRole('button', { name: L('common.delete') }).click()
      await expect(edit.locator('.leg-button')).toHaveCount(0)

      // Soort training (zelf leren): geen paklijst voor delivery en oversteek.
      await edit.getByRole('radio', { name: L('periodKind.training'), exact: true }).click()
      await edit.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await expect(sheet).not.toContainText(lang === 'nl' ? 'Paklijst delivery' : 'Packing list delivery')
      expect(errors).toEqual([])
    })
  })
}
