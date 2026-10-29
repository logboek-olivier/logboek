import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// PR C: salaris per trip. Standaardbedrag per organisatie, een eigen bedrag wordt nooit overschreven, een nieuw
// standaardbedrag gaat alleen na "ja" naar komende trips met het oude bedrag. Vandaag vraagt na de einddatum
// "Salaris van … ontvangen?" zonder bedragen; Geld → Vooruitblik toont bedragen pas na "Toon bedragen". Verzonnen data.

test.use({ viewport: { width: 360, height: 800 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function setDefault(page: Page, amount: string) {
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: /^Salaris per organisatie/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Sailing Virgins', { exact: true }).fill(amount)
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
}

async function newTrip(page: Page, name: string, start: string, ownSalary?: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  await sheet.getByRole('combobox', { name: 'Organisatie' }).selectOption({ label: 'Sailing Virgins' })
  // Het salaris staat ingeklapt: geen bedragen in beeld zolang Olivier er niet om vraagt.
  await expect(sheet.getByLabel('Salaris (bedrag)')).toHaveCount(0)
  await sheet.getByRole('button', { name: /^Salaris/ }).click()
  if (ownSalary) await sheet.getByLabel('Salaris (bedrag)').fill(ownSalary)
  else {
    await expect(sheet.getByLabel('Salaris (bedrag)')).toHaveValue('1.200')
    await expect(sheet).toContainText('Standaardbedrag van Sailing Virgins')
  }
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function salaryOf(page: Page, name: string): Promise<string> {
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Komende trips' }) }).getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: /^Salaris/ }).click()
  const value = await sheet.getByLabel('Salaris (bedrag)').inputValue()
  await sheet.getByRole('button', { name: 'Sluiten' }).click()
  return value
}

test('salaris per trip: standaardbedrag, eigen bedrag blijft, vraag bij een nieuw standaardbedrag, ontvangen op Vandaag, vooruitblik', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  await setDefault(page, '1200')
  await expect(page.locator('.toast')).toHaveText('Salaris opgeslagen')
  await expect(page.getByRole('button', { name: /^Salaris per organisatie/ })).toContainText('Sailing Virgins')
  await expect(page.getByRole('button', { name: /^Salaris per organisatie/ })).not.toContainText('1.200')

  // Een voorbije trip met het standaardbedrag, een komende met het standaardbedrag en een komende met een eigen bedrag.
  await newTrip(page, 'Nepweek voorbij', iso(-12))
  await newTrip(page, 'Nepweek straks', iso(20))
  await newTrip(page, 'Nepweek eigen', iso(40), '1500')

  // Nieuw standaardbedrag: eerst de vraag voor de ene komende trip met het oude bedrag; de eigen trip telt niet mee.
  await setDefault(page, '1300')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Ook gebruiken voor 1 toekomstige trip die nog het oude standaardbedrag heeft?')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/salaris/vraag-standaard.png' })
  await sheet.getByRole('button', { name: 'Ja, ook voor die trips' }).click()
  await expect(page.locator('.toast')).toHaveText('Salaris opgeslagen')
  expect(await salaryOf(page, 'Nepweek straks')).toBe('1.300')
  expect(await salaryOf(page, 'Nepweek eigen')).toBe('1.500')

  // Vandaag: de vraag na de einddatum, zonder bedragen; ander bedrag invullen.
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  const question = page.locator('.salary-question')
  await expect(question).toHaveCount(1)
  await expect(question).toContainText('Salaris van SV #1 · Nepweek voorbij ontvangen?')
  await expect(page.locator('main')).not.toContainText('€')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/salaris/vandaag-vraag.png' })
  await question.getByRole('button', { name: 'Ander bedrag' }).click()
  const receive = page.getByRole('dialog')
  await expect(receive.getByLabel('Ontvangen bedrag')).toHaveValue('1.200')
  await receive.getByLabel('Ontvangen bedrag').fill('1250')
  await receive.getByRole('button', { name: 'Ontvangen opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Salaris ontvangen')
  await expect(question).toHaveCount(0)

  // Geld → Vooruitblik: bedragen pas na Toon bedragen; verwacht 1.300 + 1.500, ontvangen 1.250 deze maand.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await openMore(page, 'Geld')
  const outlook = page.locator('.outlook')
  await expect(outlook).toContainText('Verwacht salaris voor 2 trips')
  await expect(outlook).not.toContainText('€')
  await outlook.getByRole('button', { name: 'Toon bedragen' }).click()
  await expect(outlook.locator('.outlook-total')).toContainText('€ 2.800,00')
  await expect(outlook.locator('.outlook-table')).toContainText('€ 1.250,00')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/salaris/vooruitblik.png', fullPage: true })

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Nepweek')
  expect(wire).not.toContain('1300')
  expect(errors).toEqual([])
})
