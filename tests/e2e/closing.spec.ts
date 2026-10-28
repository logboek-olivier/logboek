import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openLogbook } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 800 } })

function iso(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('Vaste checklists per trip, sjabloon bewerken; trip afsluiten in een minuut; zeiltijd exporteren als PDF', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')

  // Lopende skipper-charter.
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  let sheet = page.getByRole('dialog')
  await sheet.getByRole('radio', { name: 'Skipper charter' }).click()
  await fillBoat(sheet, 'nl', 'Nepster')
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()

  // Checklists: safety briefing afvinken.
  const lists = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Vaste checklists' }) })
  await expect(lists).toContainText('Safety briefing gasten')
  await expect(lists).toContainText('Check-in charterboot')
  await expect(lists).toContainText('Paklijst skipper charter')
  await lists.getByRole('button', { name: /Safety briefing gasten/ }).click()
  sheet = page.getByRole('dialog')
  const first = sheet.getByRole('checkbox').first()
  await first.click()
  await expect(first).toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('checkbox').nth(1).click()
  await expect(sheet).toContainText('2 van 11 afgevinkt bij deze trip')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/checklist.png', fullPage: true })
  // Sjabloon bewerken: een punt erbij.
  await sheet.getByRole('button', { name: 'Sjabloon bewerken' }).click()
  await sheet.getByLabel('Punt 12').fill('Nep: zwemvesten kinderen')
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(sheet.getByRole('checkbox')).toHaveCount(12)
  await sheet.getByRole('button', { name: 'Sluiten' }).click()
  await expect(lists.getByRole('button', { name: /Safety briefing gasten/ })).toContainText('2/12')

  // Een dag loggen, dan de trip voorbij laten zijn en afsluiten.
  await nav.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Naar', { exact: true }).fill('Nephaven')
  await page.getByLabel('Zeemijlen').fill('24')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.locator('.week-head').click()
  sheet = page.getByRole('dialog')
  await sheet.getByLabel('Startdatum').fill(iso(-10))
  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await page.getByRole('button', { name: 'Trip afronden' }).click()
  sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('24 nm')
  await sheet.getByRole('radio', { name: '9', exact: true }).click()
  await sheet.getByLabel('Wat leerde ik').fill('Nep: eerder reven')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/afsluiten.png', fullPage: true })
  await sheet.getByRole('button', { name: 'Trip afronden' }).click()
  await expect(page.getByText('Trip afgerond')).toBeVisible()

  // Zeiltijd exporteren: per dag en per trip, filter op rol, afdrukken.
  await openLogbook(page)
  await page.getByRole('button', { name: 'Zeiltijd exporteren' }).click()
  const day = page.locator('table.sailtime').first()
  await expect(day).toContainText('Nepster · Nepmodel 40 · 40 ft')
  await expect(day).toContainText('Schipper')
  await expect(page.locator('.total-row')).toContainText('24 nm')
  await page.getByRole('radio', { name: 'Per trip' }).click()
  await expect(page.locator('table.sailtime').first()).toContainText('Nepster')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/trips/zeiltijd.png', fullPage: true })
  await page.getByLabel('Rol').selectOption({ label: 'Trainee' })
  await expect(page.getByText('Geen dagen in deze periode.')).toBeVisible()
  await page.getByLabel('Rol').selectOption({ label: 'Alle rollen' })
  await page.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => {
      ;(window as unknown as { printed: number }).printed++
    }
  })
  await page.getByRole('button', { name: 'Afdrukken of PDF' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await expect(page.locator('.print-root.sailtime-print')).toContainText('Totalen per rol')
  await page.emulateMedia({ media: 'print' })
  await page.screenshot({ path: 'screenshots/trips/zeiltijd-print.png', fullPage: true })
  await page.emulateMedia({ media: 'screen' })

  await nav.getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  for (const secret of ['Nepster', 'eerder reven', 'zwemvesten']) expect(wire).not.toContain(secret)
  expect(errors).toEqual([])
})
