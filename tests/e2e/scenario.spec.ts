import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Geld → Verwacht → Scenario als stappenplan (src/components/ScenarioPlanner.tsx). Een nieuwe gebruiker zonder planning
// en zonder rekeningen: stap 1 een eigen startwaarde en vier weken vooruit, stap 2 een blok met salaris, fooi en kosten,
// stap 3 een eenmalige uitgave, stap 4 een doel met een datum. Het rapport sluit, met de doellijn in de grafiek; een blok
// omhoog verandert het rapport; Gepland laat het stappenplan weg. Op 360 px, alles verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function addBlock(page: Page, weeks: string, salary: string, tips: string, costs?: string) {
  await page.getByRole('button', { name: 'Blok toevoegen' }).click()
  const sheet = page.getByRole('dialog', { name: 'Blok toevoegen' })
  // Invullen met de eerdere weken (een nieuwe gebruiker: alles 0), daarna zelf aanpassen.
  await sheet.getByRole('button', { name: 'Gemiddelde laatste 12 weken' }).click()
  await expect(sheet.getByLabel('Salaris per week')).toHaveValue('0')
  await sheet.getByLabel('Aantal weken').fill(weeks)
  await sheet.getByLabel('Salaris per week').fill(salary)
  await sheet.getByLabel('Fooi per week').fill(tips)
  await sheet.getByLabel('Kosten per week (optioneel)').fill(costs ?? '')
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Blok opgeslagen')
}

test('scenario als stappenplan: start, blokken, eenmalig en doel; rapport sluit, blok omhoog, Gepland en Scenario', async ({ page }) => {
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
  // Geen periode bovenaan: het scenario heeft zijn eigen start en einde.
  await expect(page.getByRole('radiogroup', { name: 'Periode' })).toHaveCount(0)

  // Stap 1: een eigen startwaarde en vier weken vooruit.
  await planner.getByRole('button', { name: 'Aanpassen: Start' }).click()
  const start = page.getByRole('dialog', { name: 'Stap 1: Start' })
  await start.getByLabel('Netto waarde bij de start').fill('1000')
  await start.getByLabel('Kijk vooruit tot').fill(iso(27))
  await start.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(planner.locator('.scenario-step').nth(0)).toContainText('€ 1.000,00')

  // Stap 2: vier weken met salaris € 700, fooi € 300 en kosten € 200 per week.
  await addBlock(page, '4', '700', '300', '200')
  const blocks = planner.locator('.scenario-block')
  await expect(blocks).toHaveCount(1)
  await expect(blocks.nth(0)).toContainText('Blok 1 · 4 weken')
  await expect(blocks.nth(0)).toContainText('Per week: salaris € 700,00 · fooi € 300,00 · kosten € 200,00')

  // Het rapport: € 1.000 + € 2.800 salaris + € 1.200 fooi − € 800 kosten = € 4.200; winst € 800 per week.
  const report = page.locator('.scenario-report')
  const sum = report.locator('.forecast-sum')
  await expect(sum).toContainText('Startwaarde op')
  await expect(sum.locator('li', { hasText: 'Salaris' })).toContainText('+€ 2.800,00')
  await expect(sum.locator('li', { hasText: 'Fooi' })).toContainText('+€ 1.200,00')
  await expect(sum.locator('li', { hasText: 'Kosten' })).toContainText('−€ 800,00')
  await expect(sum.locator('.forecast-total')).toContainText('€ 4.200,00')
  await expect(report.locator('.stats-hero-item', { hasText: 'Verandering' })).toContainText('+€ 3.200,00')
  await expect(report.locator('.stats-hero-item', { hasText: 'Winst per week' })).toContainText('+€ 800,00')
  await expect(report.locator('.line-chart')).toBeVisible()
  await expect(report.locator('.legend')).toContainText('Inkomsten')
  await expect(report.locator('.legend')).toContainText('Kosten')

  // Stap 3: een eenmalige uitgave over tien dagen.
  await planner.getByRole('button', { name: 'Eenmalige uitgave toevoegen' }).click()
  const oneOff = page.getByRole('dialog', { name: 'Eenmalige uitgave toevoegen' })
  await oneOff.getByLabel('Wat').fill('Nepauto')
  await oneOff.getByLabel('Wanneer').fill(iso(10))
  await oneOff.getByLabel('Bedrag').fill('500')
  await oneOff.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(planner).toContainText('Nepauto')
  await expect(sum.locator('li', { hasText: 'Eenmalige uitgaven' })).toContainText('−€ 500,00')
  await expect(sum.locator('.forecast-total')).toContainText('€ 3.700,00')

  // Stap 4: € 3.000 halen binnen twee weken. Na twee weken staat er € 1.000 + 2 × € 800 − € 500 = € 2.100; nodig is dus
  // € 800 + € 900 / 2 = € 1.250 per week. Met dit plan gehaald na vier weken (€ 3.700).
  await planner.getByRole('button', { name: 'Aanpassen: Doel' }).click()
  const goal = page.getByRole('dialog', { name: 'Stap 4: Doel' })
  await goal.getByRole('radio', { name: 'Een bedrag halen' }).click()
  await goal.getByLabel('Doel (netto waarde)').fill('3000')
  await goal.getByLabel('Vóór (optioneel)').fill(iso(13))
  await goal.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(planner.locator('.scenario-step').nth(3)).toContainText('€ 3.000,00 halen vóór')
  await expect(report.locator('.stats-hero-item', { hasText: 'gehaald op' })).not.toContainText('Niet binnen 40 jaar')
  await expect(report.locator('.stats-hero-item', { hasText: 'Nodig per week' })).toContainText('+€ 1.250,00')
  await expect(report.locator('.stats-hero-item', { hasText: 'Nodig per week' })).toContainText('plan: +€ 800,00')
  await expect(report.locator('.line-chart .goal-line')).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/scenario.png', fullPage: true })

  // Een tweede blok (twee weken, alleen € 100 salaris, gemiddelde kosten: 0) en omhoog: nu eerst de twee magere weken.
  // Nul fooi mag.
  await addBlock(page, '2', '100', '0')
  await expect(blocks).toHaveCount(2)
  await expect(sum.locator('.forecast-total')).toContainText('€ 3.700,00')
  await planner.getByRole('button', { name: 'Omhoog: blok 2' }).click()
  await expect(blocks.nth(0)).toContainText('Blok 1 · 2 weken')
  // € 1.000 + 2 × € 100 + 2 × € 800 − € 500 = € 2.300.
  await expect(sum.locator('.forecast-total')).toContainText('€ 2.300,00')

  // De tabel per maand is ingeklapt.
  await report.getByText('Tabel per maand').click()
  await expect(report.locator('.scenario-table tbody tr').first()).toBeVisible()

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
