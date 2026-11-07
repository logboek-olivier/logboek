import { expect, test, type Browser, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { META_PATH, parseMeta, unlock } from '../../src/crypto/keys'
import { decryptObject } from '../../src/crypto/encrypt'
import { translate } from '../../src/i18n'
import { WRITER_VERSION } from '../../src/model/schema'
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
/** Een verzonnen foto van 1 × 1 pixel. */
const NEP_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
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
// Na het koppelen aan geld van vóór één waarheid voor geld: eenmalig het scherm Geld omzetten (src/domain/geld-omzetten.ts).
const conversionHeading = (page: Page) => page.getByRole('heading', { name: L('convert.title') })
const unlockButton = (page: Page) => page.getByRole('button', { name: L('unlock.unlock') })

async function link(page: Page): Promise<void> {
  await page.getByRole('button', { name: L('setup.link') }).click()
  await enterToken(page)
  await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: L('setup.linkButton') }).click()
  await expect(todayHeading(page).or(repairHeading(page)).or(conversionHeading(page))).toBeVisible({ timeout: 30_000 })
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
  // Gouden regel: relaties veranderen niet. Elke voorbeelddag, -transactie, -planning en -student hangt nog aan dezelfde
  // trip, elke voorbeeldtrip heeft nog dezelfde deelnemers, en een voorbeeldtrip zonder eigen datums heeft er nog geen.
  const LINKS: Array<[string, 'tripId' | 'weekId']> = [
    ['legs.json.enc', 'tripId'],
    ['transactions.json.enc', 'tripId'],
    ['plans.json.enc', 'tripId'],
    ['claims.json.enc', 'tripId'],
    ['students.json.enc', 'weekId'],
  ]
  const readAll = async (path: string) =>
    github.files.has(path) ? ((await decryptRecords(key, path, Uint8Array.from(Buffer.from(github.files.get(path)!.content, 'base64')))) as unknown as Array<Record<string, unknown>>) : []
  for (const [path, field] of LINKS) {
    if (startedUnreadable.includes(path) || !data.paths.includes(path)) continue
    const records = new Map((await readAll(path)).map((r) => [r.id, r]))
    for (const sample of UPGRADE_SAMPLES[path] ?? []) {
      const now = records.get(sample.id)
      if (now && now.deletedAt === null && sample.deletedAt === null) expect(now[field] ?? null, `${path} ${String(sample.id)}`).toBe(sample[field] ?? null)
    }
  }
  if (!startedUnreadable.includes('trips.json.enc') && data.paths.includes('trips.json.enc')) {
    const trips = new Map((await readAll('trips.json.enc')).map((r) => [r.id, r]))
    for (const sample of UPGRADE_SAMPLES['trips.json.enc'] ?? []) {
      const now = trips.get(sample.id)
      if (!now || now.deletedAt !== null) continue
      const ids = (r: Record<string, unknown>) => ((r.participants as Array<{ id: string }> | undefined) ?? []).map((p) => p.id).sort()
      expect(ids(now), `deelnemers ${String(sample.id)}`).toEqual(ids(sample))
      if (String(sample.id).startsWith('upg-gouden-')) expect([now.startDate, now.endDate], `datums ${String(sample.id)}`).toEqual([undefined, undefined])
    }
  }
  // Bestanden die de vorige release niet kende (zoals periods.json.enc): als ze op GitHub staan, zijn ze leesbaar.
  for (const path of COLLECTION_PATHS) {
    if (data.paths.includes(path) || !github.files.has(path)) continue
    await decryptRecords(key, path, Uint8Array.from(Buffer.from(github.files.get(path)!.content, 'base64')))
  }
  // Minimale schrijfversie: na een volledige sync met deze release draagt elk bestand op GitHub zijn schrijfversie (ook wat
  // deze release niet veranderde, één keer opnieuw geschreven), zodat een build met een lagere er niet overheen schrijft.
  for (const path of COLLECTION_PATHS) {
    const file = github.files.get(path)
    if (!file) continue
    const raw = JSON.parse(new TextDecoder().decode(await decryptObject(key, path, Uint8Array.from(Buffer.from(file.content, 'base64'))))) as { minWriterVersion?: number }
    expect(raw.minWriterVersion, path).toBe(WRITER_VERSION)
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
    // Na de eerste sync kan het scherm Geld omzetten al over Vandaag liggen (eenmalig, na een tik).
    await expect(todayHeading(page).or(unlockButton(page)).or(conversionHeading(page))).toBeVisible({ timeout: 30_000 })
    if (await unlockButton(page).isVisible()) {
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await unlockButton(page).click()
    }
    await page.getByRole('status').first().click()
    await expectSynced(page)
    const puts = (path: string) => github.requests.filter((r) => r.method === 'PUT' && r.url.includes(path)).length
    // Periodemodel (docs/PERIODEMODEL.md): na de eerste geslaagde sync zet de app de agenda één keer om. De reisdag van
    // het voorbeeld (met gegevens: blijft staan) en de thuis- en rustdagen worden periodes; geld verhuist niet mee.
    await expect.poll(() => github.files.has('periods.json.enc'), { timeout: 30_000 }).toBe(true)
    await expectSynced(page)
    {
      const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
      const key = await unlock(meta, { passphrase: PASSPHRASE })
      const read = async (path: string) => decryptRecords(key, path as never, Uint8Array.from(Buffer.from(github.files.get(path)!.content, 'base64')))
      const stays = await read('periods.json.enc')
      expect(stays.map((r) => r.id)).toEqual(expect.arrayContaining(['periode:reis:2026-10-25', 'periode:thuis:2026-11-10', 'periode:vrij:2026-11-12']))
      const calendar = await read('calendar.json.enc')
      expect(calendar.find((r) => r.id === 'dag:2026-10-25')?.deletedAt).toBeNull()
      expect(calendar.find((r) => r.id === 'dag:2026-11-10')?.deletedAt).not.toBeNull()
      const transactions = await read('transactions.json.enc')
      // Geld koppelt deze versie bij de omzetting niet vanzelf (nooit stil koppelen): het staat in Nakijken met een
      // voorstel. Een vorige release mét periodemodel kan het bij zijn eigen omzetting al aan de thuisperiode gehangen
      // hebben; dat laat deze versie staan (ook nooit stil ontkoppelen). Vanaf een release zonder periodemodel (job
      // upgrade-ouder) blijft het dus ongekoppeld.
      expect([undefined, 'periode:thuis:2026-11-10']).toContain((transactions.find((r) => r.id === 'upg-tx-thuis') as { tripId?: string } | undefined)?.tripId)
    }
    // Eén waarheid voor geld (src/domain/geld-omzetten.ts): na de update eenmalig het scherm "Geld omzetten", met alleen
    // aantallen. Pas na een tik verandert er iets: het salaris van de tocht wordt een transactie, contant en gestort gaan weg.
    const conversion = page.locator('.money-conversion')
    await expect(conversion).toBeVisible({ timeout: 30_000 })
    await expect(conversion).toContainText(translate('nl', 'convert.cashMarks', { n: 3 }))
    const moneyPuts = puts('transactions.json.enc')
    await conversion.getByRole('button', { name: L('convert.button') }).click()
    await expect(conversion).toHaveCount(0)
    await expect.poll(() => puts('transactions.json.enc'), { timeout: 20_000 }).toBeGreaterThan(moneyPuts)
    await expectSynced(page)
    {
      const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
      const key = await unlock(meta, { passphrase: PASSPHRASE })
      const read = async (path: string) => decryptRecords(key, path as never, Uint8Array.from(Buffer.from(github.files.get(path)!.content, 'base64')))
      await expect.poll(async () => (await read('trips.json.enc')).filter((x) => 'salary' in x).length, { timeout: 20_000 }).toBe(0)
      const money = await read('transactions.json.enc')
      expect(money.filter((x) => 'tipVia' in x || 'depositedAt' in x)).toEqual([])
      expect(money).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'salaris:upg-trip-salaris', kind: 'loon', amount: 1200, currency: 'EUR', status: 'verwacht', tripId: 'upg-trip-salaris', deletedAt: null }),
          expect.objectContaining({ kind: 'loon', amount: 0, status: 'geen', tripId: 'upg-trip-geen-salaris', deletedAt: null }),
          // De fooien blijven met hetzelfde bedrag op hun eigen datum staan.
          expect.objectContaining({ id: 'upg-tx-4', amount: 20, currency: 'USD', date: '2026-10-22', deletedAt: null }),
        ]),
      )
    }
    // Na de update controleert de app vanzelf (Controleer nu), met de schrijver per bestand uit de commits.
    await expect.poll(() => github.requests.some((r) => r.method === 'GET' && r.url.includes('/commits?path=')), { timeout: 30_000 }).toBe(true)
    // Een trip uit Toevoegen → Dag (datesFromDays): een dag vlak erna; het formulier zegt "Opslaan verlengt …" en de tik op
    // Opslaan verlengt hem (nooit vanzelf, CLAUDE.md uitgangspunt 2).
    await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
    await page.getByLabel(L('field.date'), { exact: true }).fill('2026-10-13')
    await page.getByRole('combobox', { name: L('field.week'), exact: true }).selectOption({ label: 'Nepdag upgrade' })
    await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')
    await expect(page.locator('.placement-hint')).toContainText('Nepdag upgrade')
    const legPuts = puts('legs.json.enc')
    await page.getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('legs.json.enc'), { timeout: 20_000 }).toBeGreaterThan(legPuts)
    await expectSynced(page)
    // De melding "Dag opgeslagen" ligt anders over de knop Opslaan van de volgende invoer.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    // Agenda: een dag thuis maken (periods.json.enc: een periode aan land), synchroniseren.
    const calendarPuts = puts('periods.json.enc')
    await page.getByRole('navigation').getByRole('button', { name: L('nav.calendar'), exact: true }).click()
    await page.locator('.cal-day.today').click()
    // Eerst de dagkaart; de dagsoort kiezen via het potlood.
    await page.getByRole('dialog').getByRole('button', { name: L('common.edit') }).click()
    await page.getByRole('dialog').getByRole('radio', { name: L('dayType.thuis') }).click()
    await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
    await expect(page.locator('.cal-day.today')).toHaveClass(/day-thuis/)
    // Wachten tot de wijziging echt op GitHub staat ("Gesynct" kan nog de status van vóór de wijziging zijn).
    await expect.poll(() => puts('periods.json.enc'), { timeout: 20_000 }).toBeGreaterThan(calendarPuts)
    await expectSynced(page)
    // Fooi per persoon (nieuwe velden in trips en transacties): een fooi van één deelnemer van de voorbeeldtrip.
    await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
    await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
    await page.getByLabel(L('field.amount')).fill('25')
    // De tochtkiezer (alle tochten, met zoeken).
    await page.getByRole('button', { name: new RegExp(`^${L('field.trip')}: `) }).click()
    await page.getByRole('dialog', { name: L('tripPicker.title') }).locator('.trip-pick', { hasText: 'Nepweek upgrade' }).click()
    await page.getByRole('button', { name: 'Nepnick', exact: true }).click()
    const tipPuts = puts('transactions.json.enc')
    await page.getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('transactions.json.enc'), { timeout: 20_000 }).toBeGreaterThan(tipPuts)
    await expectSynced(page)
    // Teller per organisatie (nieuwe velden in de instellingen): beginnummer Yacht Week, het voorbeeld voor SV blijft.
    // Na opslaan terug waar je was (de agenda): Toevoegen is dicht.
    await expect(page.locator('.add-layer')).toHaveCount(0)
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
    // Salaris per tocht (één loon-transactie met een status): Vandaag vraagt na de einddatum of het verwachte salaris
    // binnen is; "Ja" zet die ene transactie op ontvangen.
    await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
    const salaryQuestion = page.locator('.salary-question', { hasText: 'Nepsalaris upgrade' })
    await expect(salaryQuestion).toBeVisible()
    const salaryPuts = puts('transactions.json.enc')
    await salaryQuestion.getByRole('button', { name: L('salary.yes'), exact: true }).click()
    await expect.poll(() => puts('transactions.json.enc'), { timeout: 20_000 }).toBeGreaterThan(salaryPuts)
    await expectSynced(page)
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    // Weekafsluiting (weekreviews.json.enc, nieuw in ronde 2): de week van vandaag afsluiten via de dagkaart van de
    // zondag in de agenda; het nieuwe bestand ontstaat bij de sync.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    const closingPuts = puts('weekreviews.json.enc')
    await page.getByRole('navigation').getByRole('button', { name: L('nav.calendar'), exact: true }).click()
    await page.locator('.cal-week', { has: page.locator('.cal-day.today') }).locator('.cal-day.col-7').click()
    await page.getByRole('dialog').getByRole('button', { name: /^Week \d+ afsluiten$/ }).click()
    await page.getByRole('dialog', { name: /^Week \d+ afsluiten$/ }).getByRole('radio', { name: '7', exact: true }).click()
    await page.getByRole('dialog', { name: /^Week \d+ afsluiten$/ }).getByRole('button', { name: L('weekClose.save') }).click()
    await expect.poll(() => puts('weekreviews.json.enc'), { timeout: 20_000 }).toBeGreaterThan(closingPuts)
    await expectSynced(page)
    // Doelen en skills (goals, skills en sessions, nieuw in ronde 2): een skill toevoegen en een sessie loggen via
    // Toevoegen → Skill; de nieuwe bestanden ontstaan bij de sync.
    await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
    const sessionPuts = puts('sessions.json.enc')
    await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
    await page.getByRole('tab', { name: L('quick.tabSkill') }).click()
    await page.getByRole('button', { name: L('goals.newSkill') }).click()
    await page.getByRole('dialog').getByRole('button', { name: L('goals.skill.kitesurfen') }).click()
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('combobox', { name: L('goals.whatLog') }).selectOption({ label: L('goals.skill.kitesurfen') })
    await page.getByLabel(L('goals.minutesField')).fill('45')
    await page.getByRole('button', { name: L('goals.logSession') }).click()
    await expect.poll(() => puts('sessions.json.enc'), { timeout: 20_000 }).toBeGreaterThan(sessionPuts)
    await expect.poll(() => puts('skills.json.enc'), { timeout: 20_000 }).toBeGreaterThan(0)
    await expectSynced(page)
    // Kluis (documents/index.json.enc en een documentbestand, nieuw in ronde 2): een nepdocument toevoegen.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    await openMore(page, L('vault.screen'), L('nav.more'))
    await page.getByRole('button', { name: L('vault.add') }).click()
    await page.getByLabel(L('vault.chooseFile')).setInputFiles({ name: 'nep.png', mimeType: 'image/png', buffer: Buffer.from(NEP_PNG, 'base64') })
    await expect(page.locator('.vault-preview')).toBeVisible()
    await page.getByRole('dialog').getByLabel(L('vault.titleField')).fill('Nepdocument upgrade')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => github.requests.filter((r) => r.method === 'PUT' && /documents\/[0-9a-f-]{36}\.bin/.test(r.url)).length, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect.poll(() => puts('documents/index.json.enc'), { timeout: 20_000 }).toBeGreaterThan(0)
    await expectSynced(page)
    // Carrière (career.json.enc, nieuw in ronde 2): een sollicitatie toevoegen.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    await openMore(page, L('career.screen'), L('nav.more'))
    // Het lege bestand kan bij de eerste sync na de update al ontstaan zijn: wachten op de schrijfactie ná het opslaan.
    const careerPuts = puts('career.json.enc')
    await page.getByRole('button', { name: L('career.newApplication') }).click()
    await page.getByRole('dialog').getByLabel(L('career.company')).fill('Nepwerf')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => puts('career.json.enc'), { timeout: 20_000 }).toBeGreaterThan(careerPuts)
    await expectSynced(page)
    // Rekeningen (accounts.json.enc en balances.json.enc, nieuw in ronde 2): een rekening met een stand met de hand.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    await openMore(page, L('accounts.screen'), L('nav.more'))
    const balancePuts = puts('balances.json.enc')
    await page.getByRole('button', { name: L('accounts.add') }).click()
    await page.getByRole('dialog').getByLabel(L('accounts.name')).fill('Nepbank upgrade')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.row-button', { hasText: 'Nepbank upgrade' }).click()
    await page.getByRole('dialog').getByLabel(L('accounts.standAmount'), { exact: true }).fill('321')
    await page.getByRole('dialog').getByRole('button', { name: L('accounts.updateStand') }).click()
    await expect.poll(() => puts('balances.json.enc'), { timeout: 20_000 }).toBeGreaterThan(balancePuts)
    await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
    await expectSynced(page)
    // Vaste lasten (fixedcosts.json.enc, nieuw in ronde 3): een vaste last toevoegen onder Geld → Verwacht → Kosten.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    await openMore(page, L('nav.money'), L('nav.more'))
    await page.getByRole('tab', { name: L('money.expected') }).click()
    const fixedPuts = puts('fixedcosts.json.enc')
    await page.getByRole('button', { name: L('costs.addFixed') }).click()
    await page.getByRole('dialog').getByLabel(L('costs.name')).fill('Nephuur upgrade')
    await page.getByRole('dialog').getByLabel(L('costs.amount')).fill('500')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('fixedcosts.json.enc'), { timeout: 20_000 }).toBeGreaterThan(fixedPuts)
    await expectSynced(page)
    // Scenario's (scenarios.json.enc, nieuw in november 2026): Verwacht → Scenario, een scenario met één blok.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('radio', { name: L('forecast.scenario'), exact: true }).click()
    const scenarioPuts = puts('scenarios.json.enc')
    const createScenario = page.getByRole('button', { name: L('scenario.create') })
    if ((await createScenario.count()) > 0) await createScenario.click()
    else await page.getByRole('button', { name: L('scenario.new') }).click()
    await page.getByRole('dialog').getByLabel(L('scenario.name')).fill('Nepscenario upgrade')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    // Een blok toevoegen en in de velden typen (zoals in Excel): 4 weken, 4 trips van € 1.000.
    await page.getByRole('button', { name: L('scenario.addBlock') }).click()
    const blockName = translate('nl', 'scenario.blockN', { n: 1 })
    await expect(page.getByLabel(`${L('scenarioPlan.salaryPerTrip')}: ${blockName}`)).toBeVisible()
    await page.getByLabel(`${L('scenarioPlan.salaryPerTrip')}: ${blockName}`).fill('1000')
    await page.getByLabel(`${L('scenarioPlan.salaryPerTrip')}: ${blockName}`).press('Enter')
    await expect.poll(() => puts('scenarios.json.enc'), { timeout: 20_000 }).toBeGreaterThan(scenarioPuts)
    await page.getByRole('radio', { name: L('forecast.planned'), exact: true }).click()
    await expectSynced(page)
    // Declaraties (claims.json.enc, nieuw in ronde 3): een declaratie zonder bonnetje.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    const claimPuts = puts('claims.json.enc')
    await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
    await page.getByRole('tab', { name: L('quick.tabClaim') }).click()
    await page.getByLabel(L('claims.note')).fill('Nepdeclaratie upgrade')
    await page.getByLabel(L('claims.amount')).fill('12')
    await page.getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('claims.json.enc'), { timeout: 20_000 }).toBeGreaterThan(claimPuts)
    await expectSynced(page)
    // Berichtsjablonen (templates.json.enc, nieuw in november 2026): het meegeleverde afsluitingssjabloon aanpassen.
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
    const templatePuts = puts('templates.json.enc')
    await openMore(page, L('nav.messages'), L('nav.more'))
    await page.locator('.message-templates .section', { hasText: L('msgKind.afsluiting') }).getByRole('button', { name: /Engels/ }).first().click()
    await page.getByRole('dialog').getByRole('textbox', { name: L('msg.text'), exact: true }).fill('Thanks {voornamen gasten}, nepafsluiting upgrade.')
    await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
    await expect.poll(() => puts('templates.json.enc'), { timeout: 20_000 }).toBeGreaterThan(templatePuts)
    await expectSynced(page)
    await phone.close()
    await cleanDeviceReadsAll(browser, server, github, data)
    // Het schone apparaat leest ook de agenda: de nieuwe thuisdag staat als periode in periods.json.enc (periodemodel),
    // naast de voorbeelden als de vorige release de agenda al kende.
    const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
    const key = await unlock(meta, { passphrase: PASSPHRASE })
    const calendar = await decryptRecords(key, 'calendar.json.enc', Uint8Array.from(Buffer.from(github.files.get('calendar.json.enc')!.content, 'base64')))
    const stays = await decryptRecords(key, 'periods.json.enc', Uint8Array.from(Buffer.from(github.files.get('periods.json.enc')!.content, 'base64')))
    expect(stays).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'thuis', deletedAt: null })]))
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
    // Geen contant of gestort meer; het deel van de uitbetaling blijft een ontvangen loon.
    expect(transactions.filter((tx) => 'tipVia' in tx || 'depositedAt' in tx)).toEqual([])
    expect(transactions.find((tx) => tx.id === 'upg-tx-payout')).toMatchObject({ payoutId: 'upg-payout-1', amount: 900, deletedAt: null })
    const settings = await decryptRecords(key, 'settings.json.enc', Uint8Array.from(Buffer.from(github.files.get('settings.json.enc')!.content, 'base64')))
    expect(settings.find((s) => s.id === 'settings')).toMatchObject({
      orgFirst: { 'sailing-virgins': 3, 'yacht-week': 10 },
      orgAnswered: ['upg-trip-0'],
      salaryDefaults: { 'sailing-virgins': { amount: 1100, currency: 'EUR' } },
      dailyReminder: { time: '19:30', workdaysOnly: true },
      payouts: { 'yacht-week': { kind: 'maandelijks', day: 5 } },
      careerStart: '2026-09-01',
      costDefaults: { thuis: 25, reis: 40 },
      lastCostCategory: 'eten',
    })
    // Het record van het andere apparaat met de valuta per soort invoer (schrijfversie 10) is er nog, compleet.
    expect(settings.find((s) => s.id === 'laatst:0a1b2c3d')).toMatchObject({ lastBoat: 'Nepboot ander apparaat', lastCurrencies: { fooi: 'USD', uitgave: 'EUR' } })
    const trips = await decryptRecords(key, 'trips.json.enc', Uint8Array.from(Buffer.from(github.files.get('trips.json.enc')!.content, 'base64')))
    expect(trips.find((t) => t.id === 'upg-trip-dag')).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-13', datesFromDays: true })
    const legs = await decryptRecords(key, 'legs.json.enc', Uint8Array.from(Buffer.from(github.files.get('legs.json.enc')!.content, 'base64')))
    expect(legs).toEqual(expect.arrayContaining([expect.objectContaining({ tripId: 'upg-trip-dag', date: '2026-10-13', deletedAt: null })]))
    // Het salaris is ontvangen: dezelfde ene transactie (vast id), het bedrag blijft; de tocht heeft geen salaris-veld meer.
    expect(trips.find((t) => t.id === 'upg-trip-salaris')).not.toHaveProperty('salary')
    expect((transactions as unknown as { kind: string; tripId?: string; deletedAt: string | null }[]).filter((tx) => tx.kind === 'loon' && tx.tripId === 'upg-trip-salaris' && tx.deletedAt === null)).toEqual([expect.objectContaining({ id: 'salaris:upg-trip-salaris', amount: 1200, status: 'ontvangen' })])
    expect(trips.find((t) => t.id === 'upg-trip-1')).toMatchObject({ participants: [{ id: 'upg-p-1', country: 'VS', tag: 'B', guestId: 'upg-p-0' }, { id: 'upg-p-2', country: 'NL', role: 'medezeiler' }] })
    // De weekafsluiting staat leesbaar op GitHub (naast het voorbeeld als de vorige release het bestand al kende).
    const closings = await decryptRecords(key, 'weekreviews.json.enc', Uint8Array.from(Buffer.from(github.files.get('weekreviews.json.enc')!.content, 'base64')))
    expect(closings).toEqual(expect.arrayContaining([expect.objectContaining({ rating: 7, deletedAt: null })]))
    // De skill en de sessie staan leesbaar op GitHub.
    const skills = await decryptRecords(key, 'skills.json.enc', Uint8Array.from(Buffer.from(github.files.get('skills.json.enc')!.content, 'base64')))
    const kite = skills.find((x) => (x as { name?: string }).name === L('goals.skill.kitesurfen'))
    expect(kite).toBeDefined()
    const sessions = await decryptRecords(key, 'sessions.json.enc', Uint8Array.from(Buffer.from(github.files.get('sessions.json.enc')!.content, 'base64')))
    expect(sessions).toEqual(expect.arrayContaining([expect.objectContaining({ skillId: kite!.id, minutes: 45, deletedAt: null })]))
    // Het document: de index noemt het bestand met een willekeurige naam, en het bestand ontsleutelt tot een JPEG.
    const documents = await decryptRecords(key, 'documents/index.json.enc', Uint8Array.from(Buffer.from(github.files.get('documents/index.json.enc')!.content, 'base64')))
    const doc = documents.find((d) => (d as { title?: string }).title === 'Nepdocument upgrade') as { fileId: string } | undefined
    expect(doc).toBeDefined()
    expect([...github.files.keys()].some((path) => path.includes('Nepdocument'))).toBe(false)
    const docPath = `documents/${doc!.fileId}.bin`
    const plain = await decryptObject(key, docPath, Uint8Array.from(Buffer.from(github.files.get(docPath)!.content, 'base64')))
    expect([plain[0], plain[1]]).toEqual([0xff, 0xd8])
    const career = await decryptRecords(key, 'career.json.enc', Uint8Array.from(Buffer.from(github.files.get('career.json.enc')!.content, 'base64')))
    expect(career).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'sollicitatie', company: 'Nepwerf', status: 'gesolliciteerd', deletedAt: null })]))
    // De rekening en zijn stand staan leesbaar op GitHub.
    const accounts = await decryptRecords(key, 'accounts.json.enc', Uint8Array.from(Buffer.from(github.files.get('accounts.json.enc')!.content, 'base64')))
    const bank = accounts.find((a) => (a as { name?: string }).name === 'Nepbank upgrade')
    expect(bank).toMatchObject({ provider: 'asn', kind: 'betaal', currency: 'EUR', deletedAt: null })
    const balances = await decryptRecords(key, 'balances.json.enc', Uint8Array.from(Buffer.from(github.files.get('balances.json.enc')!.content, 'base64')))
    expect(balances).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: bank!.id, amount: 321, source: 'handmatig', deletedAt: null })]))
    // Saldo-geschiedenis: de nieuwe stand heeft een id per dag; de standen van de vorige release (een id per maand en
    // een per dag in dezelfde maand) blijven allebei staan.
    expect((balances.find((b) => (b as { accountId?: string }).accountId === bank!.id) as unknown as { id: string }).id).toMatch(/^stand:.+:\d{4}-\d{2}-\d{2}$/)
    // (Alleen als de vorige release het bestand al kende; een release van vóór de rekeningen schreef geen voorbeeld.)
    const sampleBalances = balances.map((b) => (b as { id: string }).id).filter((id) => id.startsWith('stand:upg-acc-1:'))
    if (sampleBalances.length > 0) expect(sampleBalances).toEqual(expect.arrayContaining(['stand:upg-acc-1:2026-09', 'stand:upg-acc-1:2026-09-02']))
    // De vaste last staat leesbaar op GitHub (naast het voorbeeld als de vorige release het bestand al kende); de soort
    // van een uitgave, de schatting bij de weekafsluiting en de standaardbedragen komen ongeschonden over.
    // Het scenario staat leesbaar op GitHub, met zijn blok (het stappenplan: salaris apart, de som als inkomen).
    const scenarios = await decryptRecords(key, 'scenarios.json.enc', Uint8Array.from(Buffer.from(github.files.get('scenarios.json.enc')!.content, 'base64')))
    expect(scenarios).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Nepscenario upgrade', version: 2, blocks: [expect.objectContaining({ weeks: 4, trips: 4, salaryPerTrip: 1000, incomePerWeek: 1000, salaryPerWeek: 1000, tipsPerWeek: 0 })], deletedAt: null })]))
    // Het voorbeeld-stappenplan komt ongeschonden over (alleen als de vorige release het al schreef).
    const stepped = scenarios.find((sc) => (sc as { id: string }).id === 'upg-scenario-2')
    if (stepped) expect(stepped).toMatchObject({ version: 2, startValue: 4000, goal: { kind: 'doel', amount: 25000, by: '2028-01-31' }, blocks: [expect.objectContaining({ salaryPerWeek: 1000, tipsPerWeek: 300 }), expect.objectContaining({ trips: 10, salaryPerTrip: 1200, tipsPerTrip: 300 })] })
    // De verwachte fooi van de voorbeeldtrip (alleen als de vorige release het veld al kende of liet staan).
    const sampleTrip = trips.find((t) => t.id === 'upg-trip-1') as { expectedTip?: unknown } | undefined
    if (sampleTrip?.expectedTip) expect(sampleTrip.expectedTip).toEqual({ amount: 400, currency: 'USD' })
    const claims = await decryptRecords(key, 'claims.json.enc', Uint8Array.from(Buffer.from(github.files.get('claims.json.enc')!.content, 'base64')))
    expect(claims).toEqual(expect.arrayContaining([expect.objectContaining({ note: 'Nepdeclaratie upgrade', amount: 12, status: 'open', deletedAt: null })]))
    const fixed = await decryptRecords(key, 'fixedcosts.json.enc', Uint8Array.from(Buffer.from(github.files.get('fixedcosts.json.enc')!.content, 'base64')))
    expect(fixed).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Nephuur upgrade', amounts: [expect.objectContaining({ amount: 500 })], deletedAt: null })]))
    expect(transactions.find((tx) => tx.id === 'upg-tx-kosten')).toMatchObject({ category: 'eten' })
    expect(transactions.find((tx) => tx.id === 'upg-tx-claim')).toMatchObject({ claimId: 'upg-claim-1' })
    // De nieuwe declaratie met bedrag is ook een uitgave, met haar claimId.
    const newClaim = claims.find((c) => (c as { note?: string }).note === 'Nepdeclaratie upgrade')!
    expect(transactions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'kosten', amount: 12, claimId: newClaim.id })]))
    // Soorten declaratie (schemaversie 9): het voorschot en de schuld komen ongeschonden over; een schuld is geen uitgave.
    const debt = claims.find((c) => c.id === 'upg-claim-4')
    if (debt) {
      expect(debt).toMatchObject({ kind: 'schuld', person: 'Nepjoep', status: 'open' })
      expect(claims.find((c) => c.id === 'upg-claim-3')).toMatchObject({ kind: 'voorgeschoten', person: 'Nepgaspar' })
      expect(transactions.some((tx) => (tx as { claimId?: string }).claimId === 'upg-claim-4')).toBe(false)
    }
    const reviews = await decryptRecords(key, 'weekreviews.json.enc', Uint8Array.from(Buffer.from(github.files.get('weekreviews.json.enc')!.content, 'base64')))
    // Het voorbeeld van de vorige release komt ongeschonden over (alleen als die release het bestand al kende).
    if (data.paths.includes('weekreviews.json.enc')) expect(reviews.find((r) => r.id === 'week:2026-W43')).toMatchObject({ spent: { amount: 85, currency: 'EUR' } })
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
    // Na de eerste sync kan het scherm Geld omzetten al over Vandaag liggen (eenmalig, na een tik).
    await expect(todayHeading(page).or(unlockButton(page)).or(conversionHeading(page))).toBeVisible({ timeout: 30_000 })
    await expect(repairHeading(page)).toHaveCount(0)
    if (await unlockButton(page).isVisible()) {
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await unlockButton(page).click()
    }
    await expect(todayHeading(page).or(conversionHeading(page))).toBeVisible({ timeout: 30_000 })
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
        // Een vorige release met één waarheid voor geld toont na de sync eenmalig "Geld omzetten": "Later".
        await conversionHeading(page)
          .waitFor({ timeout: 5_000 })
          .catch(() => undefined)
        if (await conversionHeading(page).isVisible()) await page.getByRole('button', { name: L('convert.later') }).click()
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
