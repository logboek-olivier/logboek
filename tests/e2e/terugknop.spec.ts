import { expect, test, type Page } from '@playwright/test'
import { translate, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// De terugknop en het terugveeggebaar van Android (via de geschiedenis-API, zoals de browser ze doorgeeft): altijd één
// stap terug in de app (onderblad → scherm → vorig tabblad); alleen op Vandaag zonder blad eerst "Nog een keer terug om
// te sluiten", en pas daarna verlaat de app. Sluiten in de app zelf (kruisje, tabblad) laat geen loze stap achter.

const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: 'nl', k: MessageKey, ...a: unknown[]) => string)('nl', key, ...args)

test.use({ viewport: { width: 360, height: 800 } })

function title(page: Page) {
  return page.locator('main h1').first()
}

async function tab(page: Page, key: MessageKey): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: L(key), exact: true }).click()
}

async function back(page: Page): Promise<void> {
  await page.goBack()
}

test('terugknop: een stap terug in de app, op Vandaag eerst de melding, nooit onverwacht sluiten', async ({ page }) => {
  test.setTimeout(120_000)
  await mockGithub(page)
  await createNewLogbook(page)
  const hint = page.getByText(L('back.again'))
  const app = page.url()
  await expect(title(page)).toHaveText(L('nav.today'))

  // Onderblad: terug sluit het blad, Vandaag blijft.
  await page.getByRole('button', { name: L('reminder.new') }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await back(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(title(page)).toHaveText(L('nav.today'))
  await expect(hint).toHaveCount(0)

  // Scherm onder Meer: terug naar Meer, dan naar Vandaag.
  await openMore(page, L('nav.storage'))
  await expect(title(page)).toHaveText(L('nav.storage'))
  await back(page)
  await expect(title(page)).toHaveText(L('nav.more'))
  await back(page)
  await expect(title(page)).toHaveText(L('nav.today'))
  await expect(hint).toHaveCount(0)

  // Tabbladen: terug naar het vorige tabblad.
  await tab(page, 'nav.calendar')
  await tab(page, 'nav.week')
  await expect(title(page)).toHaveText(L('nav.week'))
  await back(page)
  await expect(title(page)).toHaveText(L('nav.calendar'))
  await back(page)
  await expect(title(page)).toHaveText(L('nav.today'))

  // Een scherm in een scherm (een cursus) met een blad erboven: blad, cursus, Cursussen, Meer, Vandaag.
  await openMore(page, L('curriculum.courses'))
  await page.getByRole('button', { name: /ASA 101/ }).click()
  await expect(title(page)).toContainText('ASA 101')
  await page.getByRole('button', { name: L('common.edit'), exact: true }).click()
  await page.getByRole('button', { name: L('curriculum.courseDetails') }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await back(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(title(page)).toContainText('ASA 101')
  await back(page)
  await expect(title(page)).toHaveText(L('curriculum.courses'))
  await back(page)
  await expect(title(page)).toHaveText(L('nav.more'))
  await back(page)
  await expect(title(page)).toHaveText(L('nav.today'))
  await expect(hint).toHaveCount(0)

  // Sluiten in de app zelf (het kruisje, een tabblad) laat geen loze stap achter: daarna is terug op Vandaag meteen de
  // melding, niet een terug die niets doet.
  await page.getByRole('button', { name: L('reminder.new') }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await tab(page, 'nav.calendar')
  await tab(page, 'nav.more')
  await tab(page, 'nav.today')
  await expect(title(page)).toHaveText(L('nav.today'))

  // Op Vandaag zonder blad: eerst de melding, de app blijft open.
  await back(page)
  await expect(hint).toBeVisible()
  expect(page.url()).toBe(app)
  await expect(title(page)).toHaveText(L('nav.today'))
  await expectNoHorizontalOverflow(page)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.screenshot({ path: `screenshots/terugknop/vandaag-360-${scheme}-nl.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })

  // Een tik zet de bewaker terug: terug geeft weer eerst de melding.
  await title(page).click()
  await expect(hint).toHaveCount(0)
  await back(page)
  await expect(hint).toBeVisible()
  expect(page.url()).toBe(app)

  // Pas nog een keer terug verlaat de app.
  await back(page)
  await expect.poll(() => page.url()).not.toBe(app)
})
