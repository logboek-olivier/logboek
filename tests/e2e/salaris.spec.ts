import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Salaris per tocht (src/domain/geldmodel.ts): precies één loon-transactie per tocht met een status. Het standaardbedrag
// per organisatie is een instelling: een komende tocht krijgt het als verwacht salaris, een voorbije nooit vanzelf.
// "Standaardbedrag gebruiken" vult alleen het bedrag in; een salaris dat er al staat, verandert niet door een nieuw
// standaardbedrag. Vandaag vraagt na de einddatum "Salaris van … ontvangen?" zonder bedragen; Geld → Vooruitblik toont
// bedragen pas na "Toon bedragen". Verzonnen data.

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

async function newTrip(page: Page, name: string, start: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  await sheet.getByRole('combobox', { name: 'Organisatie' }).selectOption({ label: 'Sailing Virgins' })
  // Geen salarisveld meer in het tripformulier: het salaris is een eigen transactie bij de tocht.
  await expect(sheet.getByLabel('Salaris (bedrag)')).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/**
 * Het salarisblad van een tocht openen (Meer → Periodes → zoeken → tripoverzicht → Bewerken → Fooien en inkomsten →
 * Salaris), `work` doen in het blad, en alles weer sluiten. Geeft de regel van het salaris terug (zoals vóór het blad).
 */
async function withSalarySheet(page: Page, name: string, work: (sheet: Locator) => Promise<void>): Promise<string> {
  await openMore(page, 'Periodes')
  await page.getByLabel('Zoeken op naam, boot, plaats of persoon').fill(name)
  await page.locator('.period-row', { hasText: name }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken', exact: true }).first().click()
  const edit = page.getByRole('dialog', { name: 'Trip bewerken' })
  await edit.getByRole('button', { name: /^Geld/ }).click()
  const line = (await edit.locator('.salary-row').innerText()).replace(/\s+/g, ' ')
  await edit.locator('.salary-row').click()
  const sheet = page.getByRole('dialog', { name: new RegExp(`^Salaris van .*${name}`) })
  await work(sheet)
  // Opslaan sluit het salarisblad; anders zelf sluiten.
  if (await sheet.isVisible()) await sheet.getByRole('button', { name: 'Sluiten', exact: true }).click()
  await page.getByRole('dialog', { name: 'Trip bewerken' }).getByRole('button', { name: 'Sluiten', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  return line
}

/** Het bedrag van het salaris van een tocht zoals het blad het voorvult. */
async function salaryOf(page: Page, name: string): Promise<string> {
  let value = ''
  await withSalarySheet(page, name, async (sheet) => {
    value = await sheet.getByLabel('Salaris (bedrag)').inputValue()
  })
  return value
}

/** Het salaris van een tocht zetten: een bedrag typen (of het standaardbedrag gebruiken) en opslaan. */
async function setSalary(page: Page, name: string, amount: string | 'standaard') {
  await withSalarySheet(page, name, async (sheet) => {
    if (amount === 'standaard') await sheet.getByRole('button', { name: /^Standaardbedrag gebruiken/ }).click()
    else await sheet.getByLabel('Salaris (bedrag)').fill(amount)
    await sheet.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.locator('.toast')).toContainText('Salaris opgeslagen')
  })
}

test('salaris per tocht: standaardbedrag voor komende tochten, eigen bedrag blijft, ontvangen op Vandaag, vooruitblik', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })

  await setDefault(page, '1200')
  await expect(page.locator('.toast')).toHaveText('Salaris opgeslagen')
  await expect(page.getByRole('button', { name: /^Salaris per organisatie/ })).toContainText('Sailing Virgins')
  await expect(page.getByRole('button', { name: /^Salaris per organisatie/ })).not.toContainText('1.200')

  // Een voorbije tocht (geen standaardbedrag vanzelf: Olivier vult het zelf in), een komende met het standaardbedrag en
  // een komende met een eigen bedrag.
  await newTrip(page, 'Nepweek voorbij', iso(-12))
  await newTrip(page, 'Nepweek straks', iso(20))
  await newTrip(page, 'Nepweek eigen', iso(40))
  expect(await withSalarySheet(page, 'Nepweek voorbij', async () => {})).toContain('Nog geen salaris')
  await setSalary(page, 'Nepweek voorbij', '1200')
  expect(await salaryOf(page, 'Nepweek straks')).toBe('1200')
  await setSalary(page, 'Nepweek eigen', '1500')

  // Een nieuw standaardbedrag is alleen een instelling: wat er al staat, verandert niet (geen vraag meer).
  await setDefault(page, '1300')
  await expect(page.locator('.toast')).toHaveText('Salaris opgeslagen')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await salaryOf(page, 'Nepweek straks')).toBe('1200')
  expect(await salaryOf(page, 'Nepweek eigen')).toBe('1500')
  // "Standaardbedrag gebruiken" vult alleen het bedrag in.
  await setSalary(page, 'Nepweek straks', 'standaard')
  expect(await salaryOf(page, 'Nepweek straks')).toBe('1300')

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
  await expect(receive.getByLabel('Ontvangen bedrag')).toHaveValue('1200')
  await receive.getByLabel('Ontvangen bedrag').fill('1250')
  await receive.getByRole('button', { name: 'Ontvangen opslaan' }).click()
  await expect(page.locator('.toast')).toContainText('Salaris ontvangen')
  await expect(question).toHaveCount(0)
  // Eén salaris per tocht: het blad toont nu het ontvangen bedrag, er komt geen tweede bij.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  expect(await salaryOf(page, 'Nepweek voorbij')).toBe('1250')

  // Geld → Vooruitblik: bedragen pas na Toon bedragen; verwacht 1.300 + 1.500, ontvangen 1.250 deze maand.
  await openMore(page, 'Geld')
  await page.getByRole('tab', { name: 'Verwacht' }).click()
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
