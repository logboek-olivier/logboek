import { expect, test, type Browser, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { META_PATH, parseMeta, unlock } from '../../src/crypto/keys'
import { translate } from '../../src/i18n'
import { COLLECTION_PATHS } from '../../src/model/types'
import { decryptRecords } from '../../src/storage/sync'
import { UPGRADE_SAMPLES } from '../upgrade/upgrade-samples'
import { mockGithub, newGithub, type E2eGithub } from './helpers/fake-github'
import { enterToken, lock, openMore, PASSPHRASE } from './helpers/logbook'
import { startStaticServer, type SwitchableServer } from './helpers/static-server'

// Verplichte upgradetest (harde regel 16): gegevens van de vorige release, bijwerken in dezelfde browseropslag,
// synchroniseren, en daarna op een schoon apparaat koppelen met de wachtzin. Alle bestanden moeten leesbaar zijn en
// het herstelscherm mag nergens blijven hangen. Daarnaast: de vorige release werkt zich vanuit elk scherm bij
// (eerste keer, ontgrendelen, herstellen), en de toestand van Oliviers telefoon van 28 oktober 2026 (lus op het
// herstelscherm) komt met de nieuwe versie in hoogstens drie tikken weer in de app.
// De vorige release staat in .vorige/ (npm run upgrade:vorige; CI doet dat vóór de Playwright-tests).

const previous = fileURLToPath(new URL('../../.vorige/', import.meta.url))
const current = fileURLToPath(new URL('../../dist/', import.meta.url))
const L = (key: Parameters<typeof translate>[1]) => translate('nl', key)
let portCounter = 0
/** Eigen poort per test en worker; elke server is een eigen origin, dus een eigen browseropslag. */
const nextPort = () => 4200 + test.info().workerIndex * 20 + portCounter++

test.skip(!process.env.CI && !existsSync(`${previous}data.json`), 'Vorige release ontbreekt; eerst npm run upgrade:vorige')

interface UpgradeData {
  paths: string[]
  files: Record<string, string>
}

function readData(): UpgradeData {
  return JSON.parse(readFileSync(`${previous}data.json`, 'utf8')) as UpgradeData
}

function githubWith(data: UpgradeData): E2eGithub {
  const github = newGithub()
  let n = 0
  for (const [path, content] of Object.entries(data.files)) github.files.set(path, { sha: `sha-vorige-${++n}`, content })
  return github
}

/** Geldige vorm (versie 1, iv, tag) maar onder een andere sleutel: ontsleutelen faalt. */
function foreignCiphertext(): string {
  const bytes = new Uint8Array(1 + 12 + 64 + 16)
  bytes[0] = 1
  for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 37) % 256
  return Buffer.from(bytes).toString('base64')
}

const NEW_SCRIPT = (() => /<script type="module"[^>]*src="([^"]+)"/.exec(readFileSync(`${current}index.html`, 'utf8'))?.[1] ?? null)()

function loadedScript(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('script[type="module"]')?.getAttribute('src') ?? null)
}

const repairHeading = (page: Page) => page.getByRole('heading', { name: L('repair.title') })
const todayHeading = (page: Page) => page.getByRole('heading', { name: L('nav.today') })
const unlockButton = (page: Page) => page.getByRole('button', { name: L('unlock.unlock') })

async function link(page: Page): Promise<void> {
  await page.getByRole('button', { name: L('setup.link') }).click()
  await enterToken(page)
  await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: L('setup.linkButton') }).click()
  await expect(todayHeading(page).or(repairHeading(page))).toBeVisible({ timeout: 30_000 })
}

async function expectSynced(page: Page): Promise<void> {
  await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 20_000 })
  await expect(repairHeading(page)).toHaveCount(0)
}

/**
 * Deploy van deze release terwijl de pagina open is, dan de app sluiten en openen (herladen). De vorige release moet
 * zichzelf bijwerken; staat er een balk "Herladen" (bijvoorbeeld tijdens de eerste keer), dan telt die tik mee.
 */
async function deployAndReopen(page: Page, server: SwitchableServer): Promise<number> {
  await page.evaluate(() => navigator.serviceWorker.ready)
  const deployedAt = Date.now() - 1000
  server.root = current
  await page.reload()
  let taps = 0
  const bar = page.getByRole('button', { name: L('update.reload') })
  await expect
    .poll(
      async () => {
        if ((await loadedScript(page)) === NEW_SCRIPT) return true
        if (taps === 0 && (await bar.isVisible().catch(() => false))) {
          taps++
          await bar.click()
        }
        return false
      },
      { timeout: 60_000 },
    )
    .toBe(true)
  // De nieuwe service worker neemt over en herlaadt open vensters (public/sw-vensters.js zet daarbij het tijdstip
  // 'herladen' in zijn eigen cache): pas verder als dit venster daarna geladen is (of, als het venster halverwege iets
  // is en zelf wacht, een paar seconden later), anders valt dat herladen midden in een volgende stap.
  await expect
    .poll(
      () =>
        page
          .evaluate(async (since) => {
            const cache = await caches.open('logboek-sw-vensters')
            const hit = await cache.match('herladen')
            const at = hit ? Number(await hit.text()) : 0
            if (at < since) return false
            return performance.timeOrigin >= at || Date.now() - at > 3000
          }, deployedAt)
          .catch(() => false),
      { timeout: 60_000 },
    )
    .toBe(true)
  await page.waitForLoadState('load')
  await expect.poll(() => loadedScript(page), { timeout: 30_000 }).toBe(NEW_SCRIPT)
  return taps
}

async function newContext(browser: Browser) {
  return browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'nl-NL' })
}

/** Een schoon apparaat koppelt met de wachtzin; elk bestand op GitHub is te lezen en elk voorbeeld staat er nog. */
async function cleanDeviceReadsAll(browser: Browser, server: SwitchableServer, github: E2eGithub, data: UpgradeData, startedUnreadable: string[] = []): Promise<void> {
  const clean = await newContext(browser)
  const page = await clean.newPage()
  await mockGithub(page, github)
  await page.goto(server.url)
  await link(page)
  await expectSynced(page)
  await clean.close()
  const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
  const key = await unlock(meta, { passphrase: PASSPHRASE })
  for (const path of COLLECTION_PATHS) {
    if (!data.paths.includes(path)) continue
    const file = github.files.get(path)
    expect(file, path).toBeDefined()
    const records = await decryptRecords(key, path, Uint8Array.from(Buffer.from(file!.content, 'base64')))
    // Een bestand dat al onleesbaar op GitHub stond toen de vorige release koppelde, had nergens een leesbare kopie:
    // dat begint opnieuw. Elk ander voorbeeld moet er nog staan.
    if (startedUnreadable.includes(path)) continue
    for (const sample of UPGRADE_SAMPLES[path] ?? []) expect(records.map((r) => r.id), path).toContain(sample.id)
  }
}

test('upgrade: vorige release → deze release in dezelfde opslag → schoon apparaat leest alles', async ({ browser }) => {
  test.setTimeout(180_000)
  const data = readData()
  const github = githubWith(data)
  const server = await startStaticServer(nextPort(), `${previous}src/dist/`)
  try {
    const phone = await newContext(browser)
    const page = await phone.newPage()
    await mockGithub(page, github)
    await page.goto(server.url)
    await link(page)
    await expectSynced(page)

    await deployAndReopen(page, server)
    // Binnen 5 minuten hervat de sessie; anders ontgrendelen met de wachtzin.
    await expect(todayHeading(page).or(unlockButton(page))).toBeVisible({ timeout: 30_000 })
    if (await unlockButton(page).isVisible()) {
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await unlockButton(page).click()
    }
    await page.getByRole('status').first().click()
    await expectSynced(page)
    const puts = (path: string) => github.requests.filter((r) => r.method === 'PUT' && r.url.includes(path)).length
    // Na de update controleert de app vanzelf (Controleer nu), met de schrijver per bestand uit de commits.
    await expect.poll(() => github.requests.some((r) => r.method === 'GET' && r.url.includes('/commits?path=')), { timeout: 30_000 }).toBe(true)
    // Een trip uit Toevoegen → Dag: een dag erbij, de datums volgen (trips.json.enc, nieuw veld datesFromDays).
    await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
    await page.getByLabel(L('field.date'), { exact: true }).fill('2026-10-13')
    await page.getByRole('combobox', { name: L('field.week'), exact: true }).selectOption({ label: 'Nepdag upgrade' })
    await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')
    const legPuts = puts('legs.json.enc')
    await page.getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('legs.json.enc'), { timeout: 20_000 }).toBeGreaterThan(legPuts)
    await expectSynced(page)
    // De melding "Dag opgeslagen" ligt anders over de knop Opslaan van de volgende invoer.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    // Agenda (calendar.json.enc, nieuw sinds de agenda-release): een dag instellen, synchroniseren.
    const calendarPuts = puts('calendar.json.enc')
    await page.getByRole('navigation').getByRole('button', { name: L('nav.calendar'), exact: true }).click()
    await page.locator('.cal-day.today').click()
    // Eerst de dagkaart; de dagsoort kiezen via het potlood.
    await page.getByRole('dialog').getByRole('button', { name: L('common.edit') }).click()
    await page.getByRole('dialog').getByRole('radio', { name: L('dayType.thuis') }).click()
    await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
    await expect(page.locator('.cal-day.today')).toHaveClass(/day-thuis/)
    // Wachten tot de wijziging echt op GitHub staat ("Gesynct" kan nog de status van vóór de wijziging zijn).
    await expect.poll(() => puts('calendar.json.enc'), { timeout: 20_000 }).toBeGreaterThan(calendarPuts)
    await expectSynced(page)
    // Fooi per persoon (nieuwe velden in trips en transacties): een fooi van één deelnemer van de voorbeeldtrip.
    await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
    await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
    await page.getByLabel(L('field.amount')).fill('25')
    await page.getByRole('combobox', { name: new RegExp(`^${L('field.trip')}`) }).selectOption({ label: 'Nepweek upgrade' })
    await page.getByRole('button', { name: 'Nepnick', exact: true }).click()
    const tipPuts = puts('transactions.json.enc')
    await page.getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('transactions.json.enc'), { timeout: 20_000 }).toBeGreaterThan(tipPuts)
    await expectSynced(page)
    // Teller per organisatie (nieuwe velden in de instellingen): beginnummer Yacht Week, het voorbeeld voor SV blijft.
    await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
    // De melding na opslaan ligt over het menu Meer: eerst laten verdwijnen.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    await openMore(page, L('nav.settings'), L('nav.more'))
    await page.getByRole('button', { name: new RegExp(`^${L('counter.title')}`) }).click()
    await expect(page.getByLabel(translate('nl', 'counter.first', { org: 'SV' }))).toHaveValue('3')
    await page.getByLabel(translate('nl', 'counter.first', { org: 'YW' })).fill('10')
    const settingsPuts = puts('settings.json.enc')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('settings.json.enc'), { timeout: 20_000 }).toBeGreaterThan(settingsPuts)
    await expectSynced(page)
    // Salaris per trip (nieuw veld in trips, standaardbedragen in de instellingen): Vandaag vraagt na de einddatum of
    // het salaris ontvangen is; "Ja" maakt een inkomen bij de trip en zet de status op ontvangen.
    await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
    const salaryQuestion = page.locator('.salary-question', { hasText: 'Nepsalaris upgrade' })
    await expect(salaryQuestion).toBeVisible()
    const salaryPuts = puts('trips.json.enc')
    await salaryQuestion.getByRole('button', { name: L('salary.yes'), exact: true }).click()
    await expect.poll(() => puts('trips.json.enc'), { timeout: 20_000 }).toBeGreaterThan(salaryPuts)
    await expectSynced(page)
    await phone.close()
    await cleanDeviceReadsAll(browser, server, github, data)
    // Het schone apparaat leest ook de agenda: de nieuwe dag, naast de voorbeelden als de vorige release de agenda al kende.
    const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
    const key = await unlock(meta, { passphrase: PASSPHRASE })
    const calendar = await decryptRecords(key, 'calendar.json.enc', Uint8Array.from(Buffer.from(github.files.get('calendar.json.enc')!.content, 'base64')))
    expect(calendar).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'thuis', deletedAt: null })]))
    // De dagsoort onbeschikbaar met reden komt ongeschonden over.
    expect(calendar.find((d) => d.id === 'dag:2026-10-27')).toMatchObject({ type: 'onbeschikbaar', reason: 'Nepreden', deletedAt: null })
    // En de fooi per persoon: de voorbeelden (per persoon, hele groep) en de nieuwe fooi van één deelnemer.
    const transactions = await decryptRecords(key, 'transactions.json.enc', Uint8Array.from(Buffer.from(github.files.get('transactions.json.enc')!.content, 'base64')))
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'upg-tx-1', tipFrom: { kind: 'personen', participantIds: ['upg-p-1', 'upg-p-2'], amounts: { 'upg-p-1': 30, 'upg-p-2': 20 } } }),
        expect.objectContaining({ id: 'upg-tx-2', tipFrom: { kind: 'groep' } }),
        expect.objectContaining({ amount: 25, tripId: 'upg-trip-1', tipFrom: { kind: 'personen', participantIds: ['upg-p-1'] } }),
      ]),
    )
    const settings = await decryptRecords(key, 'settings.json.enc', Uint8Array.from(Buffer.from(github.files.get('settings.json.enc')!.content, 'base64')))
    expect(settings.find((s) => s.id === 'settings')).toMatchObject({ orgFirst: { 'sailing-virgins': 3, 'yacht-week': 10 }, orgAnswered: ['upg-trip-0'], salaryDefaults: { 'sailing-virgins': { amount: 1100, currency: 'EUR' } }, dailyReminder: { time: '19:30', workdaysOnly: true } })
    const trips = await decryptRecords(key, 'trips.json.enc', Uint8Array.from(Buffer.from(github.files.get('trips.json.enc')!.content, 'base64')))
    expect(trips.find((t) => t.id === 'upg-trip-dag')).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-13', datesFromDays: true })
    // Het salaris is ontvangen (eigen bedrag blijft), met het inkomen bij de trip.
    const salaryTrip = trips.find((t) => t.id === 'upg-trip-salaris') as { salary?: { transactionId?: string } } | undefined
    expect(salaryTrip).toMatchObject({ salary: { amount: 1200, currency: 'EUR', status: 'ontvangen', source: 'eigen' } })
    expect(transactions).toEqual(expect.arrayContaining([expect.objectContaining({ id: salaryTrip?.salary?.transactionId, kind: 'loon', amount: 1200, tripId: 'upg-trip-salaris', deletedAt: null })]))
    expect(trips.find((t) => t.id === 'upg-trip-1')).toMatchObject({ participants: [{ id: 'upg-p-1', country: 'VS', tag: 'B', guestId: 'upg-p-0' }, { id: 'upg-p-2', country: 'NL' }] })
  } finally {
    await server.close()
  }
})

test('telefoon van 28 oktober: checklists onleesbaar op GitHub, lus op het herstelscherm → nieuwe versie, weer in de app', async ({ browser }) => {
  test.setTimeout(180_000)
  const data = readData()
  const github = githubWith(data)
  github.files.set('checklists.json.enc', { sha: 'sha-onleesbaar', content: foreignCiphertext() })
  // GitHub geeft vlak na schrijven nog de oude versie terug: zo ontstond de lus.
  github.staleReadsAfterPut = 2
  const server = await startStaticServer(nextPort(), `${previous}src/dist/`)
  try {
    const phone = await newContext(browser)
    const page = await phone.newPage()
    await mockGithub(page, github)
    await page.goto(server.url)
    await link(page)
    // Een release van vóór de fix (zoals bf82158 op de telefoon) toont het herstelscherm, en "Herstellen" komt terug op
    // hetzelfde scherm; een nieuwere release herstelt checklists vanzelf (Gesynct). Wachten tot een van beide er staat.
    const synced = page.getByRole('status').first().getByText(L('sync.synced'), { exact: true })
    await expect(repairHeading(page).or(synced)).toBeVisible({ timeout: 20_000 })
    if (await repairHeading(page).isVisible()) {
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await page.getByRole('button', { name: L('repair.button') }).click()
      await expect(repairHeading(page)).toBeVisible({ timeout: 20_000 })
      test.info().annotations.push({ type: 'vorige release', description: 'lus op het herstelscherm nagebootst' })
    }

    // Tik 1: de app sluiten en opnieuw openen. De nieuwe versie neemt het over, ook vanaf het herstelscherm.
    const taps = await deployAndReopen(page, server)
    expect(taps).toBe(0)
    // Tik 2 (plus de wachtzin typen): ontgrendelen. Geen herstelscherm meer.
    await expect(todayHeading(page).or(unlockButton(page))).toBeVisible({ timeout: 30_000 })
    await expect(repairHeading(page)).toHaveCount(0)
    if (await unlockButton(page).isVisible()) {
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await unlockButton(page).click()
    }
    await expect(todayHeading(page)).toBeVisible({ timeout: 30_000 })
    // Checklists herstelt de app vanzelf; de rest werkt gewoon.
    await expectSynced(page)
    await page.getByRole('status').first().click()
    await expectSynced(page)
    await phone.close()
    github.staleReadsAfterPut = 0
    await cleanDeviceReadsAll(browser, server, github, data, ['checklists.json.enc'])
  } finally {
    await server.close()
  }
})

for (const state of ['eerste keer', 'ontgrendelen', 'herstellen'] as const) {
  test(`de vorige release werkt zich bij vanuit het scherm ${state}`, async ({ browser }) => {
    test.setTimeout(120_000)
    const data = readData()
    const github = githubWith(data)
    const server = await startStaticServer(nextPort(), `${previous}src/dist/`)
    try {
      const context = await newContext(browser)
      const page = await context.newPage()
      await mockGithub(page, github)
      await page.goto(server.url)
      if (state !== 'eerste keer') {
        await link(page)
        await expectSynced(page)
        if (state === 'herstellen') {
          // Lokale dagen onleesbaar (andere sleutel): na ontgrendelen het herstelscherm over de hele app.
          await page.evaluate(
            () =>
              new Promise<void>((resolve, reject) => {
                const open = indexedDB.open('logboek')
                open.onerror = () => reject(open.error)
                open.onsuccess = () => {
                  const tx = open.result.transaction('objects', 'readwrite')
                  const store = tx.objectStore('objects')
                  const get = store.get('legs.json.enc')
                  get.onsuccess = () => {
                    const blob = new Uint8Array(get.result.blob as Uint8Array)
                    blob[20] = blob[20]! ^ 0xff
                    store.put({ ...get.result, blob })
                  }
                  tx.oncomplete = () => {
                    open.result.close()
                    resolve()
                  }
                }
              }),
          )
        }
        await lock(page)
        if (state === 'herstellen') {
          await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
          await unlockButton(page).click()
          await expect(repairHeading(page)).toBeVisible({ timeout: 20_000 })
        }
      }
      const taps = await deployAndReopen(page, server)
      // Vanaf de eerste keer hoogstens de tik op "Herladen" (oudere releases hielden daar een update tegen tot je
      // weer bij het keuzescherm was); vanaf ontgrendelen en herstellen helemaal vanzelf.
      expect(taps, state).toBeLessThanOrEqual(state === 'eerste keer' ? 1 : 0)
      await context.close()
    } finally {
      await server.close()
    }
  })
}
