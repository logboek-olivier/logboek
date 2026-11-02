import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Fooi per gast (src/domain/geldrapport.ts): elke tocht met fooien staat erin; zonder namen (Yacht Week) staat er "—" met
// een tik om het aantal gasten in te vullen. Negatieve bedragen als "−€ …". Op 360 px, alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 740 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('fooi per gast: een Yacht Week-tocht zonder namen, aantal gasten invullen met één tik', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nepweek zonder namen')
  await sheet.getByLabel('Startdatum').fill(iso(-20))
  await sheet.getByLabel('Organisatie').selectOption({ label: 'Yacht Week' })
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Een fooi bij die tocht (de datum valt erin, dus de kiezer kiest hem vanzelf) en kosten die groter zijn.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('400')
  await page.getByLabel('Datum', { exact: true }).fill(iso(-15))
  await expect(page.getByRole('button', { name: /^Trip: .*Nepweek zonder namen/ })).toBeVisible()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Fooi')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  await openMore(page, 'Geld', 'Meer')
  const tips = page.locator('.tip-overview')
  await tips.getByRole('radio', { name: 'Per trip' }).click()
  await expect(tips).toContainText('Nepweek zonder namen')
  await expect(tips).toContainText('Aantal gasten onbekend')
  await tips.getByRole('button', { name: 'Aantal gasten invullen voor Nepweek zonder namen' }).click()
  const count = page.getByRole('dialog', { name: 'Aantal gasten: Nepweek zonder namen' })
  await count.getByLabel('Aantal gasten').fill('8')
  await count.getByRole('button', { name: 'Opslaan' }).click()
  await expect(count).toHaveCount(0)
  // 400 / 8 = € 50,00 per gast.
  await expect(tips).toContainText('8 gasten')
  await expect(tips).toContainText('€ 50,00')
  // Per soort: Yacht Week staat erbij (naast Sailing Virgins als die er is).
  await tips.getByRole('radio', { name: 'Per soort trip' }).click()
  await expect(tips).toContainText('Yacht Week')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/fooi-per-gast.png', fullPage: true })
  expect(errors).toEqual([])
})
