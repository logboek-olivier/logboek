import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore } from './helpers/logbook'

// PR E: teller per organisatie. Een afkorting in de naam is twijfel en telt pas na "ja"; een nieuwe trip krijgt het
// naamvoorstel "YW #1 · <gebied>"; het beginnummer voor trips van vóór de app schuift alle nummers op. De teller staat
// in de kop van Deze trip, in de agenda-balk en in de lijsten. Verzonnen gegevens.

test.use({ viewport: { width: 360, height: 800 } })

function iso(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('teller per organisatie: twijfel bevestigen, naamvoorstel, beginnummer, kop, agenda en lijsten', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)

  // Een trip van vandaag met alleen "SV" in de naam (twijfel), en een dag erin.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await expect(page.getByLabel('Startdatum')).toHaveValue(iso(0))
  await page.getByLabel('Naam', { exact: true }).fill('SV Nepweek')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill('Nepdorp')
  await page.getByLabel('Zeemijlen').fill('12')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  await openLogbook(page)
  const doubt = page.locator('.counter-doubt')
  await expect(doubt).toContainText('Hoort SV Nepweek bij Sailing Virgins?')
  await expect(page.locator('.trip').first()).not.toContainText('SV #')
  await doubt.getByRole('button', { name: 'Ja' }).click()
  await expect(page.locator('.toast')).toHaveText('SV Nepweek is SV #1')
  await expect(doubt).toHaveCount(0)
  await expect(page.locator('.trip').first()).toContainText('SV #1 Nepweek')

  // Nieuwe trip via het plusje: Yacht Week, naamvoorstel met teller.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill(iso(10))
  await page.getByRole('button', { name: 'Meer velden' }).click()
  await page.getByLabel('Organisatie').selectOption('yacht-week')
  await page.getByLabel('Gebied').fill('Nepgebied')
  await expect(page.getByLabel('Naam', { exact: true })).toHaveAttribute('placeholder', 'YW #1 · Nepgebied')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')

  // Beginnummers voor trips van vóór de app.
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: /^Teller per organisatie/ }).click()
  await page.getByLabel('Eerste nummer SV').fill('4')
  await page.getByLabel('Eerste nummer YW').fill('10')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Teller opgeslagen')
  await expect(page.getByRole('button', { name: /^Teller per organisatie/ })).toContainText('SV #4 · YW #10')

  // Kop van Deze trip en de komende trips: de nummers schuiven mee, ook in een naam die al een nummer had.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.locator('.week-head .counter-chip')).toHaveText('SV #4')
  await expect(page.locator('.week-head-title')).toContainText('SV #4Nepweek')
  await expect(page.locator('main')).toContainText('YW #10 · Nepgebied')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/teller/deze-trip.png' })

  // Agenda-balk.
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  await expect(page.locator('.cal-bar').filter({ hasText: 'SV #4 Nepweek' })).toHaveCount(1)
  expect(errors).toEqual([])
})
