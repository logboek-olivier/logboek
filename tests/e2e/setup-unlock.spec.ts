import { expect, test } from '@playwright/test'
import { mockGithub, type E2eGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, PASSPHRASE, TOKEN } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('nieuw logboek: token, wachtzin, herstelcode bevestigen, gesynct, vergrendelen, ontgrendelen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expectNoHorizontalOverflow(page)

  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  expect(github.files.has('meta.json.enc')).toBe(true)
  expect(github.files.has('trips.json.enc')).toBe(true)

  // Niets leesbaar over de lijn: de token alleen in de header, de wachtzin nergens.
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain(TOKEN)
  expect(wire).not.toContain(PASSPHRASE)
  expect(wire).not.toContain('nep')

  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()

  await page.getByLabel('Wachtzin').fill('verkeerd verkeerd verkeerd')
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wachtzin of herstelcode klopt niet', { timeout: 30_000 })

  await page.getByLabel('Wachtzin').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('button', { name: 'Vergrendelen' })).toBeVisible({ timeout: 30_000 })

  // Herladen = nieuwe browsersessie: vergrendeld, geen eerste-keer-scherm meer.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
  expect(errors).toEqual([])
})

test('bestaand logboek koppelen op een tweede apparaat met de herstelcode', async ({ browser }) => {
  const first = await browser.newContext({ viewport: { width: 360, height: 740 } })
  const pageA = await first.newPage()
  const github = await mockGithub(pageA)
  const words = await createNewLogbook(pageA)
  await expect(pageA.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  await first.close()

  const second = await browser.newContext({ viewport: { width: 360, height: 740 } })
  const pageB = await second.newPage()
  await mockGithub(pageB, github as E2eGithub)
  await pageB.goto('./')
  await pageB.getByRole('button', { name: 'Bestaand logboek koppelen' }).click()
  await pageB.getByLabel('GitHub-token').fill(TOKEN)
  await pageB.getByRole('button', { name: 'Verder' }).click()
  await pageB.getByRole('button', { name: 'Herstelcode gebruiken' }).click()
  await pageB.getByLabel(/Herstelcode/).fill(words.join(' '))
  await pageB.getByRole('button', { name: 'Koppelen' }).click()
  await expect(pageB.getByRole('button', { name: 'Vergrendelen' })).toBeVisible({ timeout: 30_000 })
  await expect(pageB.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  await second.close()
})

test('nieuw logboek weigert een repo die al een logboek bevat', async ({ page }) => {
  const github = await mockGithub(page)
  github.files.set('meta.json.enc', { sha: 'sha-bestaand', content: 'e30=' })
  await page.goto('./')
  await page.getByRole('button', { name: 'Nieuw logboek' }).click()
  await page.getByLabel('GitHub-token').fill(TOKEN)
  await page.getByRole('button', { name: 'Verder' }).click()
  await expect(page.getByRole('alert')).toContainText('bevat al een logboek')
})
