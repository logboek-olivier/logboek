import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openMore } from './helpers/logbook'

// PR G: Statistieken → "Waar ik gevaren heb" (alle routes en de meest bezochte plaatsen op één kaart) en een trip delen
// als afbeelding of PDF: route, teller, nm, dagen en boot; geen namen van deelnemers en geen bedragen. Verzonnen trip;
// Hvar en Vis zijn openbare namen op de kaart.

test.use({ viewport: { width: 360, height: 800 } })

test('waar ik gevaren heb, en een trip delen als afbeelding of PDF zonder namen of bedragen', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  // Een trip met een deelnemer en een fooi, en twee dagen Hvar → Vis → Hvar.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nepweek delen')
  await fillBoat(sheet)
  await sheet.getByLabel('Basis', { exact: true }).fill('Hvar')
  await sheet.getByRole('combobox', { name: 'Organisatie' }).selectOption({ label: 'Sailing Virgins' })
  await sheet.getByLabel('Deelnemer 1', { exact: true }).fill('Nepgast')
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  for (const [to, nm] of [
    ['Vis', '24'],
    ['Hvar', '22'],
  ] as const) {
    await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
    await page.getByLabel('Naar', { exact: true }).fill(to)
    await page.getByLabel('Zeemijlen').fill(nm)
    await page.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('77')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  // Pins via de pin-assistent.
  await openMore(page, 'Plaatsen')
  await page.getByRole('button', { name: 'Plaatsen zonder pin' }).click()
  const assistant = page.getByRole('dialog', { name: 'Plaatsen zonder pin' })
  for (const name of ['Hvar', 'Vis']) {
    await expect(assistant).toContainText(`${name} gevonden: klopt?`, { timeout: 20_000 })
    await assistant.getByRole('button', { name: 'Ja, pin zetten' }).click()
  }
  await assistant.getByRole('button', { name: 'Sluiten' }).first().click()

  // Statistieken → Waar ik gevaren heb: de route en de meest bezochte plaatsen.
  await openMore(page, 'Statistieken')
  const map = page.locator('.sailed-map')
  await expect(map).toContainText('Waar ik gevaren heb')
  await expect(map.locator('.map-route.all')).toHaveCount(1)
  await expect(map.locator('.map-hotspot')).toHaveCount(2)
  await expect(map).toContainText('Hvar (1×)')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/delen/waar-gevaren.png', fullPage: true })

  // Trip delen: voorbeeld met route, teller, nm, dagen en boot; geen namen en geen bedragen.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('button', { name: 'Trip delen' }).click()
  const share = page.getByRole('dialog', { name: 'Trip delen' })
  await expect(share).toContainText('SV #1')
  await expect(share).toContainText('46 nm · 2 dagen')
  await expect(share).toContainText('Nepboot')
  await expect(share).not.toContainText('Nepgast')
  await expect(share).not.toContainText('€')
  await expect(share.locator('.map-stop')).toHaveCount(2)
  await page.screenshot({ path: 'screenshots/delen/trip-delen.png' })

  // Als afbeelding: zonder deelmenu (headless) een download van een PNG van 1080 × 1350.
  const download = page.waitForEvent('download')
  await share.getByRole('button', { name: 'Als afbeelding' }).click()
  const file = await (await download).path()
  const png = readFileSync(file)
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(1080)
  expect(png.readUInt32BE(20)).toBe(1350)
  mkdirSync('screenshots/delen', { recursive: true })
  writeFileSync('screenshots/delen/trip-afbeelding.png', png)

  // Als PDF: de printweergave met dezelfde afbeelding.
  await share.getByRole('button', { name: 'Als PDF (afdrukken)' }).click()
  await expect(page.locator('.trip-share-print img')).toHaveCount(1)

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  for (const word of ['Hvar', 'Nepgast', 'Nepweek']) expect(wire).not.toContain(word)
  expect(errors).toEqual([])
})
