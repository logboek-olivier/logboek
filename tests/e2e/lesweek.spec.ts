import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('Lesweek: cursussen per student, blok afvinken voor iedereen, één student nog niet, overzicht per cursus', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()

  // Een lesweek met één student; de tweede komt erbij via "Persoon toevoegen" op de trip zelf.
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('radio', { name: 'Training geven' }).click()
  await sheet.getByLabel('Deelnemer 1', { exact: true }).fill('Nepanna')
  await fillBoat(sheet)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('main').getByRole('button', { name: 'Persoon toevoegen' }).click()
  const add = page.getByRole('dialog')
  await expect(add.getByRole('radio', { name: 'Student' })).toHaveAttribute('aria-checked', 'true')
  await expect(add.getByLabel('Trip')).toHaveCount(0)
  await add.getByLabel('Voornaam').fill('Nepbram')
  await add.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Geen tik op de kop meer naar een apart blad; geschiedenis en verwijderen staan onderaan.
  await expect(page.locator('.trip-head-summary')).toHaveCount(0)
  await expect(page.locator('.period-actions').getByRole('button', { name: 'Periode verwijderen' })).toBeVisible()

  const week = page.locator('.lesson-week')
  await expect(week.getByRole('heading', { name: 'Lesweek' })).toBeVisible()
  await expect(week.getByText('Tik op een naam om de cursussen te kiezen.')).toBeVisible()

  // Cursussen: meerdere per student, met een spoor als snelkeuze.
  await week.getByRole('button', { name: 'Cursussen kiezen: Nepanna' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '101 + 103' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Klaar' }).click()
  await week.getByRole('button', { name: 'Cursussen kiezen: Nepbram' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '104 + 114' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Klaar' }).click()
  await expect(week.getByRole('button', { name: 'Cursussen kiezen: Nepanna' })).toContainText('101 · 103')
  await expect(week.getByText('Tik op een naam om de cursussen te kiezen.')).toHaveCount(0)
  await expect(week.getByText('101: nog 13 van 13 open')).toBeVisible()
  await expect(week.getByRole('checkbox', { name: 'Catamaran' })).toBeVisible()

  // Groepsblok: één tik.
  await week.getByRole('checkbox', { name: 'Rondje over de boot' }).click()
  await expect(week.getByRole('checkbox', { name: 'Rondje over de boot' })).toHaveAttribute('aria-checked', 'true')

  // Studentblok: één tik = iedereen; de namen staan eronder; Nepbram nog niet.
  await week.getByRole('checkbox', { name: 'Overstag en gijpen' }).click()
  await week.getByRole('button', { name: 'Nepbram: gedaan' }).click()
  await expect(week.getByText('Nog niet: Nepbram')).toBeVisible()
  await expect(week.getByText('Gijpen', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await week.screenshot({ path: 'test-results/lesweek-360.png' })

  // Blijft na herladen.
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(week.getByText('Nog niet: Nepbram')).toBeVisible()
  await expect(week.getByText('101: nog 11 van 13 open')).toBeVisible()
  // Toch goed: één tik op de naam.
  await week.getByRole('button', { name: /Overstag en gijpen/ }).click()
  await week.getByRole('button', { name: 'Nepbram: nog niet' }).click()
  await expect(week.getByText('Nog niet: Nepbram')).toHaveCount(0)
  expect(errors).toEqual([])
})
