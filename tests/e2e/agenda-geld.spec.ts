import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Agenda met "Toon bedragen" (360 px): het netto bedrag in de dagtegel (inkomsten min uitgaven, kort genoteerd, groen of
// rood, leeg bij nul), een tik op een dag = de transacties van die dag met het subtotaal, een tik op een transactie =
// bewerken; onder de maand het netto van de maand. Standaard uit en per apparaat onthouden. Alles verzonnen.

async function addMoney(page: Page, tab: 'Uitgave' | 'Inkomsten', amount: string, description: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: tab }).click()
  await page.getByLabel('Bedrag').fill(amount)
  if (tab === 'Uitgave') await page.getByLabel('Omschrijving').fill(description)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.add-layer')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
}

test.use({ locale: 'nl-NL', viewport: { width: 360, height: 800 } })

test('agenda: netto per dag met bedragen aan, transacties van een dag, maandsom', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.setSystemTime(new Date('2027-03-08T10:00:00'))
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  // Een vliegticket (één dag rood, niet verdeeld) en een inkomen op dezelfde dag.
  await addMoney(page, 'Uitgave', '1250', 'Nepvlucht')
  await addMoney(page, 'Inkomsten', '50', '')

  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  const tile = page.locator('.cal-day', { has: page.locator('.cal-num', { hasText: /^8$/ }) }).filter({ hasNot: page.locator('.other-month') }).first()
  // Standaard uit: geen bedragen in de tegels.
  await expect(page.locator('.cal-net')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toon bedragen' }).click()
  await expect(tile.locator('.cal-net')).toHaveText('−1,2k')
  await expect(tile.locator('.cal-net')).toHaveClass(/negative/)
  await expect(page.locator('.agenda-net')).toContainText('−€ 1.200,00')
  // Per apparaat onthouden.
  expect(await page.evaluate(() => localStorage.getItem('logboek-agenda-bedragen'))).toBe('1')
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/agenda-geld/maand-360-${scheme}-nl.png`, fullPage: true })
  }
  await page.emulateMedia({ colorScheme: 'light' })
  // Geen afgekapte tekst in de tegel.
  const net = tile.locator('.cal-net')
  expect(await net.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  // Tik op de dag: de transacties met het subtotaal; tik op een transactie = bewerken.
  await tile.click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('.day-money li')).toHaveCount(2)
  await expect(sheet.locator('.day-money-total')).toContainText('−€ 1.200,00')
  await page.screenshot({ path: 'screenshots/agenda-geld/dag-360-light-nl.png' })
  await sheet.getByRole('button', { name: /Nepvlucht/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Uitgave bewerken')
  await page.getByRole('dialog').getByLabel('Bedrag').fill('1150')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  // Terug in de lijst van die dag, met het nieuwe subtotaal; sluiten brengt de agenda terug.
  await expect(sheet.locator('.day-money-total')).toContainText('−€ 1.100,00')
  await sheet.getByRole('button', { name: 'Sluiten' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(tile.locator('.cal-net')).toHaveText('−1,1k')

  // Uit: weer geen bedragen, en een tik op de dag opent gewoon de dagkaart.
  await page.getByRole('button', { name: 'Verberg bedragen' }).click()
  await expect(page.locator('.cal-net')).toHaveCount(0)
  expect(errors).toEqual([])
})
