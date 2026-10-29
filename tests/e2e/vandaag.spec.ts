import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, PASSPHRASE } from './helpers/logbook'

// PR E: Vandaag met de lopende trip groot bovenaan (teller, dag x van y, boot, route tot nu toe), daaronder de dag
// loggen, open vragen en termijnen; geen bedragen. En snelheid: de app opent binnen 2 seconden (kaarten en grafieken
// laden pas als ze geopend worden).

test.use({ viewport: { width: 360, height: 800 } })

/** Tijd sinds het begin van het laden van de pagina tot nu, in ms (Navigation Timing). */
async function sinceNavigation(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => performance.now())
}

test('de app opent binnen 2 seconden: eerste keer en ontgrendelen', async ({ page }) => {
  await mockGithub(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Eerste keer' })).toBeVisible()
  const first = await sinceNavigation(page)
  test.info().annotations.push({ type: 'eerste keer', description: `${Math.round(first)} ms` })
  expect(first).toBeLessThan(2000)

  await createNewLogbook(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Meer', exact: true }).click()
  await page.getByRole('button', { name: /^Instellingen/ }).click()
  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await expect(page.getByLabel('Wachtzin', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Wachtzin', { exact: true })).toBeVisible()
  const unlock = await sinceNavigation(page)
  test.info().annotations.push({ type: 'ontgrendelen', description: `${Math.round(unlock)} ms` })
  expect(unlock).toBeLessThan(2000)
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
})

test('Vandaag: de lopende trip groot bovenaan, tik opent het tripoverzicht, de dagsoort de dagkaart', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)

  // Zonder lopende trip: de dagsoort in één regel.
  await expect(page.locator('.today-kind')).toBeVisible()
  await expect(page.locator('.today-trip')).toHaveCount(0)

  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nepweek Vandaag')
  await fillBoat(sheet)
  await sheet.getByRole('combobox', { name: 'Organisatie' }).selectOption({ label: 'Sailing Virgins' })
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('14')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  const card = page.locator('.today-trip')
  await expect(card).toContainText('SV #1 · Nepweek Vandaag')
  await expect(card).toContainText('Dag 1 van 7')
  await expect(card).toContainText('Nepboot · Nepmodel 40')
  await expect(card).toContainText('14 nm')
  await expect(page.locator('.today-kind')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('€')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/vandaag/trip.png', fullPage: true })

  await card.getByRole('button', { name: /bekijken$/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Gezeilde dagen')
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click()
  await card.locator('.today-trip-day').click()
  await expect(page.getByRole('dialog').locator('.day-view-type')).toContainText('Werk')
  expect(errors).toEqual([])
})
