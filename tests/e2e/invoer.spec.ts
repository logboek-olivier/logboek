import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, openMore } from './helpers/logbook'

// Fundering: invoer komt goed terecht. Een uitgave hangt alleen aan de trip van haar datum ("Geen trip" blijft geen
// trip), en een dag kan naar een geplande trip die nog geen dagen heeft. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 740 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function newTrip(page: Page, name: string, start: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
}

test('een uitgave hangt alleen aan de trip van haar datum, en "Geen trip" blijft geen trip', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await newTrip(page, 'Nepweek voorbij', iso(-20))

  // Vandaag valt in geen trip: standaard geen trip (niet de vorige trip).
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Uitgave' }).click()
  await page.getByLabel('Bedrag').fill('12')
  await page.getByLabel('Omschrijving').fill('Nepboodschappen')
  await page.getByRole('button', { name: 'Meer velden' }).click()
  await expect(page.getByRole('combobox', { name: 'Trip', exact: true })).toHaveValue('')
  // Een datum in de trip: dan de trip; zelf "Geen trip" kiezen blijft geen trip.
  await page.getByLabel('Datum').fill(iso(-18))
  await expect(page.getByRole('combobox', { name: 'Trip', exact: true })).not.toHaveValue('')
  await page.getByRole('combobox', { name: 'Trip', exact: true }).selectOption({ value: '' })
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('opgeslagen')

  await openMore(page, 'Geld', 'Meer')
  await page.getByRole('button', { name: /Nepboodschappen.*Bekijken/ }).click()
  const view = page.getByRole('dialog', { name: 'Kosten' })
  await expect(view).toBeVisible()
  await expect(view).not.toContainText('Nepweek voorbij')
  expect(errors).toEqual([])
})

test('een dag kan naar een geplande trip die nog geen dagen heeft', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await newTrip(page, 'Nepweek gepland', iso(30))
  // Een dag in een andere (nieuwe) trip.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('7')
  await page.getByLabel('Boot', { exact: true }).fill('Nepboot')
  const tripSelect = page.getByRole('combobox', { name: 'Trip', exact: true })
  if ((await tripSelect.inputValue()) === '__nieuw__') await page.getByLabel('Naam van de trip').fill('Nepweek los')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()
  // Dag bewerken via het Logboek: de geplande trip staat in de keuzelijst.
  await openMore(page, 'Logboek', 'Meer')
  await page.locator('.trip').filter({ hasText: 'Nepweek los' }).getByRole('button').first().click()
  await page.getByRole('dialog').getByRole('button', { name: /^Dag van .* bekijken$/ }).first().click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Bewerken' }).click()
  const sheet = page.getByRole('dialog', { name: 'Dag bewerken' })
  await sheet.getByLabel('Trip').selectOption({ label: 'Nepweek gepland' })
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(sheet).toHaveCount(0)
  expect(errors).toEqual([])
})

test('een vergeten dag in een eerdere trip: de trip volgt de datum (geen nieuwe trip), tot je zelf een trip kiest', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await newTrip(page, 'Nepweek vorige maand', iso(-30))
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  const trip = page.getByRole('combobox', { name: 'Trip', exact: true })
  // Vandaag valt in geen trip: een nieuwe trip.
  await expect(trip).toHaveValue('__nieuw__')
  await page.getByLabel('Datum').fill(iso(-28))
  await expect(trip.locator('option:checked')).toHaveText('Nepweek vorige maand')
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('6')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()
  await openMore(page, 'Logboek', 'Meer')
  await expect(page.locator('.trip').filter({ hasText: 'Nepweek vorige maand' })).toHaveCount(1)
  await expect(page.locator('.trip')).toHaveCount(1)
  expect(errors).toEqual([])
})
