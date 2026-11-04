import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Geld → Verwacht → Scenario om in te typen, zoals in Excel (src/components/ScenarioPlanner.tsx): stap 1 een eigen
// startwaarde en vier weken vooruit, stap 2 een blok met trips (4 trips in 4 weken, salaris en fooi per trip, kosten
// per week), stap 3 een eenmalige uitgave, stap 4 een doel (netto waarde, daarna verdienen). Het rapport sluit, met de
// doellijn; een blok omhoog verandert het rapport; Gepland laat het stappenplan weg. Op 360 px, alles verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Een veld invullen en met Enter opslaan. */
async function type(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(value)
  await field.press('Enter')
}

test('scenario om in te typen: start, blokken met trips, eenmalig en doel; rapport sluit, blok omhoog, Gepland en Scenario', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await openMore(page, 'Geld')
  await page.getByRole('tab', { name: 'Verwacht' }).click()
  const modes = page.getByRole('radiogroup', { name: 'Vooruitblik' })
  await expect(modes.getByRole('radio', { name: 'Gepland' })).toHaveAttribute('aria-checked', 'true')
  await modes.getByRole('radio', { name: 'Scenario' }).click()

  await page.getByRole('button', { name: 'Scenario maken' }).click()
  await page.getByRole('dialog').getByLabel('Naam').fill('Nepplan')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const planner = page.locator('.scenario-planner')
  await expect(planner.getByRole('heading', { name: 'Nepplan' })).toBeVisible()
  await expect(planner.locator('.scenario-step')).toHaveCount(4)
  await expect(page.getByRole('radiogroup', { name: 'Periode' })).toHaveCount(0)

  // Stap 1: een eigen startwaarde en vier weken vooruit, direct in de velden.
  await type(page, 'Netto waarde bij de start', '1000')
  await page.getByLabel('Kijk vooruit tot', { exact: true }).fill(iso(27))
  const report = page.locator('.scenario-report')
  const sum = report.locator('.forecast-sum')
  await expect(sum).toContainText('Startwaarde op')

  // Stap 2: een blok van 4 weken met 4 trips (salaris € 700 en fooi € 300 per trip) en € 200 kosten per week.
  await page.getByRole('button', { name: 'Blok toevoegen' }).click()
  await type(page, 'Salaris per trip: blok 1', '700')
  await type(page, 'Fooi per trip: blok 1', '300')
  await type(page, 'Kosten per week: blok 1', '200')
  const blocks = planner.locator('.scenario-block-edit')
  await expect(blocks).toHaveCount(1)
  await expect(blocks.nth(0)).toContainText('Blok 1 · 4 weken')
  await expect(blocks.nth(0)).toContainText('Inkomen gemiddeld € 1.000,00 per week')

  // Het rapport: € 1.000 + € 2.800 salaris + € 1.200 fooi − € 800 kosten = € 4.200; winst € 800 per week.
  await expect(sum.locator('li', { hasText: 'Salaris' })).toContainText('+€ 2.800,00')
  await expect(sum.locator('li', { hasText: 'Fooi' })).toContainText('+€ 1.200,00')
  await expect(sum.locator('li', { hasText: 'Kosten' })).toContainText('−€ 800,00')
  await expect(sum.locator('.forecast-total')).toContainText('€ 4.200,00')
  await expect(report.locator('.stats-hero-item', { hasText: 'Winst per week' })).toContainText('+€ 800,00')

  // Twee trips in plaats van vier, evenredig over de vier weken: salaris € 1.400 en fooi € 600.
  await type(page, 'Trips: blok 1', '2')
  await expect(sum.locator('li', { hasText: 'Salaris' })).toContainText('+€ 1.400,00')
  await type(page, 'Trips: blok 1', '4')
  await expect(sum.locator('.forecast-total')).toContainText('€ 4.200,00')

  // Stap 3: een eenmalige uitgave over tien dagen.
  await planner.getByRole('button', { name: 'Eenmalige uitgave toevoegen' }).click()
  const oneOff = page.getByRole('dialog', { name: 'Eenmalige uitgave toevoegen' })
  await oneOff.getByLabel('Wat').fill('Nepauto')
  await oneOff.getByLabel('Wanneer').fill(iso(10))
  await oneOff.getByLabel('Bedrag').fill('500')
  await oneOff.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(sum.locator('li', { hasText: 'Eenmalige uitgaven' })).toContainText('−€ 500,00')
  await expect(sum.locator('.forecast-total')).toContainText('€ 3.700,00')

  // Stap 4: € 3.000 netto waarde vóór twee weken; nodig is € 800 + € 900 / 2 = € 1.250 winst per week.
  const goalKinds = page.getByRole('radiogroup', { name: 'Doel' })
  await goalKinds.getByRole('radio', { name: 'Netto waarde halen' }).click()
  await type(page, 'Doel (netto waarde)', '3000')
  await page.getByLabel('Vóór (optioneel)', { exact: true }).fill(iso(13))
  await expect(report.locator('.stats-hero-item', { hasText: 'Nodig per week' })).toContainText('+€ 1.250,00')
  await expect(report.locator('.line-chart .goal-line')).toHaveCount(1)
  // Verdienen in plaats van netto waarde: € 3.000 verdiend (salaris plus fooi), los van de kosten.
  await goalKinds.getByRole('radio', { name: 'Een bedrag verdienen' }).click()
  await expect(report.locator('.stats-hero-item', { hasText: 'verdiend op' })).toBeVisible()
  await expect(report.getByRole('heading', { name: 'Verdiend (opgeteld)' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/scenario.png', fullPage: true })

  // Een tweede blok (twee weken, één trip van € 200, geen kosten) en omhoog: nu eerst de magere weken.
  await page.getByRole('button', { name: 'Blok toevoegen' }).click()
  await type(page, 'Aantal weken: blok 2', '2')
  await type(page, 'Trips: blok 2', '1')
  await type(page, 'Salaris per trip: blok 2', '200')
  await type(page, 'Kosten per week: blok 2', '0')
  await expect(blocks).toHaveCount(2)
  await expect(sum.locator('.forecast-total')).toContainText('€ 3.700,00')
  await planner.getByRole('button', { name: 'Omhoog: blok 2' }).click()
  await expect(blocks.nth(0)).toContainText('Blok 1 · 2 weken')
  // € 1.000 + € 200 + 2 × € 800 − € 500 = € 2.300.
  await expect(sum.locator('.forecast-total')).toContainText('€ 2.300,00')

  // Gepland: geen stappenplan; terug naar Scenario: alles staat er weer, ook na herladen.
  await modes.getByRole('radio', { name: 'Gepland' }).click()
  await expect(page.locator('.scenario-planner')).toHaveCount(0)
  await modes.getByRole('radio', { name: 'Scenario' }).click()
  await expect(page.locator('.scenario-report .forecast-total')).toContainText('€ 2.300,00')
  await page.reload()
  await openMore(page, 'Geld')
  await expect(page.getByRole('radiogroup', { name: 'Vooruitblik' }).getByRole('radio', { name: 'Scenario' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.scenario-report .forecast-total')).toContainText('€ 2.300,00')
  expect(errors).toEqual([])
})

test('Gepland: verwachte fooi per charter en per organisatie zelf invullen', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })
  // Een komende werktrip van Yacht Week.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill(iso(14))
  await page.getByRole('button', { name: 'Meer velden' }).click()
  await page.getByLabel('Organisatie').selectOption('yacht-week')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await openMore(page, 'Geld')
  await page.getByRole('tab', { name: 'Verwacht' }).click()
  const tips = page.locator('.expected-tips')
  await expect(tips.getByRole('heading', { name: 'Verwachte fooi per trip' })).toBeVisible()
  // Standaard per trip voor Yacht Week, en voor deze trip een eigen bedrag dat voorgaat.
  await type(page, 'Yacht Week, standaard per trip', '300')
  await expect(page.locator('.toast')).toContainText('Verwachte fooi opgeslagen')
  await expect(tips.locator('.expected-tip-row').nth(1)).toContainText('€ 300,00')
  const own = tips.locator('.expected-tip-row').nth(1).getByRole('textbox')
  await own.fill('450')
  await own.press('Enter')
  await expect(tips.locator('.expected-tip-row').nth(1)).toContainText('€ 450,00')
  await expectNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})
