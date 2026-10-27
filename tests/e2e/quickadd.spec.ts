import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('Toevoegen: tabs Dag · Fooi · Kosten, opent op Dag; zonder boot geen blokkerende melding; notitie komt bij de dag', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveText(['Dag', 'Inkomsten', 'Uitgave'])
  await expect(page.getByRole('tab', { name: 'Dag' })).toHaveAttribute('aria-selected', 'true')
  for (const label of ['Datum', 'Van', 'Naar', 'Zeemijlen', 'Nachturen', 'Wind (bft)', 'Boot', 'Notitie']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  }
  for (const name of ['Rol', 'Trip']) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Watertype' })).toBeVisible()
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
  await expectNoHorizontalOverflow(page)

  // Geen boot ingevuld: opslaan kan gewoon.
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('12,5')
  await page.getByLabel('Notitie').fill('Nepnotitie bij de dag')
  await expect(page.locator('.error')).toHaveCount(0)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Dag opgeslagen')

  await page.getByRole('navigation').getByRole('button', { name: 'Logboek', exact: true }).click()
  await page.locator('.trip').first().getByRole('button').first().click()
  await page.locator('.leg-button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('Bijzonderheden')).toHaveValue('Nepnotitie bij de dag')
  expect(errors).toEqual([])
})
