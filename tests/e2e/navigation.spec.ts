import { expect, test } from '@playwright/test'
import { mockGithub, newGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

function isoInDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('onderbalk Vandaag · Deze week · + · Logboek · Meer; onder Meer Geld, Cursussen, Studentenarchief, Instellingen; Vandaag toont geen bedragen; bevestiging zonder bedrag; volgende vervaldatum', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page, newGithub({ tokenExpiration: `${isoInDays(40)} 12:00:00 UTC` }))
  await createNewLogbook(page)

  const bar = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  for (const name of ['Vandaag', 'Deze trip', 'Toevoegen', 'Logboek', 'Meer']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(bar.getByRole('button', { name: 'Geld' })).toHaveCount(0)

  // Fooi toevoegen: de bevestiging noemt geen bedrag, en Vandaag toont geen geld.
  await bar.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Fooi' }).click()
  await page.getByLabel('Bedrag').fill('85,50')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Fooi opgeslagen')
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Kosten' }).click()
  await page.getByLabel('Bedrag').fill('12')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Kosten opgeslagen')
  const today = page.locator('main')
  await expect(today).not.toContainText('€')
  await expect(today).not.toContainText('85')
  await expect(page.locator('.grid')).toContainText('Volgende vervaldatum')
  await expect(page.locator('.grid')).toContainText('over 40 dagen')
  await expect(page.locator('.grid')).toContainText('GitHub-token')
  await expectNoHorizontalOverflow(page)

  // Meer: Geld en Instellingen, met terug naar Meer.
  await bar.getByRole('button', { name: 'Meer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Meer' })).toBeVisible()
  for (const item of [/^Geld/, /^Cursussen/, /^Studentenarchief/, /^Instellingen/]) await expect(page.getByRole('button', { name: item })).toBeVisible()
  await page.getByRole('button', { name: /^Geld/ }).click()
  await expect(page.getByRole('heading', { name: 'Geld' })).toBeVisible()
  await expect(page.locator('.grid').first()).toContainText('€ 85,50')
  await expect(bar.getByRole('button', { name: 'Meer', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.locator('.back-link').click()
  await page.getByRole('button', { name: /^Instellingen/ }).click()
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})
