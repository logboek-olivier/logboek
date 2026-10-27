import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

declare global {
  interface Window {
    __shared?: { title?: string; text?: string }
    __printed?: number
  }
}

test('Weekplanning: wizard in drie stappen, afvinken voor de groep, blok verplaatsen, tonen, delen en printen, Vandaag', async ({ page }) => {
  // Deelfunctie en printen nabootsen: de testbrowser heeft geen deelvenster en geen printer.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { title?: string; text?: string }) => {
        window.__shared = data
      },
    })
    window.print = () => {
      window.__printed = (window.__printed ?? 0) + 1
    }
  })
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()

  // Een week (training geven) met één deelnemer met cursus, zodat afvinken iets vastlegt.
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  await page.getByRole('dialog').getByLabel('Deelnemer 1', { exact: true }).fill('Nepanna')
  await page.getByRole('dialog').getByRole('combobox', { name: 'Cursus deelnemer 1' }).selectOption('seed-asa-101')
  await fillBoat(page.getByRole('dialog'))
  await page.getByRole('dialog').getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Stap 1: dagen (voorgevuld met de week).
  await expect(page.getByText('Nog geen planning voor deze trip.')).toBeVisible()
  await page.getByRole('button', { name: 'Nieuwe planning' }).click()
  await expect(page.getByText('Stap 1 van 3')).toBeVisible()
  await expect(page.getByLabel('Aantal dagen')).toHaveValue('7')
  await page.getByLabel('Aantal dagen').fill('3')
  await page.getByLabel('Titel').fill('Nepweek zeilschool')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Volgende' }).click()

  // Stap 2: groepen.
  await expect(page.getByText('Stap 2 van 3')).toBeVisible()
  await expect(page.getByLabel('Naam van de groep')).toHaveValue('Groep A')
  await expect(page.getByLabel('Nepanna')).toBeChecked()
  await page.getByRole('button', { name: 'Groep toevoegen' }).click()
  const second = page.locator('.plan-group').nth(1)
  await expect(second.getByLabel('Naam van de groep')).toHaveValue('Groep B')
  await second.getByLabel('Cursus').selectOption({ label: 'ASA 103 Basic Coastal Cruising' })
  await second.getByRole('radio', { name: 'Gevorderd' }).click()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Concept maken' }).click()

  // Stap 3: concept.
  await expect(page.getByText('Stap 3 van 3')).toBeVisible()
  await expect(page.getByText('Ochtend').first()).toBeVisible()
  await expect(page.getByText('Herhaling van de examenkritische onderwerpen').first()).toBeVisible()
  await expect(page.getByText('Examen', { exact: true }).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Planning opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Nepweek zeilschool' })).toBeVisible()

  // Tik op een onderwerp: geoefend voor de hele groep.
  const open = page.getByRole('button', { name: /tik om af te vinken voor de hele groep/ }).first()
  const topicName = ((await open.getAttribute('aria-label')) ?? '').split(':')[0]!
  await open.click()
  await expect(page.locator('.toast')).toContainText('Geoefend voor 1 student')
  await expect(page.getByRole('button', { name: `${topicName}: geoefend door de hele groep` }).first()).toHaveAttribute('aria-pressed', 'true')

  // Blok bewerken: naar dag 2, avond, met plaats; thema's met een tik aan of uit.
  const firstDay = page.locator('.plan-day').first()
  const firstBlock = firstDay.locator('.plan-block').first()
  await expect(firstBlock.locator('.plan-themes li')).toHaveCount(1)
  await firstBlock.getByRole('button', { name: /^Blok ochtend .* bewerken$/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Dag', exact: true }).selectOption({ index: 1 })
  await dialog.getByLabel('Dagdeel').selectOption({ label: 'Avond' })
  await dialog.getByLabel('Plaats').fill('Nephaven')
  const themes = dialog.getByRole('group', { name: "Thema's" })
  await themes.locator('button[aria-pressed="false"]').first().click()
  await dialog.getByRole('button', { name: 'Opslaan' }).click()
  const moved = page.locator('.plan-day').nth(1).locator('.plan-block.slot-avond')
  await expect(moved).toContainText('Nephaven')
  await expect(moved.locator('.plan-themes li')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)

  // Snel schuiven tijdens de week: één tik een dag later, met ongedaan maken.
  await moved.getByRole('button', { name: /een dag later$/ }).click()
  await expect(page.locator('.toast')).toContainText('Blok verplaatst')
  await expect(page.locator('.plan-day').nth(2).locator('.plan-block.slot-avond')).toContainText('Nephaven')
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.locator('.plan-day').nth(1).locator('.plan-block.slot-avond')).toContainText('Nephaven')

  // Tonen aan studenten: alleen de planning, terug met één knop.
  await page.getByRole('button', { name: 'Toon aan studenten' }).click()
  const presentation = page.locator('.presentation')
  await expect(presentation).toBeVisible()
  await expect(presentation).not.toContainText('Nepanna')
  await expect(presentation).toContainText('Nepweek zeilschool')
  await expect(page.locator('.bottom-bar')).toBeHidden()
  await page.getByRole('button', { name: 'Terug', exact: true }).click()
  await expect(presentation).toHaveCount(0)
  await expect(page.locator('.bottom-bar')).toBeVisible()

  // Delen als tekst in het Engels.
  await page.getByRole('button', { name: 'Delen', exact: true }).click()
  await page.getByRole('radio', { name: 'Engels' }).click()
  await page.getByRole('button', { name: 'Tekst delen' }).click()
  const shared = await page.evaluate(() => window.__shared)
  expect(shared?.text).toContain('Nepweek zeilschool')
  expect(shared?.text).toContain('Morning · Groep A')
  expect(shared?.text).toContain('Nephaven')
  expect(shared?.text).not.toContain('Nepanna')
  expect(shared?.text).not.toContain('Ochtend')

  // PDF via afdrukken: alleen de planning in de printweergave.
  await page.getByRole('button', { name: 'Delen', exact: true }).click()
  await page.getByRole('radio', { name: 'Engels' }).click()
  await page.getByRole('button', { name: 'PDF via afdrukken' }).click()
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-root')).toBeVisible()
  await expect(page.locator('.print-root')).toContainText('Afternoon')
  await expect(page.locator('#root')).toBeHidden()
  await page.screenshot({ path: 'screenshots/print-planning.png', fullPage: true })
  await page.emulateMedia({ media: 'screen' })

  // Vandaag: planning van vandaag, afvinken kan daar ook.
  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  const card = page.getByRole('region', { name: 'Planning vandaag' })
  await expect(card).toContainText('Nepweek zeilschool')
  await expect(card).toContainText('Middag')
  await expectNoHorizontalOverflow(page)
  const todayOpen = card.getByRole('button', { name: /tik om af te vinken voor de hele groep/ }).first()
  await todayOpen.click()
  await expect(page.locator('.toast')).toContainText('Geoefend voor 1 student')
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(card.getByRole('button', { name: /tik om af te vinken/ }).first()).toBeVisible()

  // Deze week toont de planning bij de week.
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.getByRole('button', { name: /Nepweek zeilschool/ })).toBeVisible()

  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepanna', 'Nephaven', 'Nepweek']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
