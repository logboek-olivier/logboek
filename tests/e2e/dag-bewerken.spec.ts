import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Drie dagen gelogd, daarna dag 2 een andere bestemming geven. Via Trip bewerken deed Opslaan niets: het blad "Dag
// bewerken" zat in het formulier van de trip en verstuurde dat (door de CSP geblokkeerd). Nu staat elk blad in de
// bladlaag van zijn scherm. Ook: de route van een dag direct wijzigen vanaf de dagkaart in de agenda, en het weeknummer
// van het jaar naast elke rij van de agenda en in de kop van de trip. Op 360 px; alle plaatsen verzonnen.

test.use({ viewport: { width: 360, height: 800 }, locale: 'nl-NL' })

async function shots(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/dag-bewerken/${name}-360-${scheme}-nl.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('dag 2 wijzigen via Trip bewerken en via de dagkaart; weeknummers in de agenda en de tripkop', async ({ page }) => {
  test.setTimeout(120_000)
  // Woensdag 17 februari 2027 (week 7).
  await page.clock.setSystemTime(new Date('2027-02-17T10:00:00'))
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  const nav = page.getByRole('navigation')
  for (const [date, from, to] of [
    ['2027-02-15', 'Nepa', 'Nepb'],
    ['2027-02-16', 'Nepb', 'Nepc'],
    ['2027-02-17', 'Nepc', 'Nepd'],
  ]) {
    await nav.getByRole('button', { name: 'Toevoegen', exact: true }).click()
    await page.getByLabel('Datum', { exact: true }).fill(date!)
    await page.getByLabel('Van', { exact: true }).fill(from!)
    await page.getByLabel('Naar', { exact: true }).fill(to!)
    await page.getByLabel('Zeemijlen').fill('10')
    await page.locator('.add-layer').getByRole('button', { name: /Opslaan/ }).click()
    await expect(page.locator('.add-layer')).toHaveCount(0)
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  }

  // Deze trip: het weeknummer staat in de kop.
  await nav.getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.locator('.trip-head .trip-day-count')).toContainText('Week 7')

  // Via Trip bewerken: dag 2 een andere bestemming. Opslaan sluit "Dag bewerken" en Trip bewerken blijft open.
  await page.locator('.trip-head').getByRole('button', { name: /^Trip bewerken/ }).click()
  const tripSheet = page.getByRole('dialog', { name: 'Trip bewerken' })
  await tripSheet.locator('.leg-row').nth(1).getByRole('button', { name: /wijzigen/ }).click()
  const edit = page.getByRole('dialog', { name: 'Dag bewerken' })
  await edit.getByLabel('Naar (plaats)').fill('Nepx')
  await edit.getByRole('button', { name: 'Opslaan' }).click()
  await expect(edit).toHaveCount(0)
  await expect(tripSheet.locator('.leg-row').nth(1)).toContainText('Nepb → Nepx')
  await tripSheet.getByRole('button', { name: 'Sluiten' }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // De agenda: weeknummers links naast de rijen; februari 2027 begint in week 5.
  await nav.getByRole('button', { name: 'Agenda', exact: true }).click()
  await expect(page.locator('.cal-row .cal-wk').filter({ hasNotText: 'wk' }).first()).toHaveText('5')
  await expect(page.locator('.cal-row .cal-wk', { hasText: /^7$/ })).toHaveCount(1)
  await shots(page, 'agenda-weken')

  // Dagkaart van 16 februari: de route met Route wijzigen, direct naar Dag bewerken.
  await page.locator('.cal-day', { has: page.locator('.cal-num', { hasText: /^16$/ }) }).filter({ hasNot: page.locator('.other-month') }).first().click()
  const day = page.getByRole('dialog')
  await expect(day.locator('.day-legs')).toContainText('Nepb → Nepx')
  await shots(page, 'dagkaart-route')
  await day.getByRole('button', { name: 'Route wijzigen' }).click()
  const fromDay = page.getByRole('dialog', { name: 'Dag bewerken' })
  await fromDay.getByLabel('Naar (plaats)').fill('Nepc')
  await fromDay.getByRole('button', { name: 'Opslaan' }).click()
  await expect(fromDay).toHaveCount(0)
  await expect(page.getByRole('dialog').locator('.day-legs')).toContainText('Nepb → Nepc')
  expect(errors).toEqual([])
})
