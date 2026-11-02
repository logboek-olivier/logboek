import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { mockRates } from './helpers/rates'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Doorklikken in Geld (src/components/DrillSheet.tsx): een tik op Kosten toont de posten eronder in de periode bovenaan,
// per soort met subtotalen die optellen tot het getikte bedrag; een post opent de transactie; terug brengt Geld terug op
// dezelfde scrollpositie. Op 360 px, alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block' })

async function addExpense(page: Page, amount: string, note: string, category: string) {
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Uitgave' }).click()
  await page.getByLabel('Bedrag').fill(amount)
  await page.getByLabel('Omschrijving').fill(note)
  await page.getByRole('radio', { name: category }).click()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('opgeslagen')
  await expect(page.locator('.add-layer')).toHaveCount(0)
}

test('Kosten doorklikken: posten per soort, een post openen, terug op dezelfde plek', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await addExpense(page, '40', 'Nepboodschappen', 'Eten en drinken')
  await addExpense(page, '25,50', 'Nepbus', 'Reizen')
  await addExpense(page, '12', 'Neplunch', 'Eten en drinken')
  // Een inkomen, zodat Geld de totalen toont.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('100')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Fooi')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  await openMore(page, 'Geld')
  const costs = page.locator('.grid').getByRole('button', { name: /^Kosten: / })
  await expect(costs).toHaveAccessibleName('Kosten: € 77,50')
  // Halverwege de pagina: na terug moet Geld op precies deze plek staan.
  await costs.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 120))
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(0)
  await costs.click()

  const drill = page.getByRole('dialog', { name: 'Kosten' })
  await expect(drill.locator('.drill-total')).toContainText('€ 77,50')
  await expect(drill).toContainText('Periode:')
  // Per soort: eten en drinken 52,00 (twee posten) en reizen 25,50; samen het getikte bedrag.
  const groups = drill.locator('.drill-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0)).toContainText('Eten en drinken')
  await expect(groups.nth(0).locator('h3')).toContainText('€ 52,00')
  await expect(groups.nth(1).locator('h3')).toContainText('€ 25,50')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/doorklik-kosten.png', fullPage: true })

  // Een post opent de transactie (bekijken, met het potlood om te bewerken).
  await drill.getByRole('button', { name: /Nepbus/ }).click()
  const view = page.getByRole('dialog').last()
  await expect(view).toContainText('Nepbus')
  await expect(view.getByRole('button', { name: 'Bewerken', exact: true })).toBeVisible()
  // Terug (Android): eerst de transactie dicht, dan het doorklikscherm, dan Geld op dezelfde plek.
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Geld', level: 1 })).toBeVisible()
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2)

  // Inkomsten in dezelfde periode: de som van zijn posten.
  await page.locator('.grid').getByRole('button', { name: /^Inkomsten: / }).click()
  await expect(page.getByRole('dialog', { name: 'Inkomsten' }).locator('.drill-total')).toContainText('€ 100,00')
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(errors).toEqual([])
})
