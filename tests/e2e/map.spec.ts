import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 }, geolocation: { latitude: 17.9, longitude: -62.85 }, permissions: ['geolocation'] })

async function logDay(page: Page, from: string, to: string, nm?: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Van', { exact: true }).fill(from)
  await page.getByLabel('Naar', { exact: true }).fill(to)
  if (nm !== undefined) await page.getByLabel('Zeemijlen').fill(nm)
}

test('Kaart offline: punt zetten, huidige locatie, bekende plaats kiezen; waterroute, daarna afstandsvoorstel uit de laatste vijf keer dezelfde route', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  const external: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.hostname !== 'localhost' && url.hostname !== 'api.github.com') external.push(url.hostname)
  })
  await createNewLogbook(page)

  // Naar: huidige locatie (GPS) en een naam; de kaart laadt alleen eigen kaartbestanden.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('button', { name: 'Naar op de kaart kiezen' }).click()
  const sheet = page.getByRole('dialog', { name: 'Naar: plaats op de kaart' })
  await expect(sheet.locator('.map-land').first()).toBeAttached({ timeout: 15_000 })
  // Gedetailleerde OpenStreetMap-kustlijn in de Bovenwindse Eilanden, met naamsvermelding.
  await expect(sheet.locator('.map-osm').first()).toBeAttached({ timeout: 15_000 })
  await expect(sheet.locator('.map-attribution')).toHaveText('© OpenStreetMap-bijdragers')
  await sheet.getByRole('button', { name: 'Huidige locatie' }).click()
  await sheet.getByLabel('Naam van de plaats').fill('Nepbarths')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/kaart.png', fullPage: true })
  await sheet.getByRole('button', { name: 'Kiezen' }).click()
  await expect(page.getByLabel('Naar', { exact: true })).toHaveValue('Nepbarths')

  // Van: tik op de kaart (nieuw punt ten zuiden), naam geven.
  await page.getByRole('button', { name: 'Van op de kaart kiezen' }).click()
  const fromSheet = page.getByRole('dialog', { name: 'Van: plaats op de kaart' })
  const canvas = fromSheet.locator('.sea-map-canvas')
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width / 2, y: box.height * 0.75 } })
  // De waterroute vanaf de andere plaats van de dag staat op de kaart, met de schatting.
  await expect(fromSheet.locator('.map-route')).toBeAttached({ timeout: 15_000 })
  await expect(fromSheet.getByText(/^± [\d,]+ nm \(water [\d,]+ nm × jouw factor 1,2\)$/)).toBeVisible()
  await page.screenshot({ path: 'screenshots/trips/kaart-route.png', fullPage: true })
  await fromSheet.getByLabel('Naam van de plaats').fill('Nepstatia')
  await fromSheet.getByRole('button', { name: 'Kiezen' }).click()
  await expect(page.getByLabel('Van', { exact: true })).toHaveValue('Nepstatia')
  // Zonder eerdere keren: de waterroute om land heen maal de persoonlijke factor (nog 1,2), voorgevuld; nooit hemelsbreed.
  await expect(page.getByText(/^± [\d,]+ nm \(water [\d,]+ nm × jouw factor 1,2\)$/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Zeemijlen')).toHaveValue(/^\d+(,5)?$/)
  await expect(page.getByText(/Hemelsbreed/)).toHaveCount(0)
  await page.getByLabel('Zeemijlen').fill('30')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  // Nog twee keer dezelfde route (ook andersom), dan het voorstel: gemiddelde.
  await logDay(page, 'Nepbarths', 'Nepstatia', '26')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await logDay(page, 'Nepstatia', 'Nepbarths')
  await expect(page.getByLabel('Zeemijlen')).toHaveValue('28')
  await expect(page.getByText('Voorstel 28 nm: gemiddelde van de laatste 2 keer deze route')).toBeVisible()
  await page.getByRole('button', { name: 'Opslaan' }).click()

  // Bekende plaats op de kaart: één tik kiest hem.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('button', { name: 'Naar op de kaart kiezen' }).click()
  const known = page.getByRole('dialog', { name: 'Naar: plaats op de kaart' })
  await expect(known.locator('.map-place')).toHaveCount(2)
  await known.locator('.map-place').filter({ hasText: 'Nepstatia' }).locator('circle').click()
  await expect(page.getByLabel('Naar', { exact: true })).toHaveValue('Nepstatia')

  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  // De coördinaten zoals ze onversleuteld in JSON zouden staan ("17.9" alleen kan ook in de tijd van een commitbericht staan).
  for (const secret of ['Nepbarths', 'Nepstatia', '"lat":17.9', '-62.85']) expect(wire).not.toContain(secret)
  expect(external).toEqual([])
  expect(errors).toEqual([])
})
