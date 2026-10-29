import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Dagsoort Onbeschikbaar: bezet zonder werk, met een reden die alleen Olivier ziet. Te kiezen in het dagblad, bij
// Periode markeren en in de planningsimport; telt als bezet in de agenda, het seizoensoverzicht, de statistieken en
// de PDF "Alleen beschikbaarheid", en de reden staat nooit in iets dat gedeeld wordt. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/onbeschikbaar/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)

    test(`onbeschikbaar: dagblad met reden, periode, import, seizoen, statistieken en delen zonder reden (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      // Maandag 15 februari 2027. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)
      const sheet = page.getByRole('dialog')

      // Vandaag onbeschikbaar, met een reden: via de dagkaart en het potlood.
      await page.locator('.cal-day.today').click()
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await sheet.getByRole('radio', { name: L('dayType.onbeschikbaar') }).click()
      await expect(page.locator('.cal-day.today')).toHaveClass(/day-onbeschikbaar/)
      await sheet.getByLabel(L('day.reason')).fill('Nepreden tandarts')
      await shots(page, 'dagblad', lang)
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(sheet).toHaveCount(0)
      // De dagkaart toont de reden (alleen voor Olivier).
      await page.locator('.cal-day.today').click()
      await expect(sheet.locator('.day-view-type')).toContainText(L('dayType.onbeschikbaar'))
      await expect(sheet.locator('.view-rows')).toContainText('Nepreden tandarts')
      await shots(page, 'dagkaart', lang)
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Periode markeren: 1 tot en met 3 maart onbeschikbaar.
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(1).click()
      await day(3).click()
      await sheet.getByRole('button', { name: L('dayType.onbeschikbaar') }).click()
      await expect(page.getByText(L('calendar.periodSaved', { n: 3 }))).toBeVisible()
      for (const n of [1, 2, 3]) await expect(day(n)).toHaveClass(/day-onbeschikbaar/)

      // Planning importeren: soort = onbeschikbaar; de notitie wordt de reden.
      const csv = 'start;eind;soort;naam;notitie\n2027-03-08;2027-03-09;onbeschikbaar;;Nepreden import\n2027-03-10;2027-03-10;optie;;\n'
      await page.getByLabel(L('planning.file')).setInputFiles({ name: 'planning.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await expect(sheet.getByRole('heading', { name: L('planning.check') })).toBeVisible()
      await expect(sheet.locator('.planning-rows > li').first()).toContainText(L('dayType.onbeschikbaar'))
      await sheet.getByRole('button', { name: L('planning.confirm', { n: 2 }) }).click()
      await expect(page.getByText(L('planning.done', { trips: 0, days: 3 }))).toBeVisible()
      for (const n of [8, 9]) await expect(day(n)).toHaveClass(/day-onbeschikbaar/)
      await expect(page.locator('.agenda-stat.day-onbeschikbaar')).toContainText('5')
      await expect(page.locator('.agenda-stat.day-onbeschikbaar')).toContainText(L('dayType.onbeschikbaar'))
      // Het hele woord past in het vakje (geen afkapping).
      expect(await page.locator('.agenda-stat.day-onbeschikbaar dt').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await shots(page, 'maand', lang)
      await day(8).click()
      await expect(sheet.locator('.view-rows')).toContainText('Nepreden import')
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Seizoensoverzicht: onbeschikbaar staat er als dagsoort, zonder reden.
      await page.getByRole('button', { name: L('calendar.season') }).click()
      await expect(page.locator('.season-item.day-onbeschikbaar').first()).toContainText(L('dayType.onbeschikbaar'))
      await expect(page.locator('.season')).not.toContainText('Nepreden')
      await shots(page, 'seizoen', lang)
      await page.getByRole('button', { name: L('nav.calendar'), exact: true }).first().click()

      // Delen, alleen beschikbaarheid: onbeschikbaar is "Bezet", zonder reden; de volledige planning zonder reden.
      await page.getByRole('button', { name: L('calendar.share') }).click()
      await page.getByLabel(L('export.to'), { exact: true }).fill('2027-03-31')
      const table = page.locator('.share-table')
      await expect(table).toContainText(L('share.busy'))
      await expect(table).not.toContainText(L('dayType.onbeschikbaar'))
      await expect(table).not.toContainText('Nepreden')
      await shots(page, 'delen-beschikbaarheid', lang)
      await page.getByRole('radio', { name: L('share.full') }).click()
      await expect(table).toContainText(L('dayType.onbeschikbaar'))
      await expect(table).not.toContainText('Nepreden')

      // Statistieken (dit jaar): vandaag telt als onbeschikbaar, niet als werk.
      await openMore(page, lang === 'nl' ? 'Statistieken' : 'Statistics', L('nav.more'))
      await expect(page.locator('main')).toContainText(L('dayType.onbeschikbaar'))
      await page.getByRole('heading', { name: L('stats.work'), exact: true }).scrollIntoViewIfNeeded()
      // Het label blijft binnen zijn vakje.
      const tile = page.locator('.stat', { hasText: L('stats.workShare') }).locator('xpath=preceding-sibling::div[1]')
      expect(await tile.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await shots(page, 'statistieken', lang)

      // Vandaag: niets te loggen.
      await nav.getByRole('button', { name: L('nav.today'), exact: true }).click()
      await expect(page.locator('main')).toContainText(L('today.nothingToLog'))

      // Alles versleuteld naar GitHub: de reden staat nergens leesbaar in een verzoek.
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect(github.files.has('calendar.json.enc')).toBe(true)
      expect(github.requests.some((r) => /Nepreden/.test(r.body ?? ''))).toBe(false)
      expect(errors).toEqual([])
    })
  })
}
