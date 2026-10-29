import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 } })

async function logDay(page: Page, from: string, to: string, nm?: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Van', { exact: true }).fill(from)
  await page.getByLabel('Naar', { exact: true }).fill(to)
  if (nm !== undefined) await page.getByLabel('Zeemijlen').fill(nm)
}

test('Mijlenvoorstel uit de historie: spaties en spelvarianten, samenvoegen, plaatsen zonder punt vastzetten op de kaart', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  await logDay(page, 'Nep Baai Tiha', 'Nepalimizana', '10')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await logDay(page, 'nepbaaitiha', 'Nepalmizana', '14')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  // Andere spelling, andere spaties: toch hetzelfde voorstel (gemiddelde van 10 en 14).
  await logDay(page, 'Nepalmizana', 'Nepbaai tiha')
  await expect(page.getByLabel('Zeemijlen')).toHaveValue('12')
  await expect(page.getByText('Voorstel 12 nm: gemiddelde van de laatste 2 keer deze route')).toBeVisible()
  // Twijfel: voorstel om samen te voegen.
  const proposal = page.locator('.notice').filter({ hasText: 'Lijken dezelfde plaats' })
  await expect(proposal).toContainText('Nepalimizana')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/samenvoegen.png', fullPage: true })
  await proposal.getByRole('button', { name: 'Samenvoegen' }).click()
  await expect(page.getByText(/^Samengevoegd tot /)).toBeVisible()
  await expect(proposal).toHaveCount(0)
  // Een nieuwe tikfout: "Bedoel je …?".
  await page.getByLabel('Naar', { exact: true }).fill('Nepalmizzana')
  // Ook het Van-veld (de samengevoegde schrijfwijze) krijgt het voorstel; het laatste hoort bij Naar.
  await page.getByRole('button', { name: /gebruiken$/ }).last().click()
  await expect(page.getByLabel('Naar', { exact: true })).not.toHaveValue('Nepalmizzana')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  // Meer → Plaatsen: zonder punt; één tik op de kaart zet de plaats vast.
  await openMore(page, 'Plaatsen')
  const row = page.getByRole('button', { name: /^Plaats bewerken: (Nep Baai Tiha|nepbaaitiha|Nepbaai tiha)$/ })
  await expect(row).toContainText('Geen punt')
  await row.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Op de kaart zetten' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('.map-land').first()).toBeAttached({ timeout: 15_000 })
  const canvas = sheet.locator('.sea-map-canvas')
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await expect(page.getByText(/ staat op de kaart$/)).toBeVisible()
  await expect(page.locator('.row-value.pinned')).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/plaatsen.png', fullPage: true })

  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepalmizana', 'Tiha']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
