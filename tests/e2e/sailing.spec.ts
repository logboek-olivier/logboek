import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

const fixture = new URL('../fixtures/mijlen-nep.csv', import.meta.url)

test('importeert de mijlenregistratie met controle-overzicht en toont tochten en dagen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Zeilen' }).click()
  await expect(page.getByRole('heading', { name: 'Zeilen' })).toBeVisible()
  await page.getByLabel('CSV-bestand').setInputFiles(fixture.pathname.replace(/^\/([A-Za-z]:)/, '$1'))

  await expect(page.getByRole('heading', { name: 'Controle import' })).toBeVisible()
  const grid = page.locator('.grid')
  await expect(grid).toContainText('240 nm')
  await expect(grid).toContainText('Dagen8')
  await expect(grid).toContainText('Tochten3')
  await expect(grid).toContainText('12 u')
  await expect(grid).toContainText('Schipper70 nm')
  await expect(grid).toContainText('Getijdenwater110 nm')
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Opslaan' }).click()
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
  await page.getByLabel('CSV-bestand').setInputFiles(fixture.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.card')).toHaveCount(3)
  await expect(page.locator('.grid')).toContainText('Dagen8')
  expect(errors).toEqual([])
})
