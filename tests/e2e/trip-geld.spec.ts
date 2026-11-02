import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, openMore } from './helpers/logbook'

// Salaris en geld per tocht (src/domain/geldmodel.ts: het salaris is één loon-transactie met een status): "Geen
// salaris" op Vandaag, het salaris en de fooien in "Trip bewerken", het resultaat van de tocht (de som van zijn
// transacties) achter "Toon bedragen", en "Zeilgeld: resultaat" in Geld. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 740 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function openTripFromLog(page: Page, name: string) {
  await openMore(page, 'Logboek', 'Meer')
  await page.locator('.trip').filter({ hasText: name }).getByRole('button').first().click()
}

/** Het salaris van een tocht zetten via Trip bewerken → Fooien en inkomsten → Salaris (verwacht, met een bedrag). */
async function setSalary(page: Page, name: string, amount: string) {
  await openTripFromLog(page, name)
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken' }).click()
  const edit = page.getByRole('dialog', { name: 'Trip bewerken' })
  await edit.getByRole('button', { name: /^Fooien en inkomsten/ }).click()
  await expect(edit.locator('.salary-row')).toContainText('Nog geen salaris')
  await edit.locator('.salary-row').click()
  const sheet = page.getByRole('dialog').last()
  await expect(sheet.getByRole('radio', { name: 'Verwacht' })).toHaveAttribute('aria-checked', 'true')
  await sheet.getByLabel('Salaris (bedrag)').fill(amount)
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Salaris opgeslagen')
  await page.getByRole('dialog', { name: 'Trip bewerken' }).getByRole('button', { name: 'Sluiten', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('geen salaris, fooi toevoegen bij de trip, resultaat van de trip en zeilgeld', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })

  // Een voorbije trip van Yacht Week met een verwacht salaris.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).first().click()
  let sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nep trainingsweek')
  await sheet.getByLabel('Startdatum').fill(iso(-20))
  await sheet.getByLabel('Organisatie').selectOption({ label: 'Yacht Week' })
  // Geen salarisveld in het tripformulier: het salaris is een eigen transactie bij de tocht.
  await expect(sheet.getByLabel('Salaris (bedrag)')).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Een dag in de trip, zodat hij in het Logboek staat.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Datum').fill(iso(-18))
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('5')
  await page.getByRole('combobox', { name: 'Trip', exact: true }).selectOption({ label: 'Nep trainingsweek' })
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await setSalary(page, 'Nep trainingsweek', '600')

  // Vandaag vraagt of het salaris binnen is: "Geen salaris" haalt de vraag weg.
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  const question = page.locator('.salary-question').filter({ hasText: 'Nep trainingsweek' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Geen salaris' }).click()
  await expect(page.locator('.toast')).toContainText('Geen salaris voor deze trip')
  await expect(question).toHaveCount(0)

  // Trip bewerken: fooien en inkomsten van de trip, met toevoegen.
  await openTripFromLog(page, 'Nep trainingsweek')
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken' }).click()
  sheet = page.getByRole('dialog', { name: 'Trip bewerken' })
  await sheet.getByRole('button', { name: /Fooien en inkomsten/ }).click()
  // Het salaris is één regel; een tik opent het salarisblad, met "Geen salaris" gekozen.
  await expect(sheet.locator('.salary-row')).toContainText('Geen salaris')
  await sheet.locator('.salary-row').click()
  const salarySheet = page.getByRole('dialog').last()
  await expect(salarySheet.getByRole('radio', { name: 'Geen salaris' })).toHaveAttribute('aria-checked', 'true')
  await salarySheet.getByRole('button', { name: 'Sluiten' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await sheet.locator('.trip-income').getByLabel('Bedrag').fill('100')
  await sheet.getByRole('button', { name: 'Inkomsten toevoegen' }).click()
  await expect(page.locator('.toast')).toContainText('Inkomsten opgeslagen')
  await expect(sheet.locator('.trip-income')).toContainText('Fooi')
  await expect(sheet.locator('.trip-result')).toContainText('€ 100,00')
  await sheet.getByRole('button', { name: 'Opslaan', exact: true }).click()
  // Na opslaan weer het tripoverzicht (terug waar je was): het resultaat achter "Toon bedragen".
  await expect(page.getByRole('dialog')).toHaveCount(1)
  const overview = page.getByRole('dialog')
  await overview.getByRole('button', { name: 'Toon bedragen' }).click()
  await expect(overview.locator('.trip-result')).toContainText('Resultaat van de trip')
  await expect(overview.locator('.trip-result')).toContainText('€ 100,00')
  await expect(overview).toContainText('Geen salaris')
  await overview.getByRole('button', { name: 'Sluiten' }).click()

  // Geld: zeilgeld als resultaat, met uitleg; geen salaris te ontvangen.
  await openMore(page, 'Geld', 'Meer')
  await expect(page.getByRole('main')).toContainText('Zeilgeld: resultaat')
  await expect(page.getByRole('main')).toContainText('Dit is niet je netto waarde')
  // Geen rekeningen en niets te ontvangen (geen salaris, geen contant meer): geen Mijn positie.
  await expect(page.locator('.position')).toHaveCount(0)
  expect(errors).toEqual([])
})
