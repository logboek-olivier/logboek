import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Studentenarchief (november 2026): zelf een student toevoegen en aan een trip koppelen, zonder cursus; notities per
// persoon, later terug te lezen. Alle namen verzonnen.

test('studentenarchief: student zonder cursus toevoegen aan een trip, notitie schrijven en terugzien', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Nepweek Les')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')

  await openMore(page, 'Studentenarchief')
  await page.getByRole('button', { name: 'Student toevoegen' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Voornaam').fill('Nepeva')
  await sheet.getByLabel('Cursus').selectOption({ label: 'Nog geen cursus' })
  await sheet.getByLabel('Trip').selectOption({ index: 1 })
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Student toegevoegd')

  // De student staat open: nog geen cursus, met een knop om er een te kiezen; een notitie van twee regels.
  await expect(page.getByRole('heading', { name: 'Nepeva' })).toBeVisible()
  await expect(page.locator('main')).toContainText('Nog geen cursus')
  await page.getByRole('button', { name: 'Notitie toevoegen' }).click()
  await page.getByRole('dialog').getByLabel('Notities').fill('Nepnotitie over het aanleggen\nVolgende keer: reven')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.student-note')).toContainText('Volgende keer: reven')
  await expectNoHorizontalOverflow(page)

  // Terug naar de lijst: de student staat bij de trip; opnieuw openen toont de notitie.
  await page.getByRole('button', { name: /Studenten/ }).first().click()
  await expect(page.locator('.student-group')).toContainText('Nepweek Les')
  await page.getByRole('button', { name: /Nepeva/ }).click()
  await expect(page.locator('.student-note')).toContainText('Nepnotitie over het aanleggen')
  expect(errors).toEqual([])
})
