import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore } from './helpers/logbook'

// Exporteren (ronde 2, PR 7): Meer → Opslag → Exporteren geeft een zip met leesbare CSV's van trips, dagen, boten,
// plaatsen, inkomsten en uitgaven. Eerst een duidelijke waarschuwing dat het bestand niet versleuteld is; pas na
// "Onversleuteld exporteren" wordt het gemaakt. De app stuurt niets naar buiten. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

const fixture = new URL('../fixtures/mijlen-nep.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

test('exporteren: waarschuwing, dan een zip met leesbare CSV-bestanden; niets naar GitHub', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await openLogbook(page)
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Importeren' }).click()
  await page.getByRole('button', { name: 'Overslaan' }).click()
  // Een fooi van € 12,50.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('12,50')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  await openMore(page, 'Opslag')
  const section = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Exporteren' }) })
  await section.getByRole('button', { name: 'Exporteren' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('.export-warning')).toContainText('niet versleuteld')
  await expect(sheet).toContainText('Niet in de export: deelnemers en studenten')
  await expect(sheet).toContainText('Wel in de export: namen van schippers en co-schippers')
  await expect(sheet.locator('.export-files li')).toHaveCount(6)
  await expect(sheet.locator('.export-files')).toContainText('dagen.csv')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/opslag/exporteren.png' })
  // Annuleren: niets gemaakt.
  let downloads = 0
  page.on('download', () => downloads++)
  await sheet.getByRole('button', { name: 'Annuleren' }).click()
  await expect(sheet).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(downloads).toBe(0)

  const writes = () => github.requests.filter((r) => r.method === 'PUT').length
  const before = writes()
  await section.getByRole('button', { name: 'Exporteren' }).click()
  const download = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Onversleuteld exporteren' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^logboek-export-\d{4}-\d{2}-\d{2}\.zip$/)
  const zip = unzipSync(new Uint8Array(await readFile((await file.path())!)))
  expect(Object.keys(zip).sort()).toEqual(['boten.csv', 'dagen.csv', 'inkomsten.csv', 'plaatsen.csv', 'trips.csv', 'uitgaven.csv'])
  const days = strFromU8(zip['dagen.csv']!).split('\r\n')
  expect(days[0]).toContain('Datum;Trip;Van (plaats)')
  expect(days).toHaveLength(8 + 2)
  expect(days.find((l) => l.includes('Zoutbaai'))).toContain('Nepboot Een')
  expect(strFromU8(zip['boten.csv']!)).toContain('Nepboot Twee')
  expect(strFromU8(zip['plaatsen.csv']!)).toContain('Fjordhaven')
  expect(strFromU8(zip['inkomsten.csv']!)).toContain(';12,5;EUR;12,5;')
  // Het maken en delen van de export schrijft niets naar GitHub, en de inhoud staat nergens leesbaar in een verzoek.
  await page.waitForTimeout(1_000)
  expect(writes()).toBe(before)
  expect(github.requests.some((r) => /Zoutbaai|Nepboot/.test(r.body ?? ''))).toBe(false)
  expect(errors).toEqual([])
})
