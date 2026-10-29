import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// PR F: Meer → Statistieken. Zeilen, RYA Yachtmaster Offshore, werk, geld (pas na "Toon bedragen") en de filters.
// Verzonnen gegevens; er gaat niets naar buiten.

test.use({ viewport: { width: 360, height: 800 } })

function iso(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('statistieken: zeilen, RYA, werk en geld achter Toon bedragen; filters', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  // Een trip van Yacht Week die vandaag begint, twee dagen en een fooi.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByRole('button', { name: 'Meer velden' }).click()
  await page.getByLabel('Organisatie').selectOption('yacht-week')
  await page.getByLabel('Gebied').fill('Nepgebied')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  for (const [to, nm] of [
    ['Nepdorp', '65'],
    ['Nepbaai', '12'],
  ] as const) {
    await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
    await page.getByLabel('Naar', { exact: true }).fill(to)
    await page.getByLabel('Zeemijlen').fill(nm)
    await page.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.getByText('Dag opgeslagen')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('140')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Fooi opgeslagen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  await openMore(page, 'Statistieken')
  await expect(page.getByRole('heading', { name: 'Statistieken' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Dit jaar' })).toHaveAttribute('aria-checked', 'true')
  const main = page.locator('main')
  await expect(main).toContainText('Totaal77 nm')
  await expect(main).toContainText('Dagen op het water2')
  await expect(page.getByRole('list', { name: 'Per gebied' })).toContainText('Nepgebied')
  await expect(page.getByRole('list', { name: 'Trips per organisatie' })).toContainText('Yacht Week · t/m YW #1')
  await expect(main).toContainText('Langste dagtocht')
  await expect(main).toContainText('65 nm')
  // RYA Yachtmaster Offshore als checklist met de vermelding.
  // Beide dagen staan op vandaag: één datum op zee.
  await expect(main).toContainText('1 van 50 dagen op zee')
  await expect(main).toContainText('1 van 5 passages van meer dan 60 nm')
  await expect(main).toContainText('Controleer tegen de actuele RYA-eisen')
  // Werk: de dagen van de trip uit de agenda.
  await expect(main).toContainText('Werkdagen per maand')

  // Geld pas na Toon bedragen.
  await expect(main).not.toContainText('€ 140,00')
  await page.getByRole('button', { name: 'Toon bedragen' }).click()
  await expect(main).toContainText('Verdiend€ 140,00')
  await expect(page.getByRole('list', { name: 'Inkomsten per organisatie' })).toContainText('Yacht Week')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/statistieken/dit-jaar.png', fullPage: true })

  // Eigen periode: een einddatum vóór de begindatum geeft een melding; een periode zonder dagen toont niets leegs.
  await page.getByRole('radio', { name: 'Eigen periode' }).click()
  await page.getByLabel('Van', { exact: true }).fill(iso(-400))
  await page.getByLabel('Tot en met', { exact: true }).fill(iso(-401))
  await expect(main).toContainText('Kies een einddatum op of na de begindatum.')
  await page.getByLabel('Tot en met', { exact: true }).fill(iso(-380))
  await expect(main).toContainText('Nog niets gelogd in deze periode.')
  await expect(main).not.toContainText('Zeilen')
  await page.getByRole('radio', { name: 'Alles' }).click()
  await expect(main).toContainText('Totaal77 nm')

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Nepgebied')
  expect(errors).toEqual([])
})
