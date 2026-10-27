import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 } })

test('Termijnen: deadline en vervaldatum in een paar tikken, eerstvolgende op Vandaag, afronden met ongedaan maken', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  const section = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Termijnen' }) })

  // Deadline: vliegticket boeken, uiterlijk over 3 weken (de standaardkeuze).
  await section.getByRole('button', { name: 'Termijn toevoegen' }).click()
  let sheet = page.getByRole('dialog')
  await sheet.getByLabel('Wat').fill('Nepticket boeken')
  await expect(sheet.getByRole('button', { name: 'Over 3 weken' })).toHaveAttribute('aria-pressed', 'true')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/termijn.png', fullPage: true })
  await sheet.getByRole('button', { name: 'Opslaan' }).click()

  // Vervaldatum: pinpas over een jaar.
  await section.getByRole('button', { name: 'Termijn toevoegen' }).click()
  sheet = page.getByRole('dialog')
  await sheet.getByLabel('Wat').fill('Neppas')
  await sheet.getByRole('radio', { name: 'Vervaldatum' }).click()
  await sheet.getByRole('button', { name: 'Over 1 jaar' }).click()
  await sheet.getByRole('button', { name: 'Opslaan' }).click()

  const rows = section.locator('.due-list li')
  await expect(rows.first()).toContainText('Nepticket boeken')
  await expect(rows.first()).toContainText('over 21 dagen')
  await expect(section).toContainText('Neppas')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/vandaag-termijnen.png', fullPage: true })

  // Afronden, ongedaan maken, en weer afronden.
  await rows.first().getByRole('button').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Afronden' }).click()
  await expect(section).not.toContainText('Nepticket boeken')
  await page.locator('.toast').getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(section).toContainText('Nepticket boeken')
  await section.locator('.due-list li').filter({ hasText: 'Nepticket boeken' }).getByRole('button').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Afronden' }).click()

  // Meer → Termijnen: open en afgerond.
  await openMore(page, 'Termijnen')
  await expect(page.getByRole('heading', { name: 'Termijnen', level: 1 })).toBeVisible()
  await expect(page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Afgerond' }) })).toContainText('Nepticket boeken')

  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepticket', 'Neppas']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
