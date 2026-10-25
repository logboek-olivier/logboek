import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('fooi, kosten en een dag toevoegen; Geld toont totalen, andere valuta apart, verwijderen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })

  // Fooi in EUR
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await page.getByLabel('Bedrag').fill('120,50')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Fooi opgeslagen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  // Fooi in USD: apart tonen, nooit omrekenen
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await page.getByLabel('Bedrag').fill('200')
  await page.getByLabel('Valuta').selectOption('USD')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Fooi opgeslagen')).toBeVisible()

  // Kosten; valuta is nu laatst gebruikt (USD) → via Meer terug naar EUR
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await page.getByRole('tab', { name: 'Kosten' }).click()
  await page.getByLabel('Bedrag').fill('35')
  await page.getByLabel('Omschrijving').fill('Taxi haven')
  await page.getByRole('button', { name: 'Meer' }).click()
  await page.getByLabel('Valuta').selectOption('EUR')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Kosten opgeslagen')).toBeVisible()

  // Dag
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await page.getByRole('tab', { name: 'Dag' }).click()
  await page.getByLabel('Naar (plaats)').fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('42')
  await page.getByRole('radio', { name: 'Getij' }).click()
  await page.getByRole('button', { name: 'Meer' }).click()
  await page.getByLabel('Boot').fill('Nepboot')
  await page.getByLabel('Naam tocht').fill('Testtocht')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()

  // Tweede dag: standaardwaarden uit de vorige dag, dezelfde tocht
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await page.getByRole('tab', { name: 'Dag' }).click()
  await expect(page.getByText('Van Nephaven · Nepboot · Schipper · tocht Testtocht')).toBeVisible()
  await page.getByLabel('Naar (plaats)').fill('Nepbaai')
  await page.getByLabel('Zeemijlen').fill('8')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()

  await page.getByRole('button', { name: 'Zeilen' }).click()
  await expect(page.locator('.card')).toHaveCount(1)
  await expect(page.locator('.card').first()).toContainText('Testtocht')
  await expect(page.locator('.card').first()).toContainText('50 nm')
  // De tweede dag erft het watertype van de vorige dag (getij).
  await expect(page.locator('.grid')).toContainText('Getijdenwater50 nm')

  // Geld
  await page.getByRole('button', { name: 'Geld' }).click()
  await expect(page.getByRole('heading', { name: 'Geld' })).toBeVisible()
  const grid = page.locator('.grid')
  await expect(grid).toContainText('Inkomsten€ 120,50')
  await expect(grid).toContainText('Kosten€ 35,00')
  await expect(grid).toContainText('Saldo€ 85,50')
  await expect(grid).toContainText('Andere valuta+$ 200,00')
  await expect(page.locator('.card')).toHaveCount(3)
  await expectNoHorizontalOverflow(page)

  // Fooi van vandaag is aan de tocht van vandaag gekoppeld (via sync-bestanden niet zichtbaar; controle via lijst volstaat)
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: /Verwijder Kosten/ }).click()
  await expect(page.locator('.card')).toHaveCount(2)
  await expect(grid).toContainText('Kosten€ 0,00')

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Nephaven')
  expect(wire).not.toContain('Taxi')
  expect(wire).not.toContain('120.5')
  expect(errors).toEqual([])
})
