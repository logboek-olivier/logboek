import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openLogbook, openMore } from './helpers/logbook'

// PR B: eerst bekijken, bewerken via het potlood. Tripoverzicht met de route op de kaart (genummerde stops), Logboek
// als kaartjes, de dagkaart in de agenda en de pin-assistent met een voorstel uit de namen op de offline kaart.
// Verzonnen trip en boot; de plaatsnamen (Hvar, Vis) zijn openbare namen op de kaart.

test.use({ viewport: { width: 360, height: 800 } })

test('bekijken eerst: tripoverzicht met route, dag, dagkaart, Logboek-kaartje en pin-assistent', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  // Een trip van Sailing Virgins vanaf vandaag, met basis Hvar.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await fillBoat(sheet)
  await sheet.getByLabel('Basis', { exact: true }).fill('Hvar')
  await sheet.getByLabel('Gebied').fill('Nepgebied')
  await sheet.getByRole('combobox', { name: 'Organisatie' }).selectOption({ label: 'Sailing Virgins' })
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()

  // Twee dagen: Hvar → Vis → Hvar.
  for (const [to, nm] of [
    ['Vis', '24'],
    ['Hvar', '22'],
  ] as const) {
    await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
    await page.getByLabel('Naar', { exact: true }).fill(to)
    await page.getByLabel('Zeemijlen').fill(nm)
    await page.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.getByText('Dag opgeslagen')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  }

  // Deze trip: kop met teller, gebied, periode en model; plaatsen zonder pin staan onder de kaart.
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  const head = page.locator('.trip-head')
  await expect(head.locator('h2')).toContainText('SV #1 · Nepgebied · ')
  await expect(head.locator('h2')).toContainText('Nepmodel 40')
  await expect(page.locator('.trip-route')).toContainText('Plaatsen zonder pin')
  await expect(page.locator('.trip-route')).toContainText('Vis')

  // Meer → Plaatsen → pin-assistent: "Hvar gevonden: klopt?", één tik per plaats.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await openMore(page, 'Plaatsen')
  await page.getByRole('button', { name: 'Plaatsen zonder pin' }).click()
  const assistant = page.getByRole('dialog', { name: 'Plaatsen zonder pin' })
  for (const name of ['Hvar', 'Vis']) {
    await expect(assistant).toContainText(`${name} gevonden: klopt?`, { timeout: 20_000 })
    await expectNoHorizontalOverflow(page)
    if (name === 'Vis') await page.screenshot({ path: 'screenshots/bekijken/pin-assistent.png' })
    await assistant.getByRole('button', { name: 'Ja, pin zetten' }).click()
  }
  await expect(assistant).toContainText('Alle plaatsen zijn langsgelopen.')
  await assistant.getByRole('button', { name: 'Sluiten' }).first().click()

  // Deze trip: de route op de kaart met genummerde stops (Hvar is start en eind: 1·3).
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.locator('.trip-route .map-stop')).toHaveCount(2)
  await expect(page.locator('.trip-route .map-stop.start.end')).toContainText('1·3')
  await expect(page.locator('.trip-route')).not.toContainText('Plaatsen zonder pin')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/bekijken/deze-trip.png', fullPage: true })

  // Een dag: eerst bekijken (geen Verwijderen), bewerken via het potlood.
  await page.locator('.leg-button').first().click()
  const day = page.getByRole('dialog', { name: 'Hvar → Vis' })
  await expect(day).toContainText('24 nm')
  await expect(day.getByRole('button', { name: 'Verwijderen' })).toHaveCount(0)
  await expect(day.locator('.map-stop')).toHaveCount(2)
  await day.getByRole('button', { name: 'Bewerken' }).click()
  await expect(page.getByRole('dialog', { name: 'Dag bewerken' }).getByRole('button', { name: 'Verwijderen' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click()

  // De kop: het potlood opent Trip bewerken.
  await head.getByRole('button', { name: /^Trip bewerken/ }).click()
  await expect(page.getByRole('dialog', { name: 'Trip bewerken' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click()

  // Agenda: de dagkaart van vandaag is eerst een weergave; dagsoort kiezen pas na het potlood.
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  await page.locator('.cal-day.today').click()
  const card = page.getByRole('dialog')
  await expect(card).toContainText('Werk')
  await expect(card).toContainText('SV #1 · Nepgebied')
  await expect(card).toContainText('46 nm')
  // Geen geld op deze dag: dan ook geen regel over geld.
  await expect(card).not.toContainText('Geen fooi op deze dag.')
  await expect(card.getByRole('radio', { name: 'Vrij' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/bekijken/dagkaart.png', fullPage: true })
  await card.getByRole('button', { name: 'Bewerken' }).click()
  await expect(page.getByRole('dialog').getByRole('radio', { name: 'Vrij' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten' }).click()

  // Logboek: een kaartje per trip met routeplaatje; tikken opent het overzicht met de kaart.
  await openLogbook(page)
  const tripCard = page.locator('.trip-card').first()
  await expect(tripCard).toContainText('SV #1 · Nepgebied')
  await expect(tripCard).toContainText('46 nm')
  await expect(tripCard.locator('.route-thumb-line')).toHaveCount(1)
  await tripCard.getByRole('button').click()
  const overview = page.getByRole('dialog')
  await expect(overview.locator('.map-stop')).toHaveCount(2)
  await expect(overview).toContainText('Gezeilde dagen')
  await overview.getByRole('button', { name: 'Bewerken' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Trip bewerken' })).toBeVisible()

  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Hvar')
  expect(wire).not.toContain('Nepgebied')
  expect(errors).toEqual([])
})
