import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// De tochtkiezer bij geld (alle tochten, ook van eerdere seizoenen, nieuwste eerst per jaar, met datums, organisatie en
// een zoekveld; onderaan Seizoen… en Geen tocht) en Geld → Eerder seizoen, op 360 px. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 740 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function newTrip(page: Page, name: string, start: string, org: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  await sheet.getByLabel('Organisatie').selectOption({ label: org })
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('tochtkiezer: zoeken in alle tochten (ook een eerder seizoen), seizoen kiezen, en eerder seizoen invoeren', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })
  // Twee seizoenen met een week met dezelfde naam, en een tocht van Sailing Virgins.
  await newTrip(page, 'Nepweek één', iso(-420), 'Yacht Week')
  await newTrip(page, 'Nepweek één', iso(-60), 'Yacht Week')
  await newTrip(page, 'Nepbvi', iso(-30), 'Sailing Virgins')
  const oldYear = iso(-420).slice(0, 4)

  // Toevoegen → Inkomsten: de kiezer toont alle tochten per jaar, met datums en organisatie; zoeken op het jaar.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('120')
  await page.getByRole('button', { name: /^Trip: / }).click()
  const picker = page.getByRole('dialog', { name: 'Tocht kiezen' })
  await expect(picker.locator('.trip-pick')).toHaveCount(3)
  await expect(picker.locator('.trip-pick', { hasText: 'Nepweek één' })).toHaveCount(2)
  await expect(picker.locator('.trip-pick').first()).toContainText('Sailing Virgins')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/tochtkiezer.png', fullPage: true })
  await picker.getByLabel('Zoeken op naam, organisatie of jaar').fill(`één ${oldYear}`)
  await expect(picker.locator('.trip-pick')).toHaveCount(1)
  await expect(picker.locator('.trip-pick')).toContainText('Yacht Week')
  await picker.locator('.trip-pick').click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByRole('button', { name: new RegExp(`^Trip: .*Nepweek één.*${oldYear}`) })).toBeVisible()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Fooi')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  // Een fooi van een seizoen (organisatie en jaar), zonder tocht.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('80')
  await page.getByRole('button', { name: /^Trip: / }).click()
  await page.getByRole('dialog', { name: 'Tocht kiezen' }).getByRole('button', { name: 'Seizoen…' }).click()
  const seasonPick = page.getByRole('dialog', { name: 'Tocht kiezen' }).locator('.season-pick')
  await seasonPick.getByLabel('Organisatie').selectOption({ label: 'Yacht Week' })
  await seasonPick.getByLabel('Jaar').fill(oldYear)
  await seasonPick.getByRole('button', { name: 'Dit seizoen kiezen' }).click()
  await expect(page.getByRole('button', { name: `Trip: Seizoen Yacht Week ${oldYear}` })).toBeVisible()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Fooi')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  // Geld → Eerder seizoen: drie bedragen, elk een transactie bij het seizoen.
  await openMore(page, 'Geld', 'Meer')
  await page.getByRole('button', { name: 'Eerder seizoen' }).click()
  const season = page.getByRole('dialog', { name: 'Eerder seizoen' })
  await season.getByLabel('Organisatie').selectOption({ label: 'Yacht Week' })
  await season.getByLabel('Jaar').fill(String(Number(oldYear) - 1))
  await season.getByLabel('Salaris', { exact: true }).fill('1000')
  await season.getByLabel('Fooien', { exact: true }).fill('200')
  await expect(season).toContainText(`31 december ${Number(oldYear) - 1}`)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/eerder-seizoen.png', fullPage: true })
  await season.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('2 bedragen opgeslagen bij het seizoen')
  await expect(page.getByRole('main')).toContainText(`Seizoen Yacht Week ${Number(oldYear) - 1}`)
  await expect(page.getByRole('main')).toContainText(`Seizoen Yacht Week ${oldYear}`)
  expect(errors).toEqual([])
})
