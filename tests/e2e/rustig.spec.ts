import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore, PASSPHRASE } from './helpers/logbook'

// Rustige schermen (november 2026): Vandaag toont alleen een trip waarin vandaag valt; Deze trip een korte kop met de
// rest achter één tik en zonder komende trips; de dagkaart zegt duidelijk bij welke trip de dag hoort en de trip heeft
// een terugknop naar die dag; onder de agenda altijd zes vakjes (nm in een voorbije maand, "Nog vrij" in de lopende of
// een komende maand); Statistieken zonder het Yachtmaster-blok. Alle gegevens verzonnen.

test('rustige schermen: Vandaag zonder voorbije trip, korte tripkop, dag en trip in de agenda, zes vakjes', async ({ page }) => {
  // Woensdag 4 november 2026: midden in een trip van 2 tot en met 6 november.
  await page.clock.setSystemTime(new Date('2026-11-04T10:00:00'))
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill('2026-11-02')
  await page.getByLabel('Einddatum').fill('2026-11-06')
  await page.getByLabel('Naam', { exact: true }).fill('Nepweek Rustig')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.locator('.today-trip')).toContainText('Nepweek Rustig')

  // Een week later, de trip niet afgerond: Vandaag toont hem niet meer; Deze trip wel (om af te ronden).
  await page.clock.setSystemTime(new Date('2026-11-11T10:00:00'))
  await page.reload()
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.today-trip')).toHaveCount(0)
  await expect(page.locator('.today-kind')).toBeVisible()

  // Deze trip: een korte kop (naam, datums en dagen); soort en boot staan in Tripgegevens. Geen komende trips.
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  const head = page.locator('.trip-head')
  await expect(head.locator('h2')).toHaveText(/Nepweek Rustig/)
  await expect(head).toContainText('5 dagen')
  await expect(page.locator('main')).not.toContainText('Komende trips')
  await page.locator('.trip-head-summary').click()
  const details = page.getByRole('dialog', { name: 'Tripgegevens' })
  await expect(details).toContainText('Nepweek Rustig')
  await details.getByRole('button', { name: 'Sluiten' }).click()
  await expectNoHorizontalOverflow(page)

  // Agenda: de dagkaart zegt bij welke trip de dag hoort; de trip heeft een terugknop naar die dag.
  await nav.getByRole('button', { name: 'Agenda', exact: true }).click()
  const day = (n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)
  await day(4).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('.sheet-kicker')).toHaveText('Dag')
  await expect(sheet.locator('.day-view-trip')).toContainText('Hoort bij trip')
  await sheet.locator('.day-view-trip').click()
  await expect(sheet.locator('.sheet-kicker')).toHaveText('Trip')
  await sheet.getByRole('button', { name: /4 nov/ }).click()
  await expect(sheet.locator('.sheet-kicker')).toHaveText('Dag')
  await sheet.getByRole('button', { name: 'Sluiten' }).click()

  // Zes vakjes, altijd: in de lopende maand "Nog vrij", in een voorbije maand de nm.
  await expect(page.locator('.agenda-stat')).toHaveCount(6)
  await expect(page.locator('.agenda-summary')).toContainText('Nog vrij')
  await page.getByRole('button', { name: 'Vorige maand' }).click()
  await expect(page.locator('.agenda-stat')).toHaveCount(6)
  await expect(page.locator('.agenda-summary')).toContainText('nm')
  await expectNoHorizontalOverflow(page)

  // Statistieken: geen Yachtmaster-blok meer.
  await openMore(page, 'Statistieken')
  await expect(page.locator('main')).not.toContainText('Yachtmaster')
  expect(errors).toEqual([])
})
