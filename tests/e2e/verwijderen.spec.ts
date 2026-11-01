import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore } from './helpers/logbook'

// PR B: één vast patroon voor alles. Tikken opent bewerken met alle velden; onderaan "Verwijderen", daarna 10 seconden
// "Ongedaan maken". Een periode verwijderen staat alleen onder "⋯" en gaat naar de prullenbak. Overlappende trips, een
// tikfout in een tripnaam, een trip met dagen naar de prullenbak en terug, de boot "xxx", een deelnemer. Alle gegevens
// zijn verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function newTrip(page: Page, name: string, start: string, days: number, boat = '', participant = ''): Promise<void> {
  await openLogbook(page)
  await page.getByRole('button', { name: 'Nieuwe trip' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  await sheet.getByLabel('Aantal dagen').fill(String(days))
  if (boat) await sheet.getByLabel('Bootnaam', { exact: true }).fill(boat)
  if (participant) await sheet.getByLabel('Deelnemer 1', { exact: true }).fill(participant)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
}

test('overlappende trips zonder melding, tikfout in de naam herstellen, trip met dagen naar de prullenbak en terug', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  // Twee trips op dezelfde dagen, zoals "Weel 44" en een tweede trip in oktober. De overlap valt op vandaag, zodat hij
  // ook aan het eind van de maand in het zichtbare raster van de agenda staat.
  await newTrip(page, 'Weel 44', iso(-1), 7, '', 'Nepanna')
  await newTrip(page, 'Nepweek BVI', iso(0), 7)
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  // Overlap is normaal: geen melding en geen keuze in de agenda.
  await expect(page.locator('.overlap-notice')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  // De tikfout in de naam: vanuit de dagkaart naar het tripoverzicht, daar het potlood.
  await page.locator('.cal-day.today').click()
  await page.getByRole('dialog').getByRole('button', { name: /Weel 44/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken', exact: true }).click()
  const edit = page.getByRole('dialog')
  await edit.getByLabel('Naam', { exact: true }).fill('Week 44')
  await edit.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.cal-bar').first()).toContainText('Week 44')

  // Een dag loggen in een tweede trip en die trip daarna verwijderen: de dag gaat mee naar Week 44.
  await newTrip(page, 'Nepweek eerder', iso(-20), 3)
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Datum', { exact: true }).fill(iso(-20))
  await page.getByRole('combobox', { name: 'Trip', exact: true }).selectOption({ label: 'Nepweek eerder' })
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await openLogbook(page)
  await page.locator('.trip').filter({ hasText: 'Nepweek eerder' }).getByRole('button').first().click()
  // Verwijderen staat alleen onder "⋯" in de kop van de periode, nooit in het bewerkscherm of bij de dagen.
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^(Trip|Periode) verwijderen$/ })).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click()
  await page.locator('.trip').filter({ hasText: 'Nepweek eerder' }).getByRole('button').first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Meer bij Nepweek eerder' }).click()
  const menu = page.getByRole('dialog').last()
  await menu.getByRole('button', { name: 'Periode verwijderen' }).click()
  await expect(menu.locator('.delete-choice')).toContainText('Hieraan hangt: 1 gelogde dag.')
  await expect(menu.getByRole('button', { name: 'Geld en dagen behouden zonder periode' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/bewerken/trip-verwijderen.png' })
  await menu.getByRole('button', { name: 'Alles naar de prullenbak' }).click()
  await expect(page.locator('.toast')).toContainText('Nepweek eerder staat in de prullenbak')
  await expect(page.locator('.trip').filter({ hasText: 'Nepweek eerder' })).toHaveCount(0)

  // Meer → Prullenbak: met de dag terug.
  await openMore(page, 'Prullenbak')
  await page.getByRole('button', { name: /Nepweek eerder/ }).click()
  const restore = page.getByRole('dialog')
  await expect(restore).toContainText('Komt terug met 1 gelogde dag.')
  await page.screenshot({ path: 'screenshots/bewerken/prullenbak-terugzetten.png' })
  await restore.getByRole('button', { name: 'Terugzetten' }).click()
  await expect(page.locator('.toast')).toContainText('Nepweek eerder is teruggezet')
  await openLogbook(page)
  await expect(page.locator('.trip').filter({ hasText: 'Nepweek eerder' })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('de boot "xxx" verwijderen en een deelnemer bewerken en verwijderen, met ongedaan maken', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await newTrip(page, 'Nepweek', iso(0), 7, 'xxx', 'Nik')

  await openMore(page, 'Boten')
  const editBoat = async () => {
    await page.getByRole('button', { name: 'Boot bekijken: xxx' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Boot verwijderen' })).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Bewerken', exact: true }).click()
  }
  await editBoat()
  await page.getByRole('dialog').getByRole('button', { name: 'Boot verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('xxx verwijderd')
  await expect(page.getByRole('button', { name: 'Boot bekijken: xxx' })).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.getByRole('button', { name: 'Boot bekijken: xxx' })).toHaveCount(1)
  await editBoat()
  await page.getByRole('dialog').getByRole('button', { name: 'Boot verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('xxx verwijderd')

  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('button', { name: 'Deelnemer bekijken: Nik' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Deelnemer verwijderen' })).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Bewerken', exact: true }).click()
  await sheet.getByLabel('Voornaam').fill('Nick')
  await sheet.getByLabel('Land').fill('VS')
  await expectNoHorizontalOverflow(page)
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /^Deelnemer bekijken: Nick/ })).toBeVisible()
  await page.getByRole('button', { name: /^Deelnemer bekijken: Nick/ }).click()
  await expect(sheet).toContainText('VS')
  await sheet.getByRole('button', { name: 'Bewerken', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Deelnemer verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('verwijderd')
  await expect(page.getByRole('button', { name: /^Deelnemer bekijken/ })).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.getByRole('button', { name: /^Deelnemer bekijken: Nick/ })).toBeVisible()
  expect(errors).toEqual([])
})
