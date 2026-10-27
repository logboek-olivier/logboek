import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 } })

// Twee eerdere trips met dezelfde route (verzonnen plaatsen), als CSV-export van de mijlenregistratie.
const HEADER = 'Datum;Van (plaats);Van (land);Naar (plaats);Naar (land);Rol;Schip;Schipper/trainer;Co-schipper (flot.leider);Wind (bft);Binnenwater;Zee;Zee (getijnavigatie);Totaal;Nacht-uren;Bijzonderheden'
const row = (date: string, from: string, to: string, nm: number, note = '') => `${date};${from};Nepland;${to};Nepland;Schipper;Nepzon (Nepgoon 42);;;3;;${nm};;${nm};;${note}`
const CSV = [
  HEADER,
  row('01-06-2025', 'Nepsplit', 'Nepbol', 18, 'Nepweek juni'),
  row('02-06-2025', 'Nepbol', 'Nephvar', 15),
  row('03-06-2025', 'Nephvar', 'Nepsplit', 25),
  ';;;;;;;;;;;;;;;',
  row('06-07-2025', 'Nepsplit', 'Nepbol', 22, 'Nepweek juli'),
  row('07-07-2025', 'Nepbol', 'Nephvar', 16),
  row('08-07-2025', 'Nephvar', 'Nepsplit', 24),
].join('\n')

test('Route-sjabloon uit de historie: nieuwe trip neemt boot en etappes over; op Vandaag "Zoals gepland" logt de dag', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: 'Logboek', exact: true }).click()
  await page.getByLabel('Mijlenbestand').setInputFiles({ name: 'mijlen.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await page.getByRole('button', { name: 'Importeren' }).click()
  await page.getByRole('button', { name: 'Overslaan' }).click()

  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Herhaal vorige trip' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Nepsplit → Nepsplit (2×)' }).click()
  await expect(sheet.getByLabel('Bootnaam', { exact: true })).toHaveValue('Nepzon')
  await expect(sheet.getByLabel('Model', { exact: true })).toHaveValue('Nepgoon 42')
  await expect(sheet.getByLabel('Aantal dagen')).toHaveValue('3')
  await expect(sheet).toContainText('3 etappes gepland: Nepsplit → Nepbol → Nephvar → Nepsplit')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/sjabloon.png', fullPage: true })
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()

  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  const card = page.locator('.planned-today')
  // Voorstel uit de laatste keren: (18 + 22) / 2.
  await expect(card).toContainText('Nepsplit → Nepbol · 20 nm')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/zoals-gepland.png', fullPage: true })
  await card.getByRole('button', { name: 'Zoals gepland' }).click()
  await expect(page.getByText('Dag opgeslagen')).toBeVisible()
  await expect(card).toHaveCount(0)

  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Gezeilde dagen' }) })).toContainText('Nepsplit → Nepbol')

  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepsplit', 'Nepzon']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
