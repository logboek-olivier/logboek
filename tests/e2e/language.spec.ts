import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test.describe('telefoon in het Engels', () => {
  test.use({ locale: 'en-GB' })

  test('standaard de taal van de telefoon', async ({ page }) => {
    await mockGithub(page)
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'First time' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New logbook' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})

test('Instellingen → Taal: Engels voor de hele app, met Engelse notatie, en blijft na herladen en vergrendelen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Fooi' }).click()
  await page.getByLabel('Bedrag').fill('1250,5')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: 'Taal' }).click()
  await page.getByRole('radio', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible()

  for (const [tab, heading] of [
    ['Today', 'Today'],
    ['This week', 'This week'],
    ['Logbook', 'Logbook'],
    ['Add', 'Add'],
    ['More', 'More'],
  ] as const) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  }
  // Engelse notatie: € zonder spatie, komma voor duizendtallen.
  await openMore(page, 'Money', 'More')
  await expect(page.getByRole('heading', { name: 'Money', exact: true })).toBeVisible()
  await expect(page.locator('.grid').first()).toContainText('€1,250.50')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await openMore(page, 'Settings', 'More')
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible()
  await expect(page.getByLabel('Passphrase')).toBeVisible()
  expect(errors).toEqual([])
})
