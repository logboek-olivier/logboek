import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('Deze trip: eerdere en komende trips invoeren, bootgegevens van een bekende boot, vergeten dag loggen, dag achteraf bewerken', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.getByText('Geen lopende trip.')).toBeVisible()

  // Komende trip (over 20 dagen, 14 dagen lang): wordt niet de lopende trip.
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  let sheet = page.getByRole('dialog')
  await sheet.getByLabel('Startdatum').fill(iso(20))
  await sheet.getByLabel('Aantal dagen').fill('14')
  await expect(sheet.getByRole('button', { name: 'Trip opslaan' })).toBeDisabled()
  await expect(sheet.getByText('Bootnaam, model, lengte en basis zijn nodig.')).toBeVisible()
  await sheet.getByLabel('Bootnaam', { exact: true }).fill('Nepster')
  await sheet.getByLabel('Model', { exact: true }).fill('Nepcat 45')
  await sheet.getByLabel('Lengte (ft)', { exact: true }).fill('45')
  await expect(sheet.getByText('13,7 m')).toBeVisible()
  await sheet.getByLabel('Basis', { exact: true }).fill('Nepbaai')
  await sheet.getByRole('radio', { name: 'Catamaran' }).click()
  await sheet.getByLabel('Charterbedrijf of eigenaar').fill('Nepcharter')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/nieuwe-trip.png', fullPage: true })
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByText('Geen lopende trip.')).toBeVisible()
  const upcoming = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Komende trips' }) })
  await expect(upcoming).toContainText('Nepbaai')
  await expect(upcoming).toContainText('over 20 dagen')
  await expect(upcoming).toContainText('Nepster · Nepcat 45 · 45 ft (13,7 m) · Catamaran')

  // Lopende trip, begonnen drie dagen geleden, met dezelfde boot: model, lengte, soort, basis en charter komen vanzelf.
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  sheet = page.getByRole('dialog')
  await sheet.getByLabel('Startdatum').fill(iso(-3))
  await sheet.getByLabel('Bootnaam', { exact: true }).fill('Nepster')
  await expect(sheet.getByText('Gegevens van de vorige trip met deze boot ingevuld.')).toBeVisible()
  await expect(sheet.getByLabel('Model', { exact: true })).toHaveValue('Nepcat 45')
  await expect(sheet.getByLabel('Basis', { exact: true })).toHaveValue('Nepbaai')
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Deze trip' })).toBeVisible()
  await expect(page.locator('.week-head')).toContainText('Nepster · Nepcat 45 · 45 ft (13,7 m)')
  await expect(page.locator('.week-head')).toContainText('Nepbaai')

  // Vergeten dagen: één tik opent Dag met die datum; de eerste dag begint op de basis.
  await expect(page.getByText('4 dagen in deze trip nog niet gelogd')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/deze-trip.png', fullPage: true })
  await page.getByRole('button', { name: /loggen$/ }).click()
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(iso(-3))
  await expect(page.getByLabel('Van', { exact: true })).toHaveValue('Nepbaai')
  await page.getByLabel('Naar', { exact: true }).fill('Nepeiland')
  await page.getByLabel('Zeemijlen').fill('18')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.getByText('3 dagen in deze trip nog niet gelogd')).toBeVisible()

  // Dag achteraf bewerken vanuit de trip.
  await page.getByRole('button', { name: /^Dag .* bewerken$/ }).click()
  const daySheet = page.getByRole('dialog', { name: 'Dag bewerken' })
  await daySheet.getByLabel('Zee (nm)').fill('21')
  await daySheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Gezeilde dagen' }) })).toContainText('21 nm')

  // Dag toevoegen: de eerstvolgende vergeten dag, Van = vorige bestemming.
  await page.getByRole('button', { name: 'Dag toevoegen' }).click()
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(iso(-2))
  await expect(page.getByLabel('Van', { exact: true })).toHaveValue('Nepeiland')

  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepster', 'Nepbaai', 'Nepcharter']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
