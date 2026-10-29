import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore } from './helpers/logbook'

// PR C: een pin koppelen of vervangen gebeurt nooit stil. Een plaats in Engeland op de kaart van het Caribisch gebied
// geeft eerst de vraag; een bestaande pin verplaatsen ook. Verzonnen gegevens.

test.use({ viewport: { width: 360, height: 800 } })

const CSV = [
  'Datum;Van (plaats);Van (land);Naar (plaats);Naar (land);Rol;Schip;Schipper/trainer;Co-schipper (flot.leider);Wind (bft);Binnenwater;Zee;Zee (getijnavigatie);Totaal;Nacht-uren;Bijzonderheden',
  '01-06-2025;Nephaven;Engeland;Shamrock Nepquay;Engeland;Schipper;Nepboot;;;3;;12;;12;;Nepweek Solent',
].join('\r\n')

async function tapMap(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByRole('dialog').locator('.sea-map-canvas')
  await expect(page.getByRole('dialog').locator('.map-land').first()).toBeAttached({ timeout: 15_000 })
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width * x, y: box.height * y } })
}

test('pin ver van het land van de plaats: eerst de vraag; een bestaande pin verplaatsen ook', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await openLogbook(page)
  await page.getByLabel('Mijlenbestand').setInputFiles({ name: 'mijlen.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') })
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await page.getByRole('button', { name: 'Overslaan', exact: true }).click()

  await openMore(page, 'Plaatsen')
  await page.getByRole('button', { name: 'Plaats bewerken: Shamrock Nepquay' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Op de kaart zetten' }).click()
  // De kaart begint zonder punten in het Caribisch gebied: ver van Engeland.
  await tapMap(page, 0.5, 0.5)
  const question = page.locator('.pin-question')
  await expect(question).toContainText('Dit ligt ver van Engeland. Klopt de plaats?')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/bewerken/pin-ver.png' })
  await question.getByRole('button', { name: 'Andere plaats kiezen' }).click()
  await expect(question).toHaveCount(0)
  await expect(page.locator('.row-value.pinned')).toHaveCount(0)
  // Toch hier: dan wel (bewust gekozen).
  await tapMap(page, 0.5, 0.5)
  await page.locator('.pin-question').getByRole('button', { name: 'Toch hier' }).click()
  await expect(page.getByText(/Shamrock Nepquay staat op de kaart/)).toBeVisible()

  // De pin verplaatsen: eerst "Pin van … verplaatsen?" met oud en nieuw.
  await page.getByRole('button', { name: 'Plaats bewerken: Shamrock Nepquay' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pin verplaatsen' }).click()
  await tapMap(page, 0.25, 0.25)
  const move = page.locator('.pin-question')
  await expect(move).toContainText('Pin van Shamrock Nepquay verplaatsen?')
  await expect(move).toContainText(/Oud: .*° N · .*° W/)
  await expect(move).toContainText(/Nieuw: .*° N · .*° W/)
  // Nieuwe plaats maken: de oude pin blijft staan, er komt een plaats bij.
  await move.getByRole('button', { name: 'Nieuwe plaats maken' }).click()
  await move.getByLabel('Naam van de nieuwe plaats').fill('Shamrock Nepquay')
  await expect(move).toContainText('Die naam bestaat al')
  await move.getByLabel('Naam van de nieuwe plaats').fill('Nepankerplek')
  await move.getByRole('button', { name: 'Nieuwe plaats maken' }).click()
  await expect(page.getByText(/Nepankerplek staat op de kaart/)).toBeVisible()
  await expect(page.locator('.row-value.pinned')).toHaveCount(2)
  expect(errors).toEqual([])
})
