import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook } from './helpers/logbook'

const fixture = fileURLToPath(new URL('../fixtures/mijlen-nep.csv', import.meta.url))

test.use({ viewport: { width: 360, height: 800 } })

test('Niets verplicht: lege dag en lege trip opslaan met "Onvolledig"; op zondag de lege velden één voor één aanvullen', async ({ page }) => {
  // Zondag 1 november 2026 (de tijd loopt door, zodat elke wijziging een nieuwere updatedAt krijgt).
  await page.clock.setSystemTime(new Date('2026-11-01T10:00:00'))
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')

  // Een dag zonder iets: gewoon opslaan.
  await nav.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()

  // Import: oudere trips zonder bootgegevens.
  await openLogbook(page)
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Importeren' }).click()
  await page.getByRole('button', { name: 'Overslaan' }).click()
  await expect(page.locator('.trip .badge-incomplete').first()).toBeVisible()

  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  const card = page.locator('.notice').filter({ hasText: /dingen aanvullen/ })
  await expect(card).toBeVisible()
  const before = Number((await card.textContent())!.match(/(\d+) dingen/)![1])
  await card.getByRole('button', { name: 'Aanvullen' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText(`Aanvullen (1 van ${before})`)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/aanvullen.png', fullPage: true })
  // Eerste veld: invullen en opslaan; tweede: overslaan.
  const field = sheet.getByRole("textbox")
  await field.fill('Nepwaarde')
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(sheet).toContainText(`Aanvullen (2 van ${before})`)
  await sheet.getByRole('button', { name: 'Overslaan' }).click()
  await expect(sheet).toContainText(`Aanvullen (3 van ${before})`)
  await sheet.getByRole('button', { name: 'Sluiten' }).click()
  await expect(card).toContainText(`${before - 1} dingen aanvullen`)
  expect(errors).toEqual([])
})
