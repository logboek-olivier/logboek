import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore, openLogbook } from './helpers/logbook'

const fixture = fileURLToPath(new URL('../fixtures/boten-nep.csv', import.meta.url))

test.use({ viewport: { width: 360, height: 800 } })

test('Boten uit de import: naam en model uit Schip, lengte als voorstel, alles in één keer bevestigen; later onder Meer → Boten', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await openLogbook(page)
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Importeren' }).click()

  await expect(page.getByRole('heading', { name: 'Bootgegevens controleren' })).toBeVisible()
  const cards = page.locator('.boat-card')
  await expect(cards).toHaveCount(8)
  const zwaan = cards.filter({ has: page.locator('input[value="Nepzwaan"]') })
  await expect(zwaan.getByLabel('Model')).toHaveValue('Nepteau SO 519')
  await expect(zwaan.getByLabel('Lengte (ft)')).toHaveValue('52')
  await expect(zwaan).toContainText('voorstel uit het model')
  const sport = cards.filter({ has: page.locator('input[value="Sportnep 680"]') })
  await expect(sport.getByLabel('Bootnaam')).toHaveValue('')
  await expect(sport.getByLabel('Lengte (ft)')).toHaveValue('22')
  const koala = cards.filter({ has: page.locator('input[value="Nepkoala X"]') })
  await expect(koala.getByLabel('Lengte (ft)')).toHaveValue('')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/boten-controleren.png', fullPage: true })

  // Aanpassen en in één keer bevestigen.
  await zwaan.getByLabel('Lengte (ft)').fill('50')
  await expect(zwaan).not.toContainText('voorstel uit het model')
  await sport.getByLabel('Bootnaam').fill('Nepflits')
  await zwaan.getByRole('radio', { name: 'Catamaran' }).click()
  await page.getByRole('button', { name: 'Alles bevestigen' }).click()
  await expect(page.getByText('8 boten opgeslagen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Logboek' })).toBeVisible()
  await expect(page.getByText(/boten uit je import controleren/)).toHaveCount(0)

  // Meer → Boten: dezelfde gegevens, te bewerken.
  await openMore(page, 'Boten')
  const list = page.locator('.boat-card')
  await expect(list).toHaveCount(8)
  const saved = list.filter({ has: page.locator('input[value="Nepzwaan"]') })
  await expect(saved.getByLabel('Lengte (ft)')).toHaveValue('50')
  await expect(saved.getByRole('radio', { name: 'Catamaran' })).toHaveAttribute('aria-checked', 'true')
  await expect(list.filter({ has: page.locator('input[value="Nepflits"]') }).getByLabel('Model')).toHaveValue('Sportnep 680')

  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepzwaan', 'Nepteau', 'Nepflits']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
