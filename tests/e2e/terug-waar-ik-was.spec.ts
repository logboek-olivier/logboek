import { expect, test, type Page } from '@playwright/test'
import { translate } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, openMore } from './helpers/logbook'

// Na opslaan, bewerken, verwijderen, toevoegen of annuleren kom je terug waar je vandaan kwam (CLAUDE.md, Schermen).
// Toevoegen ligt als laag over het scherm: dat scherm, met een open dagkaart of tripoverzicht, blijft staan. Per route
// controleert de test waar je uitkomt, ook met de terugknop van Android. Alle gegevens verzonnen.

const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: 'nl', k: string, p?: unknown) => string)('nl', key, params)

test.use({ locale: 'nl-NL', viewport: { width: 360, height: 800 } })

async function setUp(page: Page) {
  // Maandag 15 maart 2027, na de trip (een dag in de toekomst loggen kan niet). De tijd loopt door.
  await page.clock.setSystemTime(new Date('2027-03-15T10:00:00'))
  await mockGithub(page)
  await createNewLogbook(page, 'nl')
  await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
  const nav = page.getByRole('navigation')
  const sheet = page.getByRole('dialog')
  // Een trip van 6 tot en met 13 maart, via periode markeren.
  await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
  await page.getByRole('button', { name: L('calendar.markPeriod') }).click()
  await day(page, 6).click()
  await day(page, 13).click()
  await sheet.getByRole('button', { name: L('dayType.werk') }).click()
  await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Terug')
  await sheet.getByRole('button', { name: L('week.start') }).click()
  await expect(page.locator('.cal-bar', { hasText: 'Nepweek Terug' }).first()).toBeVisible()
  return { nav, sheet }
}

const day = (page: Page, n: number) => page.locator('.cal-day:not(.other-month)').nth(n - 1)

/** Het tripoverzicht vanuit de agenda: de dagkaart van 7 maart, dan de trip. */
async function openTrip(page: Page) {
  await day(page, 7).click()
  await page.getByRole('dialog').locator('.day-view-trip', { hasText: 'Nepweek Terug' }).click()
  await expect(page.getByRole('dialog')).toContainText(L('trip.addDay'))
}
const layer = (page: Page) => page.locator('.add-layer')

/** Toevoegen → Dag opslaan (de laag gaat dicht). */
async function saveDay(page: Page, to: string) {
  await expect(layer(page)).toBeVisible()
  await layer(page).getByLabel(L('field.to'), { exact: true }).fill(to)
  await layer(page).getByRole('button', { name: L('common.save') }).click()
  await expect(layer(page)).toHaveCount(0)
}

test('toevoegen: na opslaan of terug op het scherm (met het open blad) waar je was', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  const { nav, sheet } = await setUp(page)

  // Vandaag → + → opslaan: Vandaag.
  await nav.getByRole('button', { name: L('nav.today'), exact: true }).click()
  await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
  await saveDay(page, 'Nepbaai')
  await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()

  // Deze trip → Dag toevoegen → opslaan: Deze trip.
  await nav.getByRole('button', { name: L('nav.week'), exact: true }).click()
  await page.getByRole('button', { name: L('trip.addDay') }).click()
  await saveDay(page, 'Nepdorp')
  await expect(page.getByRole('heading', { name: L('nav.week') })).toBeVisible()

  // Agenda → dagkaart → Dag loggen → opslaan: de dagkaart staat er nog.
  await nav.getByRole('button', { name: L('nav.calendar'), exact: true }).click()
  await day(page, 10).click()
  await sheet.getByRole('button', { name: L('day.log') }).click()
  await saveDay(page, 'Nephaven')
  await expect(sheet).toBeVisible()
  await expect(page.getByRole('heading', { name: L('nav.calendar'), exact: true })).toBeAttached()
  await sheet.getByRole('button', { name: L('common.close') }).click()

  // Agenda → tripoverzicht → Dag toevoegen → opslaan: het tripoverzicht staat er nog.
  await openTrip(page)
  await sheet.getByRole('button', { name: L('trip.addDay') }).click()
  await saveDay(page, 'Nepkaap')
  await expect(sheet).toContainText('Nepweek Terug')

  // Annuleren met de terugknop van Android, en met "‹ Terug": weer het tripoverzicht.
  await sheet.getByRole('button', { name: L('trip.addDay') }).click()
  await expect(layer(page)).toBeVisible()
  await page.goBack()
  await expect(layer(page)).toHaveCount(0)
  await expect(sheet).toContainText('Nepweek Terug')
  await sheet.getByRole('button', { name: L('trip.addDay') }).click()
  await layer(page).getByRole('button', { name: L('common.back') }).click()
  await expect(layer(page)).toHaveCount(0)
  await expect(sheet).toContainText('Nepweek Terug')
  // Terug sluit het tripoverzicht: de agenda.
  await page.goBack()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByRole('heading', { name: L('nav.calendar'), exact: true })).toBeVisible()

  // Meer → Periodes → tripoverzicht → Dag toevoegen → opslaan: het tripoverzicht in Periodes.
  await openMore(page, L('periods.title'), L('nav.more'))
  // Afgelopen periodes staan per maand ingeklapt.
  await page.locator('summary', { hasText: 'maart 2027' }).click()
  await page.locator('.period-row', { hasText: 'Nepweek Terug' }).click()
  await sheet.getByRole('button', { name: L('trip.addDay') }).click()
  await saveDay(page, 'Nepeiland')
  await expect(sheet).toContainText('Nepweek Terug')
  await sheet.getByRole('button', { name: L('common.close') }).click()
  await expect(page.getByRole('heading', { name: L('periods.title') })).toBeVisible()

  // Meer → Geld → + Inkomsten → opslaan: Geld.
  await openMore(page, L('nav.money'), L('nav.more'))
  await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
  await layer(page).getByRole('tab', { name: L('quick.tabIncome') }).click()
  await layer(page).getByLabel(L('field.amount')).fill('25')
  await layer(page).getByRole('button', { name: L('common.save') }).click()
  await expect(layer(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: L('nav.money') })).toBeVisible()
  expect(errors).toEqual([])
})

test('bewerken, verwijderen, prullenbak en geschiedenis: je blijft waar je was; terug gaat één stap terug', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  const { nav, sheet } = await setUp(page)
  // Twee dagen in de trip.
  await openTrip(page)
  await sheet.getByRole('button', { name: L('trip.addDay') }).click()
  await saveDay(page, 'Nepbaai')
  await sheet.getByRole('button', { name: L('trip.addDay') }).click()
  await saveDay(page, 'Nepdorp')
  const legs = sheet.locator('.leg-button')
  await expect(legs).toHaveCount(2)

  // Een dag bewerken en opslaan: terug in het tripoverzicht.
  await legs.first().click()
  await page.getByRole('dialog').last().getByRole('button', { name: L('common.edit') }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: L('common.save') }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(sheet).toContainText('Nepweek Terug')

  // Een dag verwijderen: terug in het tripoverzicht, met één dag minder.
  await legs.first().click()
  await page.getByRole('dialog').last().getByRole('button', { name: L('common.edit') }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: L('common.delete') }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(sheet.locator('.leg-button')).toHaveCount(1)
  await sheet.getByRole('button', { name: L('common.close') }).click()
  await expect(page.getByRole('heading', { name: L('nav.calendar'), exact: true })).toBeVisible()

  // Prullenbak: terugzetten, en je blijft in de prullenbak.
  await openMore(page, L('trash.title'), L('nav.more'))
  await page.locator('.settings-row').first().click()
  await sheet.getByRole('button', { name: L('trash.restore') }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByRole('heading', { name: L('trash.title') })).toBeVisible()

  // Geschiedenis: terugzetten, en je blijft in de geschiedenis.
  await nav.getByRole('button', { name: L('nav.more'), exact: true }).click()
  await page.getByRole('button', { name: new RegExp(`^${L('history.title')}`) }).click()
  await page.getByRole('button', { name: L('history.revert') }).first().click()
  await expect(page.getByRole('heading', { name: L('history.title') })).toBeVisible()

  // Terug (Android): één stap terug, naar Meer.
  await page.goBack()
  await expect(page.getByRole('heading', { name: L('nav.more'), exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
