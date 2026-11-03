import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Geld → Verwacht: Gepland | Scenario (src/components/Scenario.tsx). Een nieuwe gebruiker zonder planning en zonder
// rekeningen maakt een scenario met twee blokken (20 weken × € 2.000, daarna 10 weken × € 1.000), zet een blok omhoog,
// klikt door op het scenario-inkomen en wisselt tussen Gepland en Scenario. De som sluit. Op 360 px, alles verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function addBlock(page: Page, weeks: string, income: string) {
  await page.getByRole('button', { name: 'Blok toevoegen' }).click()
  const sheet = page.getByRole('dialog', { name: 'Blok toevoegen' })
  await sheet.getByLabel('Aantal weken').fill(weeks)
  await sheet.getByLabel('Inkomen per week').fill(income)
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Blok opgeslagen')
}

test('scenario met twee blokken, eenmalige uitgave en groei: som sluit, blok omhoog, doorklikken, Gepland en Scenario', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await openMore(page, 'Geld')
  await page.getByRole('tab', { name: 'Verwacht' }).click()
  const modes = page.getByRole('radiogroup', { name: 'Vooruitblik' })
  await expect(modes.getByRole('radio', { name: 'Gepland' })).toHaveAttribute('aria-checked', 'true')
  await modes.getByRole('radio', { name: 'Scenario' }).click()

  // Een scenario maken (één veld: de naam) en twee blokken toevoegen (hoogstens drie velden per blok).
  await page.getByRole('button', { name: 'Scenario maken' }).click()
  await page.getByRole('dialog').getByLabel('Naam').fill('Nepplan')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const section = page.locator('.scenario')
  await expect(section.getByRole('heading', { name: 'Nepplan' })).toBeVisible()
  // Zonder planning begint het eerste blok morgen.
  await expect(section).toContainText('de dag na het einde van de planning')
  await addBlock(page, '20', '2000')
  await addBlock(page, '10', '1000')
  const blocks = section.locator('.scenario-block')
  await expect(blocks).toHaveCount(2)
  await expect(blocks.nth(0)).toContainText('Blok 1: 20 weken × € 2.000,00 per week')
  await expect(blocks.nth(1)).toContainText('Blok 2: 10 weken × € 1.000,00 per week')

  // De som: vandaag € 0 + scenario-inkomen € 50.000 − kosten (onbekend: 0) = € 50.000 op het einde van het scenario.
  const forecast = page.locator('.forecast')
  const sum = forecast.locator('.forecast-sum')
  await expect(sum.getByRole('button', { name: /Netto waarde vandaag/ })).toContainText('€ 0,00')
  await expect(sum.getByRole('button', { name: /Scenario-inkomen/ })).toContainText('+€ 50.000,00')
  await expect(sum.locator('.forecast-total')).toContainText('€ 50.000,00')
  await expect(forecast).toContainText('Tot het einde van het scenario')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/geld/scenario.png', fullPage: true })

  // Blok 2 omhoog: nu eerst de 10 weken; het totaal blijft gelijk.
  await section.getByRole('button', { name: 'Omhoog: blok 2' }).click()
  await expect(blocks.nth(0)).toContainText('Blok 1: 10 weken × € 1.000,00 per week')
  await expect(sum.getByRole('button', { name: /Scenario-inkomen/ })).toContainText('+€ 50.000,00')

  // Doorklikken op het scenario-inkomen: per blok, samen het getikte bedrag.
  await sum.getByRole('button', { name: /Scenario-inkomen/ }).click()
  const drill = page.getByRole('dialog', { name: 'Scenario-inkomen' })
  await expect(drill.locator('.drill-total')).toContainText('+€ 50.000,00')
  await expect(drill.locator('.drill-group')).toHaveCount(2)
  await expect(drill.locator('.drill-group').nth(0).locator('h3')).toContainText('+€ 10.000,00')
  await expect(drill.locator('.drill-group').nth(1).locator('h3')).toContainText('+€ 40.000,00')
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Een eenmalige uitgave (drie velden) en een horizon: de som krijgt de regel Eenmalige uitgaven.
  await section.getByRole('button', { name: 'Eenmalige uitgave toevoegen' }).click()
  const oneOff = page.getByRole('dialog', { name: 'Eenmalige uitgave toevoegen' })
  await oneOff.getByLabel('Wat').fill('Nepauto')
  await oneOff.getByLabel('Wanneer').fill(iso(120))
  await oneOff.getByLabel('Bedrag').fill('15000')
  await oneOff.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(section).toContainText('Nepauto')
  await expect(sum.getByRole('button', { name: /Eenmalige uitgaven/ })).toContainText('−€ 15.000,00')
  await expect(sum.locator('.forecast-total')).toContainText('€ 35.000,00')

  // Aannames: zonder beleggingen is de groei 0; met een beleggen-rekening van € 10.000 en 12% per jaar groeit die.
  await expect(section).toContainText('Geen groei, geen rente, niets belegd uit het inkomen.')
  await section.getByRole('button', { name: 'Aanpassen' }).last().click()
  const assume = page.getByRole('dialog', { name: 'Aannames' })
  await assume.getByLabel('Groei beleggingen (% per jaar)').fill('12')
  await assume.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(section).toContainText('Beleggingen 12%')
  await expect(sum.getByRole('button', { name: /Waardegroei/ })).toContainText('€ 0,00')
  await openMore(page, 'Rekeningen')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'BUX' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await page.locator('.row-button', { hasText: 'BUX' }).click()
  await page.getByRole('dialog').getByLabel('Stand', { exact: true }).fill('10000')
  await page.getByRole('dialog').getByRole('button', { name: 'Stand opslaan' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await openMore(page, 'Geld')
  // 12% per jaar over € 10.000, vanaf morgen tot het einde van het scenario (ruim zeven maanden): tussen € 600 en € 900.
  const growth = page.locator('.forecast-sum').getByRole('button', { name: /Waardegroei/ })
  await expect(growth).toContainText(/\+€ [678]\d\d,\d\d/)
  await growth.click()
  const growthDrill = page.getByRole('dialog', { name: /Waardegroei/ })
  await expect(growthDrill).toContainText('Groei beleggingen')
  await expect(growthDrill.locator('.drill-group h3')).toHaveCount(1)
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Gepland: geen scenario-inkomen en geen scenarioblok; terug naar Scenario: alles staat er weer.
  await modes.getByRole('radio', { name: 'Gepland' }).click()
  await expect(page.locator('.scenario')).toHaveCount(0)
  await expect(page.locator('.forecast')).not.toContainText('Scenario-inkomen')
  await modes.getByRole('radio', { name: 'Scenario' }).click()
  await expect(page.locator('.forecast-sum').getByRole('button', { name: /Scenario-inkomen/ })).toContainText('+€ 50.000,00')
  // De keuze blijft na herladen (per apparaat).
  await page.reload()
  await openMore(page, 'Geld')
  await expect(page.getByRole('radiogroup', { name: 'Vooruitblik' }).getByRole('radio', { name: 'Scenario' })).toHaveAttribute('aria-checked', 'true')
  expect(errors).toEqual([])
})
