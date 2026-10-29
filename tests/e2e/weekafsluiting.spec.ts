import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Weekafsluiting: op zondag een kaart op Vandaag met de samenvatting van de week, een cijfer en één zin; daarna terug
// te lezen op de dagkaart van de zondag in de agenda (met een merkje in het maandraster), te bewerken en te verwijderen
// met ongedaan maken. Geen bedragen. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/weekafsluiting/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`weekafsluiting: zondag op Vandaag, terug te lezen en te bewerken in de agenda (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      // Zondag 14 februari 2027 (week 6). De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-14T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')

      // Een dag loggen: die telt mee in de samenvatting.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')
      await page.getByLabel(L('field.nm')).fill('12')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.toast')).toHaveText(L('toast.daySaved'))

      // Vandaag: de kaart met de samenvatting (zonder bedragen), cijfer en zin.
      const card = page.locator('.week-close')
      await expect(card.getByRole('heading', { name: L('weekClose.title', { week: 6 }) })).toBeVisible()
      await expect(card).toContainText(L('weekClose.sailed', { days: 1, nm: '12 nm' }))
      await expect(card).toContainText(L('weekClose.places', { n: 1 }))
      await expect(card).not.toContainText('€')
      await expect(card.getByRole('button', { name: L('weekClose.save') })).toBeDisabled()
      await card.getByRole('radio', { name: '8', exact: true }).click()
      await card.getByLabel(L('weekClose.lesson')).fill('Nepzin over de week')
      await shots(page, 'vandaag', lang)
      const putsBefore = github.requests.filter((r) => r.method === 'PUT' && r.url.includes('weekreviews.json.enc')).length
      await card.getByRole('button', { name: L('weekClose.save') }).click()
      await expect(page.locator('.toast')).toHaveText(L('weekClose.saved'))
      await expect(card).toHaveCount(0)
      // Het nieuwe bestand gaat versleuteld naar GitHub.
      await expect.poll(() => github.requests.filter((r) => r.method === 'PUT' && r.url.includes('weekreviews.json.enc')).length, { timeout: 15_000 }).toBeGreaterThan(putsBefore)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Agenda: een merkje op de zondag, en de afsluiting op de dagkaart.
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      const sunday = page.locator('.cal-day.today')
      await expect(sunday.locator('.cal-closed')).toHaveCount(1)
      await expect(sunday).toHaveAttribute('aria-label', new RegExp(L('calendar.weekClosed')))
      await sunday.click()
      const section = sheet.locator('.week-closing')
      await expect(section.getByRole('heading', { name: L('weekClose.heading', { week: 6 }) })).toBeVisible()
      await expect(section).toContainText(L('weekClose.ratingLine', { rating: 8 }))
      await expect(section).toContainText('Nepzin over de week')
      await shots(page, 'dagkaart', lang)

      // Bewerken: ander cijfer.
      await section.getByRole('button', { name: L('weekClose.edit') }).click()
      const edit = page.getByRole('dialog', { name: L('weekClose.edit') })
      await expect(edit.getByRole('radio', { name: '8', exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(edit.getByLabel(L('weekClose.lesson'))).toHaveValue('Nepzin over de week')
      await edit.getByRole('radio', { name: '9', exact: true }).click()
      await edit.getByRole('button', { name: L('weekClose.save') }).click()
      await expect(edit).toHaveCount(0)
      await expect(section).toContainText(L('weekClose.ratingLine', { rating: 9 }))

      // Verwijderen met ongedaan maken.
      await section.getByRole('button', { name: L('weekClose.edit') }).click()
      await edit.getByRole('button', { name: L('common.delete') }).click()
      await expect(sheet.getByRole('button', { name: L('weekClose.title', { week: 6 }) })).toBeVisible()
      await page.getByRole('button', { name: L('common.undo') }).click()
      await expect(section).toContainText(L('weekClose.ratingLine', { rating: 9 }))
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Terug op Vandaag: de week is afgesloten, dus geen kaart meer (maandag: zie tests/week-close.test.ts).
      await nav.getByRole('button', { name: L('nav.today'), exact: true }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await expect(page.locator('.week-close')).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
