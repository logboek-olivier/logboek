import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

const fixturePath = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const fixture = { pathname: fixturePath('mijlen-nep.csv') }

test('importeert de mijlenregistratie met controle-overzicht en toont tochten en dagen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Zeilen' }).click()
  await expect(page.getByRole('heading', { name: 'Zeilen' })).toBeVisible()
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture.pathname)

  await expect(page.getByRole('heading', { name: 'Controle import' })).toBeVisible()
  const grid = page.locator('.grid')
  await expect(grid).toContainText('240 nm')
  await expect(grid).toContainText('Dagen8')
  await expect(grid).toContainText('Tochten3')
  await expect(grid).toContainText('12 u')
  await expect(grid).toContainText('Schipper70 nm')
  await expect(grid).toContainText('Getijdenwater110 nm')
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Importeren' }).click()
  await expect(page.getByRole('heading', { name: 'Zeilen' })).toBeVisible()
  const trips = page.locator('.card')
  await expect(trips).toHaveCount(3)
  await expect(trips.first()).toContainText('Cursus binnenwater')
  await trips.first().getByRole('button').click()
  await expect(trips.first().locator('.leg')).toHaveCount(2)
  await expect(trips.first()).toContainText('Meerdorp → Rietmeer')
  await expectNoHorizontalOverflow(page)

  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Meerdorp')
  expect(wire).not.toContain('Cursus')

  // Opnieuw importeren dubbelt niet.
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture.pathname)
  await page.getByRole('button', { name: 'Importeren' }).click()
  await expect(page.locator('.card')).toHaveCount(3)
  await expect(page.locator('.grid')).toContainText('Dagen8')
  expect(errors).toEqual([])
})

/** Zoals Android: de bestandskiezer opent als aparte app, het logboek wordt verborgen en daarna weer zichtbaar. */
async function setVisibility(page: import('@playwright/test').Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

test('Excel-bestand via de bestandskiezer: verbergen tijdens het kiezen vergrendelt niet, voorbeeld, Annuleren en Importeren', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Zeilen' }).click()

  // Geen accept-filter: Android en Google Drive grijzen anders bestanden uit.
  await expect(page.getByLabel('Mijlenbestand')).not.toHaveAttribute('accept')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Importeren' }).click()
  await setVisibility(page, 'hidden')
  await setVisibility(page, 'visible')
  await (await chooser).setFiles(fixturePath('mijlen-nep.xlsx'))

  await expect(page.getByRole('heading', { name: 'Controle import' })).toBeVisible()
  const grid = page.locator('.grid')
  await expect(grid).toContainText('Dagen8')
  await expect(grid).toContainText('Tochten3')
  await expect(grid).toContainText('Co-schipper110 nm')
  await expect(grid).toContainText('Zee95 nm')
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Annuleren' }).click()
  await expect(page.locator('.card')).toHaveCount(0)

  await page.getByLabel('Mijlenbestand').setInputFiles(fixturePath('mijlen-nep.xlsx'))
  await page.getByRole('button', { name: 'Importeren' }).click()
  await expect(page.locator('.card')).toHaveCount(3)

  // Buiten de bestandskiezer vergrendelt verbergen nog steeds.
  await setVisibility(page, 'hidden')
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
  expect(errors).toEqual([])
})

test('een onleesbaar bestand geeft een melding in gewone taal', async ({ page }) => {
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Zeilen' }).click()
  await page.getByLabel('Mijlenbestand').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) })
  await expect(page.getByRole('alert')).toHaveText('Dit is geen CSV- of Excel-bestand.')
  await page
    .getByLabel('Mijlenbestand')
    .setInputFiles({ name: 'mijlen.csv', mimeType: 'text/csv', buffer: Buffer.from('Datum;Rol\n1-1-2024;Kapitein') })
  await expect(page.getByRole('alert')).toContainText('kolom "Van (plaats)" ontbreekt')
})
