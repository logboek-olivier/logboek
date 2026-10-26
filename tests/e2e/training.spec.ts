import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('Training: ASA-cursussen met notitie, onderwerp toevoegen en examenkritisch maken, RYA vullen, eigen cursus, delen en importeren', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Training', exact: true })).toBeVisible()
  for (const name of ['ASA 101 Basic Keelboat Sailing', 'ASA 103 Basic Coastal Cruising', 'ASA 104 Bareboat Cruising', 'ASA 114 Cruising Catamaran', 'RYA Day Skipper']) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  }
  await expectNoHorizontalOverflow(page)

  // ASA 101: notitie en onderwerpen.
  await page.getByRole('button', { name: /ASA 101/ }).click()
  await expect(page.getByText('Controleer tegen de officiële ASA-standaard.')).toBeVisible()
  await expect(page.getByText('Overstag gaan')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Onderwerp toevoegen en examenkritisch maken.
  await page.getByRole('button', { name: 'Bewerken', exact: true }).click()
  await page.getByRole('button', { name: 'Onderwerp toevoegen' }).first().click()
  await page.getByLabel('Onderwerp (Nederlands)').fill('Nepknoop leggen')
  await page.getByRole('radio', { name: 'Praktijk' }).click()
  await page.getByLabel('Examenkritisch').check()
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  const added = page.locator('.topic').filter({ hasText: 'Nepknoop leggen' })
  await expect(added).toContainText('Examen')
  // Verplaatsen naar een andere groep.
  await added.getByRole('button').click()
  await page.getByRole('dialog').getByLabel('Groep').selectOption({ label: 'Veiligheid' })
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.section').filter({ hasText: 'Veiligheid' }).getByText('Nepknoop leggen')).toBeVisible()
  await page.getByRole('button', { name: 'Klaar', exact: true }).click()

  // Delen: zonder deelfunctie wordt het een download.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Delen' }).click()
  const file = await (await download).path()
  const json = readFileSync(file!, 'utf8')
  expect(JSON.parse(json).format).toBe('logboek-curriculum')
  expect(json).toContain('Nepknoop leggen')

  // RYA Day Skipper: leeg, zelf een groep en onderwerp toevoegen.
  await page.getByRole('button', { name: 'Terug naar Training' }).click()
  await page.getByRole('button', { name: /RYA Day Skipper/ }).click()
  await page.getByRole('button', { name: 'Groep toevoegen' }).click()
  await page.getByLabel('Groep (Nederlands)').fill('Navigatie')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await page.getByRole('button', { name: 'Onderwerp toevoegen' }).click()
  await page.getByLabel('Onderwerp (Nederlands)').fill('Koers met stroom')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Koers met stroom')).toBeVisible()
  await page.getByRole('button', { name: 'Terug naar Training' }).click()
  await expect(page.getByRole('button', { name: /RYA Day Skipper/ })).toContainText('1 onderwerp')

  // Import van het gedeelde bestand: een nieuwe eigen cursus naast het origineel.
  await page.getByLabel('Curriculum-bestand').setInputFiles({ name: 'asa-101.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await expect(page.locator('.toast')).toHaveText('Cursus geïmporteerd')
  await expect(page.getByText('Nepknoop leggen')).toBeVisible()
  await page.getByRole('button', { name: 'Terug naar Training' }).click()
  await expect(page.getByRole('button', { name: /ASA 101/ })).toHaveCount(2)

  // Ongeldig bestand: melding in gewone taal.
  await page.getByLabel('Curriculum-bestand').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByRole('alert')).toHaveText('Dit bestand is geen geldig curriculum (JSON uit Logboek).')

  // Eigen cursus aanmaken.
  await page.getByRole('button', { name: 'Nieuwe cursus' }).click()
  await page.getByLabel('Naam (Nederlands)').fill('Nepcursus spinnaker')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Nepcursus spinnaker' })).toBeVisible()

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => r.body ?? '').join('\n')
  expect(wire).not.toContain('Nepknoop')
  expect(wire).not.toContain('Nepcursus')
  expect(errors).toEqual([])
})
