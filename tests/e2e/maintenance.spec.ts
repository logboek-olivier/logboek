import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook, lock, openMore } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('Instellingen → Over toont versie, bouwdatum en commit', async ({ page }) => {
  await mockGithub(page)
  await createNewLogbook(page)
  await openMore(page, 'Instellingen')
  const about = page.locator('.about')
  await expect(about).toContainText('Versie1.0.0')
  await expect(about).toContainText('Gebouwd')
  await expect(about.locator('code')).toHaveText(/^[0-9a-f]{7}$|^onbekend$/)
})

test('Kopieer foutdetails: versie, scherm en foutcode, zonder inhoud; niet bij een verkeerde wachtzin', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Logboek' }).click()
  await page
    .getByLabel('Mijlenbestand')
    .setInputFiles({ name: 'mijlen.csv', mimeType: 'text/csv', buffer: Buffer.from('Datum;Van (plaats)\n1-1-2024;Geheimhaven') })
  await expect(page.getByRole('alert')).toContainText('ontbreekt in de kopregel')
  await page.getByRole('button', { name: 'Kopieer foutdetails' }).click()
  await expect(page.getByRole('button', { name: 'Gekopieerd' })).toBeVisible()
  const report = await page.evaluate(() => navigator.clipboard.readText())
  expect(report).toContain('Logboek-foutdetails')
  expect(report).toContain('Versie: 1.0.0')
  expect(report).toContain('Scherm: Logboek')
  expect(report).toContain('Foutcode: ImportError')
  expect(report).not.toContain('Geheimhaven')

  await lock(page)
  await page.getByLabel('Wachtzin').fill('verkeerd verkeerd verkeerd')
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wachtzin of herstelcode klopt niet', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Kopieer foutdetails' })).toHaveCount(0)
})
