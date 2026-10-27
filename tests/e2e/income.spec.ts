import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('Toevoegen: Dag · Inkomsten · Uitgave; inkomsten horen bij een trip, de trip volgt de datum', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')

  // Een eerdere trip en een lopende trip.
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  for (const [start, name] of [[iso(-40), 'Neptrip vroeger'], [iso(-2), 'Neptrip nu']] as const) {
    await page.getByRole('button', { name: 'Nieuwe trip' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Naam', { exact: true }).fill(name)
    await sheet.getByLabel('Startdatum').fill(start)
    await fillBoat(sheet)
    await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }

  await nav.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveText(['Dag', 'Inkomsten', 'Uitgave'])
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  const kinds = page.getByRole('radiogroup', { name: 'Soort' })
  await expect(kinds.getByRole('radio')).toHaveText(['Fooi', 'Loon of dagtarief', 'Bonus of provisie', 'Terugbetaling onkosten', 'Overig'])
  await expect(page.getByRole('combobox', { name: 'Trip', exact: true }).locator('option:checked')).toHaveText('Neptrip nu')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/inkomsten.png', fullPage: true })

  // Loon van de eerdere trip: datum terugzetten, de trip volgt mee.
  await page.getByLabel('Bedrag').fill('900')
  await kinds.getByRole('radio', { name: 'Loon of dagtarief' }).click()
  await page.getByLabel('Datum', { exact: true }).fill(iso(-38))
  await expect(page.getByRole('combobox', { name: 'Trip', exact: true }).locator('option:checked')).toHaveText('Neptrip vroeger')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Loon of dagtarief')

  // Fooi en terugbetaling in de lopende trip; daarna een uitgave.
  await nav.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Soort' }).getByRole('radio', { name: 'Loon of dagtarief' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radiogroup', { name: 'Soort' }).getByRole('radio', { name: 'Fooi' }).click()
  await page.getByLabel('Bedrag').fill('120')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await nav.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Uitgave' }).click()
  await page.getByLabel('Bedrag').fill('30')
  await page.getByLabel('Omschrijving').fill('Nepboodschappen')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  // Deze trip: alleen de fooi en de uitgave van de lopende trip.
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('button', { name: 'Toon bedragen' }).click()
  const money = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Inkomsten en uitgaven' }) })
  await expect(money).toContainText('€ 120,00')
  await expect(money).toContainText('€ 30,00')
  await expect(money).not.toContainText('900')
  expect(errors).toEqual([])
})
