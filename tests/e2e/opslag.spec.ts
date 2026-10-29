import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { COLLECTION_PATHS } from '../../src/model/types'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore, PASSPHRASE, storedLastUsed } from './helpers/logbook'

// PR A, "Data eerst": na opslaan eerst "Opgeslagen", dan "Gesynct"; de app sluiten vóór de sync verliest niets;
// Meer → Opslag met "Controleer nu"; back-up downloaden en terugzetten. Alle gegevens zijn verzonnen.

test.use({ viewport: { width: 360, height: 740 } })

async function logDay(page: Page, to: string): Promise<void> {
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill(to)
  await page.getByLabel('Zeemijlen').fill('7')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Dag opgeslagen')
}

test('opslaan: eerst "Opgeslagen", dan "Gesynct"; de app sluiten na "Opgeslagen" maar vóór de sync verliest niets', async ({ context, page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  const status = page.getByRole('status').first()
  await expect(status).toHaveText('Gesynct', { timeout: 15_000 })

  await logDay(page, 'Nephaven')
  // Eerst op deze telefoon, daarna vanzelf naar GitHub.
  await expect(page.locator('.saved-here')).toHaveText(/Opgeslagen/)
  await expect(status).toHaveText('Gesynct', { timeout: 15_000 })
  await expect(page.locator('.saved-here')).toHaveCount(0)

  // Zonder verbinding opslaan en de app meteen sluiten (sluiten midden in het opslaan zelf: tests/opslag.test.ts).
  github.offline = true
  await logDay(page, 'Nepdorp')
  await expect(page.locator('.saved-here')).toBeVisible()
  await expect.poll(() => storedLastUsed(page)).not.toBeNull()
  await page.close()

  github.offline = false
  const again = await context.newPage()
  await mockGithub(again, github)
  await again.goto('./')
  await expect(again.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  await expect(again.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  await openLogbook(again)
  await again.locator('.trip').first().getByRole('button').first().click()
  await expect(again.locator('.leg-button')).toHaveCount(2)
  // Alleen de verwachte netwerkfouten van de stap zonder verbinding.
  expect(errors.filter((e) => !e.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([])
})

test('Meer → Opslag: per bestand de stand, Controleer nu, back-up downloaden en terugzetten met voorbeeld', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  await logDay(page, 'Nephaven')
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  await openMore(page, 'Opslag')
  await expect(page.getByRole('heading', { name: 'Opslag', exact: true })).toBeVisible()
  await expect(page.locator('.storage-file')).toHaveCount(COLLECTION_PATHS.length)
  await page.getByRole('button', { name: 'Controleer nu' }).click()
  await expect(page.getByRole('button', { name: 'Controleren…' })).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.storage-ok')).toContainText('GitHub en deze telefoon zijn gelijk')
  const days = page.locator('.storage-file').filter({ hasText: 'Dagen' })
  await expect(days).toContainText('1 hier · 1 op GitHub')
  await expect(days).toContainText('Leesbaar')
  await expectNoHorizontalOverflow(page)

  // Back-up downloaden (zonder deelmenu in de testbrowser: een download).
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Back-up downloaden' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^logboek-back-up-\d{4}-\d{2}-\d{2}\.txt$/)
  const file = await download.path()
  const text = readFileSync(file, 'utf8')
  expect(text).toContain('"format":"logboek-backup"')
  expect(text).not.toContain('Nephaven')

  // Terugzetten: wachtzin, voorbeeld; alles staat er al.
  await page.getByLabel('Back-up kiezen').setInputFiles(file)
  await page.getByLabel('Wachtzin').fill('verkeerde wachtzin hier')
  await page.getByRole('button', { name: 'Back-up openen' }).click()
  await expect(page.locator('.error')).toHaveText('Wachtzin of herstelcode klopt niet', { timeout: 30_000 })
  await page.getByLabel('Wachtzin').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Back-up openen' }).click()
  await expect(page.locator('.backup-preview')).toContainText('Back-up van', { timeout: 30_000 })
  await expect(page.locator('.backup-preview')).toContainText('Niets terug te zetten')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Annuleren' }).click()
  await expect(page.locator('.backup-preview')).toHaveCount(0)

  // Geen back-up: een duidelijke melding.
  await page.getByLabel('Back-up kiezen').setInputFiles({ name: 'iets.txt', mimeType: 'text/plain', buffer: Buffer.from('geen back-up') })
  await expect(page.locator('.error')).toHaveText('Dit is geen back-up van Logboek, of het bestand is beschadigd.')
  expect(errors).toEqual([])
})
