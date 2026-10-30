import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook } from './helpers/logbook'

// De tripkop: "6 dagen · 1 gelogd" in Deze trip en op Vandaag; geen nachten meer. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 740 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('dagen en gelogde dagen in de tripkop, zonder nachten', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nep zesdaagse')
  await sheet.getByLabel('Startdatum').fill(iso(-1))
  await sheet.getByLabel('Aantal dagen').fill('6')
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.trip-head')).toContainText('6 dagen · 0 gelogd')

  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('7')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()
  await expect(page.locator('.today-trip')).toContainText('6 dagen · 1 gelogd')

  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.locator('.trip-head')).toContainText('6 dagen · 1 gelogd')
  await expect(page.locator('.trip-totals')).not.toContainText('Nachten')
  await expect(page.locator('.trip-totals')).toContainText('Gelogd')
  expect(errors).toEqual([])
})
