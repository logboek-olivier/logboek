import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Meer → Checklists op 360 px: alle lijsten op één plek; een eigen lijst maken, een punt naar boven slepen (en met de
// pijltjestoetsen verplaatsen), opslaan, verwijderen met ongedaan maken; een meegeleverde lijst verbergen en
// terugzetten. Alle teksten zijn verzonnen.

test.use({ locale: 'nl-NL', viewport: { width: 360, height: 800 } })

async function shots(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/checklists/${name}-360-${scheme}-nl.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

/** Sleept met een echte vinger (Chrome DevTools-protocol) het handvat van punt `from` naar de bovenkant van punt `to`. */
async function drag(sheet: Locator, from: number, to: number) {
  const page = sheet.page()
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id, radiusX: 2, radiusY: 2, force: 1 })) })
  const a = (await sheet.getByRole('button', { name: `Punt ${from} verplaatsen` }).boundingBox())!
  const b = (await sheet.getByLabel(`Punt ${to}`, { exact: true }).boundingBox())!
  const x = a.x + a.width / 2
  const y0 = a.y + a.height / 2
  const y1 = b.y + 4
  await touch('touchStart', [{ x, y: y0 }])
  for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x, y: y0 + ((y1 - y0) * i) / 10 }])
  await touch('touchEnd', [])
  await cdp.detach()
}

test('checklists: eigen lijst maken, slepen, opslaan, verwijderen; meegeleverde verbergen en terugzetten', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await openMore(page, 'Checklists')
  await expect(page.getByRole('heading', { name: 'Checklists', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Safety briefing gasten/ })).toBeVisible()
  await shots(page, 'lijst')

  // Nieuwe lijst: het bewerkscherm opent meteen.
  await page.getByRole('button', { name: 'Nieuwe checklist' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Checklist bewerken')
  await sheet.getByLabel('Naam van de lijst').fill('Neplijst vertrek')
  await sheet.getByRole('button', { name: 'Delivery' }).click()
  await sheet.getByLabel('Punt 1', { exact: true }).fill('Nep A')
  await sheet.getByLabel('Punt 2', { exact: true }).fill('Nep B')
  await sheet.getByLabel('Punt 3', { exact: true }).fill('Nep C')
  await sheet.getByLabel('Punt 4', { exact: true }).fill('Nep D')
  const values = () => sheet.locator('.checklist-row input').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))

  // Nep D bovenaan slepen.
  await drag(sheet, 4, 1)
  await expect.poll(values).toEqual(['Nep D', 'Nep A', 'Nep B', 'Nep C', ''])
  // Met het toetsenbord: Nep A (nu punt 2) één omlaag.
  await sheet.getByRole('button', { name: 'Punt 2 verplaatsen' }).press('ArrowDown')
  await expect.poll(values).toEqual(['Nep D', 'Nep B', 'Nep A', 'Nep C', ''])
  await expect(sheet.getByRole('button', { name: 'Punt 3 verplaatsen' })).toBeFocused()
  await shots(page, 'bewerken')
  await sheet.getByRole('button', { name: 'Opslaan' }).click()

  // Bekijken: de punten op de nieuwe volgorde, bij delivery.
  await expect(sheet.locator('.checklist-preview li')).toHaveText(['Nep D', 'Nep B', 'Nep A', 'Nep C'])
  await expect(sheet).toContainText('Delivery')
  await sheet.getByRole('button', { name: 'Sluiten' }).click()
  const own = page.getByRole('button', { name: /Neplijst vertrek/ })
  await expect(own).toContainText('4 punten')

  // Verwijderen (in het bewerkscherm, eigen rij), met ongedaan maken.
  await own.click()
  await sheet.getByRole('button', { name: 'Bewerken', exact: true }).click()
  await sheet.getByRole('button', { name: 'Lijst verwijderen' }).click()
  await expect(own).toHaveCount(0)
  await page.getByRole('button', { name: 'Ongedaan maken' }).click()
  await expect(own).toBeVisible()

  // Een meegeleverde lijst verbergen en terugzetten.
  await page.getByRole('button', { name: /Safety briefing gasten/ }).click()
  await sheet.getByRole('button', { name: 'Bewerken', exact: true }).click()
  await sheet.getByRole('button', { name: 'Lijst verwijderen' }).click()
  await expect(page.getByRole('button', { name: /Safety briefing gasten/ })).toHaveCount(0)
  const hidden = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Verborgen lijsten' }) })
  await expect(hidden).toContainText('Safety briefing gasten')
  await hidden.getByRole('button', { name: 'Terugzetten' }).click()
  await expect(page.getByRole('button', { name: /Safety briefing gasten/ })).toBeVisible()
  await expect(hidden).toHaveCount(0)
  expect(errors).toEqual([])
})
