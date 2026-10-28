import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Agenda, deel twee: planning importeren (voorbeeld met overlappingen, niets overschrijven zonder aanzetten), periode
// markeren (rust direct, werk opent Nieuwe trip met die datums), seizoensoverzicht en delen (alleen beschikbaarheid
// zonder namen, of de volledige planning zonder boten, bedragen en notities). Alle gegevens verzonnen (tests/fixtures).

const fixture = fileURLToPath(new URL('../fixtures/planning-nep.csv', import.meta.url))

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

    test(`agenda: planning importeren, periode markeren, seizoen en delen (${lang})`, async ({ page }) => {
      // Maandag 15 februari 2027: de nep-planning (maart en april 2027) ligt in de toekomst. De tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-02-15T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)
      const sheet = page.getByRole('dialog')

      // Planning importeren: eerst het voorbeeld, zonder overlappingen gaat alles mee.
      await page.getByLabel(L('planning.file')).setInputFiles(fixture)
      await expect(sheet.getByRole('heading', { name: L('planning.check') })).toBeVisible()
      await expect(sheet.locator('.planning-rows > li')).toHaveCount(6)
      await expect(sheet.getByText('Nepweek Een')).toBeVisible()
      await shots(page, 'planning-voorbeeld', lang)
      await sheet.getByRole('button', { name: L('planning.confirm', { n: 6 }) }).click()
      await expect(page.getByText(L('planning.done', { trips: 2, days: 18 }))).toBeVisible()

      await page.getByLabel(L('calendar.chooseMonth')).fill('2027-03')
      for (const n of [6, 13, 15, 21]) await expect(day(n)).toHaveClass(/day-werk/)
      await expect(day(14)).toHaveClass(/day-rust/)
      await expect(day(22)).toHaveClass(/day-reis/)
      await expect(day(24)).toHaveClass(/day-thuis/)
      await expect(day(31)).toHaveClass(/day-beschikbaar/)
      await expect(page.locator('.cal-bar', { hasText: 'Nepcursus Twee' })).toBeVisible()

      // Nog een keer importeren: alles staat er al of overlapt; niets gaat mee zonder aanzetten.
      await page.getByLabel(L('planning.file')).setInputFiles(fixture)
      await expect(sheet.getByText(L('planning.duplicate')).first()).toBeVisible()
      await expect(sheet.getByRole('button', { name: L('planning.confirm', { n: 0 }) })).toBeDisabled()
      await sheet.getByRole('checkbox', { name: L('planning.include') }).first().check()
      await expect(sheet.getByRole('button', { name: L('planning.confirm', { n: 1 }) })).toBeEnabled()
      await shots(page, 'planning-overlap', lang)
      await sheet.getByRole('button', { name: L('common.close') }).click()
      await expect(page.locator('.cal-bar', { hasText: 'Nepweek Een' })).toHaveCount(2)

      // Periode markeren: 1 tot en met 3 maart rust (in één keer).
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await expect(page.getByText(L('calendar.markStart'))).toBeVisible()
      await day(1).click()
      await expect(day(1)).toHaveClass(/range-start/)
      await expect(page.getByText(L('calendar.markEnd'))).toBeVisible()
      await shots(page, 'periode-markeren', lang)
      await day(3).click()
      await sheet.getByRole('button', { name: L('dayType.rust') }).click()
      await expect(page.getByText(L('calendar.periodSaved', { n: 3 }))).toBeVisible()
      for (const n of [1, 2, 3]) await expect(day(n)).toHaveClass(/day-rust/)

      // Werk: 10 tot en met 14 mei (van achteren naar voren getikt) opent Nieuwe trip met die datums; Herhaal vorige
      // trip (de laatste trip vóór die periode) neemt de boot over, maar niet de datums.
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await page.getByRole('button', { name: L('calendar.next') }).click()
      await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
      await day(14).click()
      await day(10).click()
      await sheet.getByRole('button', { name: L('dayType.werk') }).click()
      await expect(sheet.getByLabel(L('week.startDate'))).toHaveValue('2027-05-10')
      await expect(sheet.getByLabel(L('week.dayCount'))).toHaveValue('5')
      await sheet.getByRole('button', { name: L('route.repeat') }).click()
      await expect(sheet.locator('input[value="Nepboot Zes"]')).toHaveCount(1)
      await expect(sheet.getByLabel(L('week.dayCount'))).toHaveValue('5')
      await expect(sheet.getByLabel(L('week.startDate'))).toHaveValue('2027-05-10')
      await sheet.getByRole('button', { name: L('week.start') }).click()
      for (const n of [10, 11, 12, 13, 14]) await expect(day(n)).toHaveClass(/day-werk/)
      await expect(day(9)).not.toHaveClass(/day-werk/)
      await expect(day(15)).not.toHaveClass(/day-werk/)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect([...github.files.keys()]).toEqual(expect.arrayContaining(['calendar.json.enc', 'trips.json.enc']))
      // Niets onversleuteld naar GitHub.
      expect(github.requests.some((r) => /Nepweek|Nepcursus|Wasdag|Nepboot/.test(r.body ?? ''))).toBe(false)

      // Seizoensoverzicht: één regel per week vanaf deze week, gaten als "Beschikbaar".
      await page.getByRole('button', { name: L('calendar.season') }).click()
      await expect(page.getByRole('heading', { name: L('season.title') })).toBeVisible()
      const weeks = page.locator('.season-week')
      await expect(weeks.first()).toHaveClass(/current/)
      await expect(weeks.first()).toContainText(`${L('dayType.beschikbaar')}:`)
      await expect(page.locator('.season')).toContainText('Nepweek Een')
      await expect(page.locator('.season')).toContainText('Nepboot Vijf')
      await expect(page.locator('.season-item.day-optie')).not.toHaveCount(0)
      await shots(page, 'seizoen', lang)
      const before = await weeks.count()
      await page.getByRole('button', { name: L('season.earlier') }).click()
      await expect.poll(() => weeks.count()).toBeGreaterThan(before)
      await page.getByRole('button', { name: L('nav.calendar'), exact: true }).first().click()

      // Delen: alleen beschikbaarheid toont geen namen, boten of notities.
      await page.getByRole('button', { name: L('calendar.share') }).click()
      await expect(page.getByRole('heading', { name: L('share.title') })).toBeVisible()
      await page.getByLabel(L('export.to'), { exact: true }).fill('2027-05-31')
      const table = page.locator('.share-table')
      await expect(table).toContainText(L('share.busy'))
      await expect(table).toContainText(L('dayType.optie'))
      await expect(table).not.toContainText(/Nep|Wasdag/)
      await shots(page, 'delen-beschikbaarheid', lang)
      // Volledige planning: trips met type en gebied, reisdagen; geen boot of notitie.
      await page.getByRole('radio', { name: L('share.full') }).click()
      await expect(table).toContainText('Nepweek Een')
      await expect(table).toContainText('Nepgebied Zuid')
      await expect(table).not.toContainText(/Nepboot|Wasdag/)
      await shots(page, 'delen-volledig', lang)
      // Afdrukken (de testbrowser heeft geen printer): alleen de tabel, zwart op wit.
      await page.evaluate(() => {
        ;(window as unknown as { printed: number }).printed = 0
        window.print = () => {
          ;(window as unknown as { printed: number }).printed++
        }
      })
      await page.getByRole('button', { name: L('share.print') }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
      await expect(page.locator('.print-root.share-print')).toContainText(L('share.titleFull'))
      await page.emulateMedia({ media: 'print' })
      await page.screenshot({ path: `screenshots/agenda/delen-print-${lang}.png`, fullPage: true })
      await page.emulateMedia({ media: 'screen' })
      expect(errors).toEqual([])
    })
  })
}
