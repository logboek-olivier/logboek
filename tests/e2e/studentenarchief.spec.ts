import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// PR D: het studentenarchief toont álle studenten per trip, de lopende trip bovenaan (die ontbrak); zoeken op naam,
// filteren op cursus en resultaat; vanuit het tripoverzicht met één tik naar de checklist. Verzonnen voornamen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function newTrip(page: Page, name: string, start: string, people: [string, string][]) {
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  for (const [i, [firstName, course]] of people.entries()) {
    await sheet.getByLabel(`Deelnemer ${i + 1}`, { exact: true }).fill(firstName)
    await sheet.getByRole('combobox', { name: `Cursus deelnemer ${i + 1}` }).selectOption(course)
  }
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('studentenarchief: alle studenten per trip, lopende trip bovenaan, zoeken en filteren, één tik vanuit het tripoverzicht', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  const earlier = iso(-40)
  await newTrip(page, 'Nepweek eerder', earlier, [['Nepcees', 'seed-asa-101']])
  await newTrip(page, 'Nepweek nu', iso(-1), [
    ['Nepanna', 'seed-asa-101'],
    ['Nepbram', 'seed-asa-103'],
  ])

  // Alle studenten, per trip: de lopende trip bovenaan.
  await openMore(page, 'Studentenarchief')
  const groups = page.locator('.student-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.first()).toContainText('Nepweek nu')
  await expect(groups.first()).toContainText('Lopend')
  await expect(groups.first().locator('.student')).toHaveCount(2)
  await expect(groups.nth(1)).toContainText('Nepweek eerder')
  await expect(groups.nth(1)).toContainText('Nepcees')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/studenten/archief.png', fullPage: true })

  // Zoeken op een deel van de naam, filteren op cursus en resultaat.
  await page.getByLabel('Zoek een student op naam').fill('CEE')
  await expect(page.locator('.student')).toHaveCount(1)
  await expect(page.locator('.student')).toContainText('Nepcees')
  await page.getByLabel('Zoek een student op naam').fill('')
  await page.getByRole('combobox', { name: 'Cursus' }).selectOption('seed-asa-103')
  await expect(page.locator('.student')).toHaveCount(1)
  await expect(page.locator('.student')).toContainText('Nepbram')
  await page.getByRole('combobox', { name: 'Cursus' }).selectOption('')
  await page.getByRole('combobox', { name: 'Resultaat' }).selectOption({ label: 'Geslaagd' })
  await expect(page.locator('.student')).toHaveCount(0)
  await expect(page.getByText('Geen studenten gevonden')).toBeVisible()
  await page.getByRole('combobox', { name: 'Resultaat' }).selectOption({ label: 'Nog geen examen' })
  await expect(page.locator('.student')).toHaveCount(3)

  // Eerdere trip in de agenda → tripoverzicht → één tik op de student → de checklist.
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  await page.getByLabel('Kies een maand').fill(earlier.slice(0, 7))
  await page.locator('.cal-day:not(.other-month)').nth(Number(earlier.slice(8, 10)) - 1).click()
  await page.getByRole('dialog').getByRole('button', { name: /Nepweek eerder/ }).click()
  const overview = page.getByRole('dialog')
  await expect(overview).toContainText('Studenten')
  await overview.locator('.student', { hasText: 'Nepcees' }).getByRole('button').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Nepcees' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Overstag gaan: Nieuw/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Terug naar Studenten' }).click()
  await expect(page.getByRole('heading', { name: 'Studentenarchief' })).toBeVisible()

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const name of ['Nepanna', 'Nepbram', 'Nepcees']) expect(wire).not.toContain(name)
  expect(errors).toEqual([])
})
