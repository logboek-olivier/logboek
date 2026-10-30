import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openMore } from './helpers/logbook'

// Dagelijkse herinnering (ronde 2, PR 6): Instellingen → Herinnering, tijd kiezen (standaard 20:00), "Zet in agenda"
// maakt een .ics met "Logboek: log je dag" en een link naar de app; elke dag, of alleen op de werkdagen van de planning.
// De keuze wordt onthouden (versleuteld in de instellingen). Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

test('herinnering: elke dag om een gekozen tijd, of alleen op werkdagen; met link naar de app', async ({ page }) => {
  test.setTimeout(90_000)
  // Donderdag 29 oktober 2026; de tijd loopt door.
  await page.clock.setSystemTime(new Date('2026-10-29T10:00:00'))
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: /^Herinnering/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByLabel('Tijd')).toHaveValue('20:00')
  // Zonder werkdagen in de agenda kan "Alleen op werkdagen" nog niet.
  await expect(sheet.getByRole('radio', { name: 'Alleen op werkdagen' })).toBeDisabled()
  await sheet.getByLabel('Tijd').fill('07:30')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/instellingen/herinnering.png' })
  let download = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Zet in agenda' }).click()
  let file = await download
  expect(file.suggestedFilename()).toBe('logboek-herinnering.ics')
  let ics = (await readFile((await file.path())!, 'utf8')).replace(/\r\n /g, '')
  expect(ics).toContain('SUMMARY:Logboek: log je dag')
  expect(ics).toContain('DTSTART:20261029T073000')
  expect(ics).toContain('RRULE:FREQ=DAILY')
  // De link gaat naar de site waarop de app draait (bij Olivier logboek-olivier.github.io, bij een vriend zijn eigen site).
  expect(ics).toContain(`URL:${new URL(page.url()).origin}/logboek/?toevoegen=dag`)
  await expect(page.getByText('Herinnering gemaakt')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Herinnering/ })).toContainText('07:30 · Elke dag')

  // Een trip van 2 tot en met 6 november: alleen op die werkdagen.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const trip = page.getByRole('dialog')
  await trip.getByLabel('Naam', { exact: true }).fill('Nepweek november')
  await trip.getByLabel('Startdatum').fill('2026-11-02')
  await trip.getByLabel('Aantal dagen').fill('5')
  await fillBoat(trip)
  await trip.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: /^Herinnering/ }).click()
  await expect(sheet.getByLabel('Tijd')).toHaveValue('07:30')
  await sheet.getByRole('radio', { name: 'Alleen op werkdagen' }).click()
  await expect(sheet).toContainText('5 werkdagen uit de agenda, tot en met')
  download = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Zet in agenda' }).click()
  file = await download
  ics = (await readFile((await file.path())!, 'utf8')).replace(/\r\n /g, '')
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5)
  for (const d of ['20261102', '20261103', '20261104', '20261105', '20261106']) expect(ics).toContain(`DTSTART:${d}T073000`)
  expect(ics).not.toContain('RRULE')
  await expect(page.getByRole('button', { name: /^Herinnering/ })).toContainText('07:30 · Alleen op werkdagen')

  // Onthouden in de instellingen, versleuteld naar GitHub (de tijd staat nergens leesbaar in een verzoek).
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  expect(github.files.has('settings.json.enc')).toBe(true)
  expect(github.requests.some((r) => /07:30|log je dag/.test(r.body ?? ''))).toBe(false)
  expect(errors).toEqual([])
})
