import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mockGithub, type E2eGithub } from './helpers/fake-github'
import { mockRates } from './helpers/rates'
import { collectConsoleErrors, createNewLogbook, enterToken, expectNoHorizontalOverflow, lock, openLogbook, openMore, PASSPHRASE } from './helpers/logbook'

// Onafhankelijke review (november 2026, docs/review.md): de kernstromen zoals een nieuwe schipper ze doorloopt, op 360 px,
// met verzonnen gegevens en zonder de organisaties van Olivier. Elke test maakt schermafbeeldingen in screenshots/review/
// (docs/screens/ heeft een kopie). De tests controleren alleen wat de bestaande specs niet al controleren, of wat een
// nieuwe gebruiker als eerste tegenkomt; faalt iets, dan staat het als bevinding in docs/review.md.

test.use({ viewport: { width: 360, height: 800 } })

const fixture = fileURLToPath(new URL('../fixtures/mijlen-nep.xlsx', import.meta.url))

function iso(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function shot(page: Page, name: string): Promise<void> {
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `screenshots/review/${name}.png`, fullPage: true })
}

const status = (page: Page) => page.getByRole('status').first()

/** + → Trip: alleen de datums en een naam. */
async function quickTrip(page: Page, name: string, start: string, end: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Startdatum').fill(start)
  await page.getByLabel('Einddatum').fill(end)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
}

/** + → Dag: datum, van, naar, zeemijlen. */
async function quickDay(page: Page, date: string, from: string, to: string, nm: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Dag' }).click()
  await page.getByLabel('Datum', { exact: true }).fill(date)
  await page.getByLabel('Van', { exact: true }).fill(from)
  await page.getByLabel('Naar', { exact: true }).fill(to)
  await page.getByLabel('Zeemijlen', { exact: true }).fill(nm)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.add-layer')).toHaveCount(0)
}

/** Logboek → Nieuwe trip (het volledige blad), met organisatie en een deelnemer. */
async function fullTrip(page: Page, name: string, start: string, days: number, opts: { organisation?: string; participant?: string } = {}): Promise<void> {
  await openLogbook(page)
  await page.getByRole('button', { name: 'Nieuwe trip' }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Naam', { exact: true }).fill(name)
  await sheet.getByLabel('Startdatum').fill(start)
  await sheet.getByLabel('Aantal dagen').fill(String(days))
  if (opts.organisation) await sheet.getByRole('combobox', { name: 'Organisatie' }).selectOption({ label: opts.organisation })
  if (opts.participant) await sheet.getByLabel('Deelnemer 1', { exact: true }).fill(opts.participant)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
}

test('1. nieuw logboek, vergrendelen, ontgrendelen en de herstelcode tonen', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await page.goto('./')
  await shot(page, '01-eerste-keer')
  await page.getByRole('button', { name: 'Begin je eigen logboek' }).click()
  await shot(page, '02-uitleg-github')
  await page.getByRole('button', { name: 'Verder' }).click()
  await shot(page, '03-token-en-repo')
  // Een eigen logboek: de repository staat leeg (geen standaard van een ander).
  await expect(page.getByLabel('Data-repository (eigenaar/naam)')).toHaveValue('')
  await page.getByLabel('Data-repository (eigenaar/naam)').fill('nepschipper/logboek-data')
  // De nagebootste GitHub kent alleen Oliviers repo: de app meldt dan "niet gevonden" (dat is het echte gedrag bij een
  // typfout in de repo). Daarna de repo die de nep-GitHub wel kent.
  await page.getByLabel('GitHub-token').fill('github_pat_E2E_TEST_0123456789abcdefghijklmnopqrstuvwxyz')
  await page.getByRole('button', { name: 'Controleren', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, '03b-repo-niet-gevonden')
  await page.getByLabel('Data-repository (eigenaar/naam)').fill('logboek-olivier/logboek-data')
  await enterToken(page, 'Verder')
  await shot(page, '04-wachtzin')
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Nog een keer').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Verder' }).click()
  await expect(page.getByRole('heading', { name: 'Herstelcode' })).toBeVisible({ timeout: 30_000 })
  await shot(page, '05-herstelcode')
  const words = await page.locator('.words li').allTextContents()
  expect(words).toHaveLength(24)
  await page.getByRole('button', { name: 'Ik heb ze opgeschreven' }).click()
  await shot(page, '06-herstelcode-controle')
  for (const label of await page.locator('label').allTextContents()) {
    const m = /Woord (\d+)/.exec(label)
    if (m) await page.getByLabel(label.trim(), { exact: true }).fill(words[Number(m[1]) - 1] ?? '')
  }
  await page.getByRole('button', { name: 'Logboek aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })
  await shot(page, '07-vandaag-leeg')
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await shot(page, '07b-deze-trip-leeg')
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  await shot(page, '07c-agenda-leeg')
  await page.getByRole('navigation').getByRole('button', { name: 'Meer', exact: true }).click()
  await shot(page, '07d-meer')

  // Vergrendelen en ontgrendelen met de wachtzin.
  await lock(page)
  await shot(page, '08-ontgrendelen')
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })

  // Herstelcode tonen: alleen na de wachtzin.
  await openMore(page, 'Instellingen')
  await shot(page, '09-instellingen')
  await page.getByRole('button', { name: /Herstelcode tonen/ }).click()
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Tonen', exact: true }).click()
  await expect(page.locator('.words li')).toHaveCount(24, { timeout: 30_000 })
  expect(await page.locator('.words li').allTextContents()).toEqual(words)
  await shot(page, '09b-herstelcode-tonen')
  expect(errors).toEqual([])
})

test('2. tweede apparaat koppelen met de wachtzin, beide zonder verbinding iets maken, daarna sync met conflict', async ({ browser }) => {
  test.setTimeout(240_000)
  const a = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const pageA = await a.newPage()
  const github = await mockGithub(pageA)
  await mockRates(pageA)
  await createNewLogbook(pageA)
  await expect(status(pageA)).toHaveText('Gesynct', { timeout: 15_000 })
  await quickTrip(pageA, 'Nep A1', iso(10), iso(16))
  await expect(status(pageA)).toHaveText('Gesynct', { timeout: 30_000 })

  const b = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const pageB = await b.newPage()
  await mockGithub(pageB, github as E2eGithub)
  await mockRates(pageB)
  await pageB.goto('./')
  await pageB.getByRole('button', { name: 'Bestaand logboek koppelen' }).click()
  // Bevinding: bij koppelen staat de repository van Olivier voorgevuld, ook voor een andere gebruiker.
  await shot(pageB, '10-koppelen-voorgevuld')
  await enterToken(pageB)
  await pageB.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await pageB.getByRole('button', { name: 'Koppelen' }).click()
  await expect(pageB.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  await expect(status(pageB)).toHaveText('Gesynct', { timeout: 15_000 })
  // Een komende trip staat niet in het Logboek (dat is het archief), wel onder Meer → Periodes.
  await openMore(pageB, 'Periodes')
  await expect(pageB.locator('.period-row', { hasText: 'Nep A1' })).toHaveCount(1)
  await shot(pageB, '11-tweede-apparaat-periodes')

  // Beide zonder verbinding een trip maken: elk apparaat houdt zijn wijziging in de outbox.
  github.offline = true
  await quickTrip(pageA, 'Nep A2', iso(20), iso(26))
  await quickTrip(pageB, 'Nep B2', iso(30), iso(36))
  await expect(status(pageA)).not.toHaveText('Gesynct')
  await shot(pageA, '12-zonder-verbinding')
  github.offline = false
  // A synct eerst (tik op de status), dan B: B leest, voegt samen en schrijft (conflictafhandeling met de sha).
  await status(pageA).click()
  await expect(status(pageA)).toHaveText('Gesynct', { timeout: 60_000 })
  await status(pageB).click()
  await expect(status(pageB)).toHaveText('Gesynct', { timeout: 60_000 })
  await status(pageA).click()
  await expect(status(pageA)).toHaveText('Gesynct', { timeout: 60_000 })
  for (const page of [pageA, pageB]) {
    await openMore(page, 'Periodes')
    for (const name of ['Nep A1', 'Nep A2', 'Nep B2']) await expect(page.locator('.period-row', { hasText: name })).toHaveCount(1)
  }
  await shot(pageB, '13-na-conflict-beide-trips')
  // Geen PUT zonder sha op een bestaand bestand, en elke PUT droeg een commitbericht zonder inhoud.
  const puts = github.requests.filter((r) => r.method === 'PUT' && r.url.includes('trips.json.enc'))
  expect(puts.length).toBeGreaterThanOrEqual(3)
  for (const put of puts) expect(put.body).toMatch(/"message":"sync \d{4}-\d{2}-\d{2}T[^"]* v[^"]+ d[0-9a-f]{8}"/)
  await a.close()
  await b.close()
})

test('3. dag toevoegen, trip bewerken, verwijderen en terughalen uit de prullenbak', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })

  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await shot(page, '20-toevoegen-dag')
  await page.getByRole('tab', { name: 'Trip' }).click()
  await shot(page, '21-toevoegen-trip')
  await page.getByLabel('Startdatum').fill(iso(-3))
  await page.getByLabel('Einddatum').fill(iso(3))
  await page.getByLabel('Naam', { exact: true }).fill('Nepweek test')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })

  // Bevinding (docs/review.md, D-2): de allereerste trip via + krijgt de soort "Werk · Training geven" en staat meteen
  // in Nakijken ("werk zonder organisatie"), terwijl een nieuwe gebruiker nog geen organisaties heeft.
  await expect(page.getByRole('main')).toContainText('nakijken')
  await shot(page, '21b-vandaag-nakijken-na-eerste-trip')
  await openMore(page, 'Nakijken')
  await shot(page, '21c-nakijken')
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()

  await quickDay(page, iso(-2), 'Nephaven', 'Nepbaai', '12')
  await quickDay(page, iso(-1), 'Nepbaai', 'Nepdorp', '8,5')
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.getByRole('main')).toContainText('Nepweek test')
  await expect(page.getByRole('main')).toContainText('7 dagen')
  await shot(page, '22-deze-trip')

  // Bewerken via het potlood: de naam.
  await page.getByRole('main').getByRole('button', { name: /^Trip bewerken/ }).first().click()
  const edit = page.getByRole('dialog', { name: 'Trip bewerken' })
  await shot(page, '23-trip-bewerken')
  await edit.getByLabel('Naam', { exact: true }).fill('Nepweek bewerkt')
  await edit.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('main')).toContainText('Nepweek bewerkt')

  // Verwijderen alleen onder "⋯", met wat eraan hangt.
  await page.getByRole('button', { name: 'Meer bij Nepweek bewerkt' }).click()
  const menu = page.getByRole('dialog').last()
  await menu.getByRole('button', { name: 'Periode verwijderen' }).click()
  await expect(menu.locator('.delete-choice')).toContainText('Hieraan hangt: 2 gelogde dagen.')
  await shot(page, '24-periode-verwijderen')
  await menu.getByRole('button', { name: 'Alles naar de prullenbak' }).click()
  await expect(page.locator('.toast')).toContainText('prullenbak')
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 40_000 })

  await openMore(page, 'Prullenbak')
  await expect(page.getByRole('main')).toContainText('Nepweek bewerkt')
  await shot(page, '25-prullenbak')
  await page.getByRole('button', { name: /^Nepweek bewerkt/ }).click()
  await shot(page, '25b-prullenbak-detail')
  await page.getByRole('dialog').getByRole('button', { name: 'Terugzetten' }).first().click()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.getByRole('main')).toContainText('Nepweek bewerkt')
  await expect(page.getByRole('main')).toContainText('2 gelogd')
  await shot(page, '26-teruggezet')
  expect(errors).toEqual([])
})

test('4. Excel importeren en opnieuw importeren geeft geen dubbele trips of dagen', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })
  await openLogbook(page)
  await shot(page, '30-logboek-leeg')
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
  await expect(page.getByRole('heading', { name: 'Controle import' })).toBeVisible()
  await shot(page, '31-import-controle')
  const planText = (await page.locator('.import-plan').textContent()) ?? ''
  await page.getByRole('button', { name: 'Importeren' }).click()
  await expect(page.getByRole('heading', { name: 'Bootgegevens controleren' })).toBeVisible({ timeout: 15_000 })
  await shot(page, '32-boten-controle')
  await page.getByRole('button', { name: 'Overslaan' }).click()
  await expect(status(page)).toHaveText('Gesynct', { timeout: 30_000 })
  await openLogbook(page)
  const totalsOf = async () => /Totaal(.*?)nm per maand/.exec((await page.locator('main').textContent()) ?? '')?.[1] ?? ''
  const trips = await page.locator('.trip').count()
  const totals = await totalsOf()
  expect(trips).toBe(3)
  expect(totals).toContain('240 nm')
  await shot(page, '33-logboek-na-import')

  // Nog een keer hetzelfde bestand: alles "staat er al", niets dubbel.
  await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
  await expect(page.getByRole('heading', { name: 'Controle import' })).toBeVisible()
  await shot(page, '34-opnieuw-importeren-controle')
  await page.getByRole('button', { name: 'Importeren' }).click()
  await expect(page.getByRole('heading', { name: 'Controle import' })).toHaveCount(0, { timeout: 30_000 })
  if (await page.getByRole('heading', { name: 'Bootgegevens controleren' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Overslaan' }).click()
  await expect(status(page)).toHaveText('Gesynct', { timeout: 30_000 })
  await openLogbook(page)
  expect(await page.locator('.trip').count()).toBe(trips)
  expect(await totalsOf()).toBe(totals)
  test.info().annotations.push({ type: 'import-plan', description: planText.slice(0, 200) })
  expect(errors).toEqual([])
})

test('5. agenda: overlappende trips en dezelfde deelnemer in twee trips zijn gewoon goed', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })
  await fullTrip(page, 'Nepweek één', iso(-2), 7, { participant: 'Nepnick' })
  await fullTrip(page, 'Nepweek twee', iso(2), 7, { participant: 'Nepnick' })
  await page.getByRole('navigation').getByRole('button', { name: 'Agenda', exact: true }).click()
  await expect(page.locator('.overlap-notice')).toHaveCount(0)
  // Een trip over twee weekrijen heeft per rij een balk: beide namen staan er, zonder melding over de overlap.
  await expect(page.locator('.cal-bar', { hasText: 'Nepweek één' }).first()).toBeVisible()
  await expect(page.locator('.cal-bar', { hasText: 'Nepweek twee' }).first()).toBeVisible()
  await shot(page, '40-agenda-overlap')
  await page.locator('.cal-day.today').click()
  await shot(page, '41-dagkaart')
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click()
  await openMore(page, 'Periodes')
  await shot(page, '42-periodes')
  // Nakijken kent geen punt voor overlap of een deelnemer in twee trips. Er staat wél een punt: de twee trips zijn
  // "werk zonder organisatie" (bevinding D-2, ook via het volledige blad Nieuwe trip).
  await openMore(page, 'Nakijken')
  await expect(page.getByRole('heading', { name: 'Nakijken', exact: true })).toBeVisible()
  const review = (await page.getByRole('main').textContent()) ?? ''
  expect(review).not.toMatch(/overlap|Nepnick/i)
  expect(review).toMatch(/organisatie/i)
  await shot(page, '43-nakijken-na-twee-trips')
  expect(errors).toEqual([])
})

test('6. geld: eigen organisatie, salaris, fooi in dollars, uitgave, eerder seizoen, jaaroverzicht en doorklikken', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })
  const toast = page.locator('.toast')

  // Een eigen organisatie (geen Sailing Virgins of Yacht Week).
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: /^Organisaties/ }).click()
  const orgs = page.getByRole('dialog')
  await shot(page, '50-organisaties-leeg')
  await orgs.getByRole('button', { name: 'Organisatie toevoegen' }).click()
  await orgs.getByLabel('Naam').last().fill('Nepzeil')
  await orgs.getByLabel('Afkorting').last().fill('NZ')
  await orgs.getByRole('button', { name: 'Opslaan' }).click()
  await expect(orgs).toHaveCount(0)
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()

  // Een voorbije en een komende trip bij die organisatie; salaris via Trip bewerken → Geld.
  await fullTrip(page, 'Nepweek voorbij', iso(-20), 7, { organisation: 'Nepzeil' })
  await fullTrip(page, 'Nepweek straks', iso(20), 7, { organisation: 'Nepzeil' })
  // Een trip zonder gelogde dagen staat niet in het Logboek-archief; wel onder Meer → Periodes.
  await openMore(page, 'Periodes')
  await page.getByLabel('Zoeken op naam, boot, plaats of persoon').fill('voorbij')
  await page.locator('.period-row', { hasText: 'Nepweek voorbij' }).click()
  await expect(page.getByRole('dialog')).toContainText('NZ #1')
  await page.getByRole('dialog').getByRole('button', { name: 'Bewerken', exact: true }).first().click()
  const edit = page.getByRole('dialog', { name: 'Trip bewerken' })
  await edit.getByRole('button', { name: /^Geld/ }).click()
  await edit.locator('.salary-row').click()
  const salary = page.getByRole('dialog').last()
  await shot(page, '51-salarisblad')
  await salary.getByLabel('Salaris (bedrag)').fill('1000')
  await salary.getByRole('button', { name: 'Opslaan' }).click()
  await expect(toast).toContainText('Salaris opgeslagen')
  await expect(toast).toHaveCount(0, { timeout: 15_000 })
  await edit.getByRole('button', { name: 'Sluiten', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Vandaag vraagt of het salaris van de voorbije trip binnen is (zonder bedrag).
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('main')).toContainText(/Salaris van .*Nepweek voorbij ontvangen\?/)
  await shot(page, '52-vandaag-salarisvraag')
  await page.getByRole('button', { name: 'Ja', exact: true }).click()
  await expect(toast).toHaveCount(0, { timeout: 15_000 })

  // Een fooi in dollars (de koers is 1,25 in de nagebootste rates.json) en een uitgave.
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Inkomsten' }).click()
  await page.getByLabel('Bedrag').fill('250')
  await page.getByLabel('Valuta').selectOption('USD')
  await page.getByLabel('Datum', { exact: true }).fill(iso(-14))
  await shot(page, '53-fooi-dollars')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(toast).toContainText('Fooi')
  await expect(toast).toHaveCount(0, { timeout: 15_000 })
  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Uitgave' }).click()
  await page.getByLabel('Bedrag').fill('42,80')
  // Na een fooi in dollars staat een uitgave gewoon in euro: elke soort onthoudt zijn eigen valuta (review D-7).
  await expect(page.getByLabel('Valuta')).toHaveValue('EUR')
  await page.getByLabel('Omschrijving').fill('Havengeld Nephaven')
  await page.getByLabel('Datum', { exact: true }).fill(iso(-15))
  await shot(page, '54-uitgave')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(toast).toHaveCount(0, { timeout: 15_000 })

  // Eerder seizoen: drie bedragen bij organisatie en jaar.
  await openMore(page, 'Geld')
  await page.locator('.money-period').getByRole('radio', { name: 'Alles' }).click()
  await page.getByRole('button', { name: 'Eerder seizoen' }).click()
  const season = page.getByRole('dialog', { name: 'Eerder seizoen' })
  await season.getByLabel('Organisatie').selectOption({ label: 'Nepzeil' })
  await season.getByLabel('Jaar').fill(String(new Date().getFullYear() - 1))
  await season.getByLabel('Salaris', { exact: true }).fill('3000')
  await season.getByLabel('Valuta: Salaris').selectOption('EUR')
  await season.getByLabel('Fooien', { exact: true }).fill('400')
  await season.getByLabel('Valuta: Fooien').selectOption('EUR')
  await season.getByRole('button', { name: 'Opslaan' }).click()
  await expect(toast).toContainText('2 bedragen opgeslagen bij het seizoen')
  await expect(toast).toHaveCount(0, { timeout: 15_000 })
  await shot(page, '55-geld-werkelijk')

  // De sommen: inkomsten = 1000 + 250/1,25 + 3000 + 400 = 4.600; kosten 42,80; resultaat 4.557,20.
  const main = page.getByRole('main')
  // De bedragen staan in de toegankelijke naam van de knop ("Inkomsten: € 4.600,00").
  await expect(main.getByRole('button', { name: 'Inkomsten: € 4.600,00' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Kosten: € 42,80' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Zeilgeld: resultaat: € 4.557,20' })).toBeVisible()
  // Per organisatie: alles hoort bij Nepzeil (de trips en het seizoen).
  await expect(main.locator('.section', { has: page.getByRole('heading', { name: 'Per organisatie' }) })).toContainText('Nepzeil')
  // Doorklikken op de inkomsten: de posten tellen op tot het bedrag, met het bedrag per kalenderjaar.
  await main.getByRole('button', { name: /^Inkomsten: / }).click()
  const drill = page.getByRole('dialog', { name: 'Inkomsten' })
  await expect(drill.locator('.drill-total')).toContainText('€ 4.600,00')
  await expect(drill).toContainText('Per kalenderjaar')
  await shot(page, '56-doorklik-inkomsten')
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Het jaaroverzicht voor de belasting: dit jaar en vorig jaar, per organisatie.
  const tax = main.locator('.section.tax-year')
  await tax.scrollIntoViewIfNeeded()
  await expect(tax).toContainText('Nepzeil')
  await shot(page, '57-jaaroverzicht')
  expect(errors).toEqual([])
})

test('7. rekening en saldo, netto waarde en de verandering, beginsaldo, Verwacht met Gepland en Scenario', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })
  const toast = page.locator('.toast')

  await openMore(page, 'Rekeningen')
  await shot(page, '60-rekeningen-leeg')
  for (const provider of ['ASN', 'Studieschuld (DUO)']) {
    await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
    const sheet = page.getByRole('dialog').last()
    await sheet.getByRole('radio', { name: provider }).click()
    await sheet.getByRole('button', { name: 'Opslaan' }).click()
    await expect(toast).toHaveText('Opgeslagen')
    await expect(toast).toHaveCount(0, { timeout: 15_000 })
  }
  await openMore(page, 'Geld')
  const position = page.locator('.position')
  for (const [provider, amount] of [
    ['ASN', '2500'],
    ['Studieschuld (DUO)', '12000'],
  ] as const) {
    await position.locator('.position-account', { hasText: provider }).click()
    const sheet = page.getByRole('dialog')
    await sheet.locator('input.amount').fill(amount)
    await sheet.getByRole('button', { name: 'Stand opslaan' }).click()
    await expect(toast).toHaveText('Stand opgeslagen')
    await expect(toast).toHaveCount(0, { timeout: 15_000 })
  }
  const totals = position.locator('.position-totals')
  await expect(totals).toContainText('Netto waarde vandaag')
  await expect(totals).toContainText('−€ 9.500,00')
  await shot(page, '61-mijn-positie')

  // Een eigen periode zonder stand op de begindag: "Verandering onbekend", dan het beginsaldo invoeren.
  const periodBox = page.locator('.money-period')
  await periodBox.getByRole('radio', { name: 'Zelf kiezen' }).click()
  await periodBox.getByLabel('Van').fill(iso(-30))
  await periodBox.getByLabel('Tot en met').fill(iso(60))
  const unknown = position.locator('.change-unknown')
  await expect(unknown).toContainText('Verandering onbekend')
  await shot(page, '62-verandering-onbekend')
  await unknown.getByRole('button', { name: 'Beginsaldo invoeren' }).click()
  const start = page.getByRole('dialog')
  await start.getByLabel('ASN (EUR)').fill('2000')
  await start.getByLabel('Studieschuld (DUO) (EUR)').fill('12500')
  await start.getByRole('button', { name: 'Opslaan' }).click()
  await expect(toast).toContainText('Beginsaldo opgeslagen')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Begin −10.500, nu −9.500: +1.000 = schulden +500 en overig +500.
  await expect(totals).toContainText('+€ 1.000,00')
  await shot(page, '63-verandering-uitgesplitst')

  // Verwacht: Gepland, dan een scenario met één blok. Periode weer op Alles: anders knipt de zelf gekozen einddatum
  // het scenario af (dat is bedoeld gedrag; de app zegt er dan bij dat het scenario langer loopt).
  await periodBox.getByRole('radio', { name: 'Alles' }).click()
  await page.getByRole('tab', { name: 'Verwacht' }).click()
  const modes = page.getByRole('radiogroup', { name: 'Vooruitblik' })
  await expect(modes.getByRole('radio', { name: 'Gepland' })).toHaveAttribute('aria-checked', 'true')
  await shot(page, '64-verwacht-gepland')
  await modes.getByRole('radio', { name: 'Scenario' }).click()
  await page.getByRole('button', { name: 'Scenario maken' }).click()
  await page.getByRole('dialog').getByLabel('Naam').fill('Nepplan')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await page.getByRole('button', { name: 'Blok toevoegen' }).click()
  const block = page.getByRole('dialog')
  await block.getByLabel('Aantal weken').fill('10')
  await block.getByLabel('Inkomen per week').fill('1000')
  await block.getByRole('button', { name: 'Opslaan' }).click()
  await expect(toast).toHaveCount(0, { timeout: 15_000 })
  const sum = page.locator('.forecast-sum')
  await expect(sum.getByRole('button', { name: /Scenario-inkomen/ })).toContainText('+€ 10.000,00')
  // De som sluit: −9.500 + 10.000 = 500 (zonder kosten: die zijn nog onbekend en tellen als 0).
  await expect(sum.locator('.forecast-total')).toContainText('€ 500,00')
  await shot(page, '65-verwacht-scenario')
  expect(errors).toEqual([])
})

test('8. zonder verbinding loggen en daarna synchroniseren; een ouder venster schrijft niet meer na een nieuwere build', async ({ page }) => {
  test.setTimeout(150_000)
  const github = await mockGithub(page)
  await mockRates(page)
  await createNewLogbook(page)
  await expect(status(page)).toHaveText('Gesynct', { timeout: 15_000 })

  github.offline = true
  await quickDay(page, iso(0), 'Nephaven', 'Nepbaai', '10')
  await expect(status(page)).not.toHaveText('Gesynct')
  await shot(page, '70-offline-wijziging-wacht')
  const putsBefore = github.requests.filter((r) => r.method === 'PUT').length
  github.offline = false
  await status(page).click()
  await expect(status(page)).toHaveText('Gesynct', { timeout: 60_000 })
  expect(github.requests.filter((r) => r.method === 'PUT').length).toBeGreaterThan(putsBefore)
  await shot(page, '71-weer-gesynct')

  // Een nieuwere build is gestart (in een ander venster): dit venster schrijft niets meer naar GitHub.
  await page.evaluate(() => localStorage.setItem('logboek-gestarte-build', JSON.stringify({ build: '99.0.0+zzzzzzz', date: '2099-01-01T00:00:00.000Z' })))
  const putsBeforeOld = github.requests.filter((r) => r.method === 'PUT').length
  await quickDay(page, iso(-1), 'Nepbaai', 'Nepdorp', '6')
  await expect(status(page)).toContainText('Werk de app bij', { timeout: 30_000 })
  expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(putsBeforeOld)
  await shot(page, '72-oud-venster-werk-de-app-bij')
})
