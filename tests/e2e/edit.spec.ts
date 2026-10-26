import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

const fixture = new URL('../fixtures/mijlen-nep.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

async function importFixture(page: Page) {
  await page.getByRole('button', { name: 'Zeilen' }).click()
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Importeren' }).click()
  await expect(page.locator('.trip')).toHaveCount(3)
}

test('tocht hernoemen, dag naar een andere tocht verplaatsen, dag verwijderen en ongedaan maken', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await importFixture(page)

  // Tocht (week) hernoemen.
  await page.locator('.trip').filter({ hasText: 'Cursus binnenwater' }).getByRole('button').first().click()
  await page.getByRole('button', { name: 'Week bewerken' }).click()
  await page.getByRole('dialog').getByLabel('Naam', { exact: true }).fill('Cursus op het meer')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.trip').first()).toContainText('Cursus op het meer')

  // Dag naar de tocht "Oefentocht noord" verplaatsen.
  await page.getByRole('button', { name: /Rietmeer → Meerdorp.*Bewerken/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Dag bewerken' })
  await expect(sheet).toContainText('Geïmporteerde dag')
  await sheet.getByLabel('Tocht').selectOption({ label: 'Oefentocht noord' })
  await sheet.getByLabel('Zee (nm)').fill('50')
  await expectNoHorizontalOverflow(page)
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.trip').filter({ hasText: 'Oefentocht noord' })).toContainText('120 nm')
  await expect(page.locator('.trip').filter({ hasText: 'Cursus op het meer' })).toContainText('15 nm')

  // Laatste dag van een tocht verwijderen: tocht verdwijnt, ongedaan maken zet hem terug.
  await page.getByRole('button', { name: /Meerdorp → Rietmeer.*Bewerken/ }).click()
  await page.getByRole('button', { name: 'Verwijderen' }).click()
  await expect(page.locator('.trip')).toHaveCount(2)
  await page.getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(page.locator('.trip')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('Vandaag: jaardoel instellen met voortgang, en omlaag trekken synchroniseert', async ({ page }) => {
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('250')
  await page.getByLabel('Boot', { exact: true }).fill('Nepboot')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await expect(page.getByRole('progressbar', { name: 'Voortgang jaardoel' })).toHaveAttribute('aria-valuemax', '2500')
  await expect(page.getByRole('button', { name: /Jaardoel wijzigen/ })).toContainText('10% van 2.500 nm')
  await page.getByRole('button', { name: /Jaardoel wijzigen/ }).click()
  await page.getByRole('dialog').getByLabel('Zeemijlen per kalenderjaar').fill('1000')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Jaardoel wijzigen/ })).toContainText('25% van 1.000 nm')
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  // Omlaag trekken bovenaan Vandaag: een nieuwe sync (nieuwe GET's naar GitHub).
  const before = github.requests.length
  await page.evaluate(() => {
    const target = document.querySelector('.page-header')!
    const touch = (y: number) => new Touch({ identifier: 1, target, clientX: 100, clientY: y })
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(100)] }))
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch(260)] }))
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [] }))
  })
  await expect.poll(() => github.requests.length).toBeGreaterThan(before)
})
