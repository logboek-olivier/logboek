import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Vandaag → Uitgaven vandaag: het aantal en de laatste drie, het totaal en de bedragen pas na "Toon bedragen"
// (studenten kunnen meekijken). "Uitgave toevoegen" opent Toevoegen op Uitgave. Alles verzonnen, op 360 px.

async function addExpense(page: import('@playwright/test').Page, amount: string, description: string, fromToday = false) {
  if (fromToday) await page.getByRole('button', { name: 'Uitgave toevoegen' }).click()
  else {
    await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
    await page.getByRole('tab', { name: 'Uitgave' }).click()
  }
  await expect(page.getByRole('tab', { name: 'Uitgave' })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Bedrag').fill(amount)
  await page.getByLabel('Omschrijving').fill(description)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.add-layer')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
}

test('Vandaag: uitgaven van vandaag, de laatste drie, bedragen pas na een tik', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  const card = page.locator('.today-expenses')
  await expect(card.getByRole('heading')).toHaveText('Uitgaven')
  await addExpense(page, '12', 'Nepontbijt', true)
  await addExpense(page, '30', 'Neptaxi')
  await addExpense(page, '4,50', 'Nepkoffie')
  await addExpense(page, '20', 'Nepboodschappen')
  await expect(card.getByRole('heading')).toHaveText('Uitgaven · 4')
  // De laatste drie, laatst ingevoerd eerst; de oudste staat als "en nog 1".
  const rows = card.locator('.today-expense-list li')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toHaveText('Nepboodschappen')
  await expect(rows.nth(2)).toHaveText('Neptaxi')
  await expect(card).toContainText('en nog 1')
  // Geen bedragen zonder tik.
  await expect(card).not.toContainText('€')
  await card.getByRole('button', { name: 'Toon bedragen' }).click()
  await expect(rows.nth(0)).toContainText('€ 20,00')
  await expect(card.locator('.today-expense-total')).toContainText('€ 66,50')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/vandaag/uitgaven.png', fullPage: true })
  // Een tik op een uitgave opent hem.
  await rows.nth(1).click()
  await expect(page.getByRole('dialog')).toContainText('Nepkoffie')
  expect(errors).toEqual([])
})
