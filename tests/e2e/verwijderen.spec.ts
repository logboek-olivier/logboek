import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore } from './helpers/logbook'

// PR B: één vast patroon voor alles. Tikken opent bewerken met alle velden; onderaan "Verwijderen", daarna 10 seconden
// "Ongedaan maken". Overlappende trips, een tikfout in een tripnaam, een trip met dagen verwijderen, de boot "xxx",
// een deelnemer. Alle gegevens zijn verzonnen.

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

test('overlappende trips samenvoegen, tikfout in de naam herstellen, trip met dagen verwijderen en meenemen', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  // Twee trips op dezelfde dagen, zoals "Weel 44" en een tweede trip in oktober.
  await newTrip(page, 'Weel 44', iso(0), 7, '', 'Nepanna')
  await newTrip(page, 'Nepweek BVI', iso(3), 7)
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  const notice = page.locator('.overlap-notice')
  await expect(notice).toContainText('Weel 44 en Nepweek BVI liggen op dezelfde dagen')
  await expectNoHorizontalOverflow(page)
  await notice.getByRole('button', { name: 'Oplossen' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('radio', { name: /Weel 44/ })).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'screenshots/bewerken/overlap.png' })
  await sheet.getByRole('button', { name: 'Samenvoegen' }).click()
  await expect(page.locator('.toast')).toContainText('Samengevoegd in Weel 44')
  await expect(page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' })).toBeVisible()
  await expect(notice).toHaveCount(0)
  // Ongedaan maken (binnen 10 seconden): beide trips terug, de melding ook.
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(notice).toHaveCount(1)
  await notice.getByRole('button', { name: 'Oplossen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Samenvoegen' }).click()
  await expect(notice).toHaveCount(0)

  // De tikfout in de naam: vanuit het dagblad de trip bewerken.
  await page.locator('.cal-day.today').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Weel 44 bewerken' }).click()
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
  await page.getByRole('button', { name: 'Trip bewerken', exact: true }).first().click()
  const del = page.getByRole('dialog')
  await del.getByRole('button', { name: 'Trip verwijderen' }).click()
  await expect(del.locator('.delete-choice')).toContainText('Deze trip heeft 1 gelogde dag. Wat moet daarmee gebeuren?')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/bewerken/trip-verwijderen.png' })
  await expect(del.getByRole('combobox', { name: 'Meenemen naar trip' })).toContainText('Week 44')
  await del.getByRole('button', { name: 'Meenemen en deze trip verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('alles staat nu bij Week 44')
  await expect(page.locator('.trip').filter({ hasText: 'Nepweek eerder' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('de boot "xxx" verwijderen en een deelnemer bewerken en verwijderen, met ongedaan maken', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await newTrip(page, 'Nepweek', iso(0), 7, 'xxx', 'Nik')

  await openMore(page, 'Boten')
  await page.getByRole('button', { name: 'Boot bewerken: xxx' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Boot verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('xxx verwijderd')
  await expect(page.getByRole('button', { name: 'Boot bewerken: xxx' })).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.getByRole('button', { name: 'Boot bewerken: xxx' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Boot bewerken: xxx' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Boot verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('xxx verwijderd')

  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('button', { name: 'Deelnemer bewerken: Nik' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Voornaam').fill('Nick')
  await sheet.getByLabel('Land').fill('VS')
  await expectNoHorizontalOverflow(page)
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /^Deelnemer bewerken: Nick/ })).toBeVisible()
  await page.getByRole('button', { name: /^Deelnemer bewerken: Nick/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Deelnemer verwijderen' }).click()
  await expect(page.locator('.toast')).toContainText('verwijderd')
  await expect(page.getByRole('button', { name: /^Deelnemer bewerken/ })).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.getByRole('button', { name: /^Deelnemer bewerken: Nick/ })).toBeVisible()
  expect(errors).toEqual([])
})
