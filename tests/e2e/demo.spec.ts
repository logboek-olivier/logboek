import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openMore } from './helpers/logbook'

// PR F: demomodus. Harde regels: tijdens de demo gaat er geen enkel verzoek naar GitHub (ook niet na een wijziging in de
// demo), de eigen lokale data wordt niet aangeraakt, en uitzetten brengt de eigen data en taal direct terug.

test.use({ viewport: { width: 360, height: 800 } })

test('demomodus: voorbeelddata in het Engels, nooit een verzoek naar GitHub, stoppen brengt de eigen data en taal terug', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  // Eigen gegevens: een lopende trip.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill('Nepweek eigen')
  await fillBoat(sheet)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  const taal = await page.evaluate(() => localStorage.getItem('logboek-taal'))

  // Demo starten (Instellingen → Demomodus). Vanaf de tik geen enkel verzoek meer naar GitHub.
  await openMore(page, 'Instellingen')
  const requestsAtStart = github.requests.length
  await page.getByRole('button', { name: 'Demomodus starten' }).click()
  await expect(page.locator('.demo-bar')).toContainText('Demo · sample data')
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page.locator('.today-trip')).toContainText('BVI')
  await expect(page.locator('.today-trip')).toContainText('Blue Heron')
  await expect(page.locator('main')).not.toContainText('Nepweek eigen')
  await expect(page.locator('main')).not.toContainText('€')
  await expect(page.getByRole('status').first()).toHaveText('Demo · nothing is synced')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/demo/today.png', fullPage: true })

  // Rondkijken: deze trip met studenten, logboek, statistieken, agenda.
  await page.getByRole('navigation').getByRole('button', { name: 'This trip', exact: true }).click()
  await expect(page.locator('.student').first()).toBeVisible()
  await page.screenshot({ path: 'screenshots/demo/this-trip.png', fullPage: true })
  await openMore(page, 'Logbook', 'More')
  await expect(page.locator('.trip-card')).toHaveCount(3)
  await page.screenshot({ path: 'screenshots/demo/logbook.png', fullPage: true })
  await openMore(page, 'Statistics', 'More')
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: 'More', exact: true }).click()
  // Onder Meer geen Opslag in de demo; Instellingen zonder de eigen sleutels en token.
  await expect(page.getByRole('button', { name: /^Storage/ })).toHaveCount(0)
  await page.getByRole('button', { name: /^Settings/ }).click()
  await expect(page.getByRole('button', { name: /Change passphrase/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Replace token/ })).toHaveCount(0)

  // Een andere taal kiezen in de demo verandert de eigen taalkeuze niet.
  await page.getByRole('button', { name: 'Language' }).click()
  await page.getByRole('radio', { name: 'Nederlands' }).click()
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible()
  await page.getByRole('radio', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('logboek-taal'))).toBe(taal)

  // Herladen tijdens de demo (een nieuwe versie, omlaag trekken): de demo start opnieuw, nooit het eigen logboek.
  await page.reload()
  await expect(page.locator('.demo-bar')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('main')).not.toContainText('Nepweek eigen')
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.locator('.today-trip')).toContainText('Blue Heron')

  // Een wijziging in de demo: een dag loggen. Ook dan niets naar GitHub.
  await page.getByRole('navigation').getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('To', { exact: true }).fill('Norman Island')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.waitForTimeout(2_000)
  expect(github.requests.length).toBe(requestsAtStart)

  // Stoppen: direct de eigen gegevens en taal terug; de taalkeuze van dit apparaat is niet veranderd.
  await page.locator('.demo-bar').getByRole('button', { name: 'Stop demo' }).click()
  await expect(page.locator('.demo-bar')).toHaveCount(0)
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.locator('.today-trip')).toContainText('Nepweek eigen')
  await expect(page.locator('main')).not.toContainText('Blue Heron')
  expect(await page.evaluate(() => localStorage.getItem('logboek-taal'))).toBe(taal)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  // Niets van de demo is ooit bij GitHub gekomen (ook niet versleuteld: geen nieuw bestand, geen extra dag).
  await openMore(page, 'Logboek')
  await expect(page.locator('main')).not.toContainText('Norman Island')
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  for (const word of ['Norman', 'Blue Heron', 'Nepweek']) expect(wire).not.toContain(word)
  expect(errors).toEqual([])
})
