import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// PR D: snel een trip toevoegen via het plusje. Alleen start- en einddatum zijn nodig; naam en type krijgen een voorstel
// uit de vorige trip. Overlapt de nieuwe trip een bestaande, dan dezelfde keuze als bij overlappende trips.
// Verzonnen gegevens.

test.use({ viewport: { width: 360, height: 800 } })

function iso(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('trip toevoegen met alleen de datums; de volgende krijgt een naamvoorstel; overlap geeft de keuze', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)

  // Toevoegen opent op Dag; Trip staat ervoor.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Dag' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill(iso(30))
  await expect(page.getByLabel('Einddatum')).toHaveValue(iso(36))
  await page.getByLabel('Naam', { exact: true }).fill('Nepweek 1')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/bewerken/trip-toevoegen.png' })
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')

  // De volgende: naamvoorstel uit de vorige trip ("Nepweek 2"), alleen de datums invullen.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill(iso(40))
  await page.getByLabel('Einddatum').fill(iso(46))
  await expect(page.getByLabel('Naam', { exact: true })).toHaveAttribute('placeholder', 'Nepweek 2')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')

  // Een trip die de eerste overlapt: direct de keuze.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill(iso(33))
  await page.getByLabel('Einddatum').fill(iso(35))
  await page.getByLabel('Naam', { exact: true }).fill('Plaatshouder')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Overlappende trips' })
  await expect(sheet).toContainText('Nepweek 1 en Plaatshouder liggen op dezelfde dagen')
  await sheet.getByRole('radio', { name: /Nepweek 1/ }).click()
  await sheet.getByRole('button', { name: 'Vervangen' }).click()
  await expect(page.locator('.toast')).toContainText('Vervangen door Nepweek 1')
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.locator('main')).toContainText('Nepweek 1')
  await expect(page.locator('main')).not.toContainText('Plaatshouder')
  expect(errors).toEqual([])
})
