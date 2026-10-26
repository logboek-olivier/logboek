import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { mockRates } from './helpers/rates'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('fooi, kosten en een dag toevoegen; Geld toont alles in euro (USD tegen de ECB-koers), verwijderen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })

  // Fooi in EUR
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Fooi' }).click()
  await page.getByLabel('Bedrag').fill('120,50')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Fooi opgeslagen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  // Fooi in USD: apart tonen, nooit omrekenen
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Fooi' }).click()
  await page.getByLabel('Bedrag').fill('200')
  await page.getByLabel('Valuta').selectOption('USD')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Fooi opgeslagen')).toBeVisible()

  // Kosten; valuta is nu laatst gebruikt (USD) → via Meer terug naar EUR
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Kosten' }).click()
  await page.getByLabel('Bedrag').fill('35')
  await page.getByLabel('Omschrijving').fill('Taxi haven')
  await page.getByRole('button', { name: 'Meer velden' }).click()
  await page.getByLabel('Valuta').selectOption('EUR')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Kosten opgeslagen')).toBeVisible()

  // Dag: opent op Dag, alle velden in beeld.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Dag' })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('42')
  await page.getByRole('radio', { name: 'Getij' }).click()
  await page.getByLabel('Nachturen').fill('2')
  await page.getByLabel('Wind (bft)').fill('3-4')
  await page.getByLabel('Boot', { exact: true }).fill('Nepboot')
  await expect(page.getByRole('combobox', { name: 'Week', exact: true })).toHaveValue('__nieuw__')
  await page.getByLabel('Naam van de week').fill('Testtocht')
  await page.getByLabel('Notitie').fill('Nepnotitie')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()

  // Tweede dag: van = vorige bestemming, boot en rol laatst gebruikt, dezelfde week.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await expect(page.getByLabel('Van', { exact: true })).toHaveValue('Nephaven')
  await expect(page.getByLabel('Boot', { exact: true })).toHaveValue('Nepboot')
  await expect(page.getByRole('combobox', { name: 'Rol' })).toHaveValue('schipper')
  await expect(page.getByRole('combobox', { name: 'Week', exact: true }).locator('option:checked')).toHaveText('Testtocht')
  await page.getByLabel('Naar', { exact: true }).fill('Nepbaai')
  await page.getByLabel('Zeemijlen').fill('8')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()

  await page.getByRole('button', { name: 'Logboek' }).click()
  await expect(page.locator('.trip')).toHaveCount(1)
  await expect(page.locator('.trip').first()).toContainText('Testtocht')
  await expect(page.locator('.trip').first()).toContainText('50 nm')
  // De tweede dag erft het watertype van de vorige dag (getij).
  await expect(page.locator('.grid')).toContainText('Getijdenwater50 nm')

  // Geld
  await openMore(page, 'Geld')
  await expect(page.getByRole('heading', { name: 'Geld' })).toBeVisible()
  const grid = page.locator('.grid')
  // $ 200 tegen 1,25 USD per euro = € 160; het originele bedrag staat klein bij de transactie.
  await expect(grid).toContainText('Inkomsten€ 280,50')
  await expect(grid).toContainText('Kosten€ 35,00')
  await expect(grid).toContainText('Saldo€ 245,50')
  await expect(page.locator('main')).not.toContainText('Andere valuta')
  await expect(page.locator('.tx').filter({ hasText: '$ 200,00' })).toContainText('€ 160,00')
  await expect(page.locator('.tx')).toHaveCount(3)
  await expectNoHorizontalOverflow(page)

  // Verwijderen zonder bevestigingsvraag, met "Verwijderd · Ongedaan maken".
  let dialogs = 0
  page.on('dialog', (d) => {
    dialogs++
    void d.dismiss()
  })
  await page.getByRole('button', { name: /Taxi haven.*Bewerken/ }).click()
  await expect(page.getByRole('dialog', { name: 'Kosten bewerken' })).toBeVisible()
  await page.getByRole('button', { name: 'Verwijderen' }).click()
  await expect(page.locator('.tx')).toHaveCount(2)
  await expect(grid).toContainText('Kosten€ 0,00')
  await expect(page.locator('.toast')).toContainText('Verwijderd')
  await page.getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.locator('.tx')).toHaveCount(3)
  await expect(grid).toContainText('Kosten€ 35,00')

  // Bewerken: bedrag van de kosten aanpassen.
  await page.getByRole('button', { name: /Taxi haven.*Bewerken/ }).click()
  await page.getByRole('dialog').getByLabel('Bedrag').fill('40')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(grid).toContainText('Kosten€ 40,00')

  // En definitief verwijderen; de melding verdwijnt na 5 seconden.
  await page.getByRole('button', { name: /Taxi haven.*Bewerken/ }).click()
  await page.getByRole('button', { name: 'Verwijderen' }).click()
  await expect(page.locator('.tx')).toHaveCount(2)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 7_000 })
  expect(dialogs).toBe(0)

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Nephaven')
  expect(wire).not.toContain('Taxi')
  expect(wire).not.toContain('120.5')
  expect(errors).toEqual([])
})
