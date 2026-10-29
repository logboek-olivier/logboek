import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore, PASSPHRASE } from './helpers/logbook'

// Sleutel-invariant: "Sleutel past niet bij je logboek" (niets geschreven) en het herstelpad na ontgrendelen met de
// wachtzin als lokale gegevens onder een andere sleutel staan. Alle gegevens zijn verzonnen.

/** Geldige vorm (versie 1, iv, tag) maar onder geen enkele bekende sleutel versleuteld: ontsleutelen faalt. */
function foreignBytes(): number[] {
  const bytes = [1]
  for (let i = 1; i < 1 + 12 + 64 + 16; i++) bytes.push((i * 37) % 256)
  return bytes
}

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/sleutel/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1]) => translate(lang, key as 'common.next')

    test(`meta.json.enc op GitHub hoort bij een andere sleutel: scherm "Sleutel past niet", niets geschreven (${lang})`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const status = page.getByRole('status').first()
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Zelfde meta, maar het check-veld hoort bij een andere sleutel.
      const meta = github.files.get('meta.json.enc')!
      const parsed = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8')) as Record<string, unknown>
      parsed.check = Buffer.from(foreignBytes()).toString('base64')
      github.files.set('meta.json.enc', { sha: `${meta.sha}-ander`, content: Buffer.from(JSON.stringify(parsed)).toString('base64') })
      const puts = github.requests.filter((r) => r.method === 'PUT').length

      // Synchroniseren; de sync die vanzelf na een opslag start, kan het al eerder zien (dan is de knop al weg).
      await page
        .getByRole('button', { name: new RegExp(L('sync.now')) })
        .click({ timeout: 3_000 })
        .catch(() => undefined)
      await expect(page.getByRole('heading', { name: L('key.mismatchTitle') })).toBeVisible()
      await expect(page.getByRole('button', { name: L('error.copyDetails') })).toBeVisible()
      await expect(page.getByRole('navigation')).toHaveCount(0)
      expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(puts)
      expect(await page.evaluate(() => sessionKeyStored())).toBe(false)
      await shots(page, 'past-niet', lang)

      // Verversen hervat niet: de sessiesleutel is gewist. Ontgrendelen geeft hetzelfde scherm (GitHub hoort bij een
      // andere sleutel); de uitweg is opnieuw koppelen, met de lijst van wat verloren gaat, pas na een tik.
      await page.reload()
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await page.getByRole('button', { name: L('unlock.unlock') }).click()
      await expect(page.getByRole('heading', { name: L('key.mismatchTitle') })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.loss-list')).toContainText('settings.json.enc')
      await page.getByRole('button', { name: L('key.relink') }).click()
      await expect(page.getByRole('heading', { name: L('setup.title') })).toBeVisible()
      expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(puts)
      expect(errors).toEqual([])
    })

    test(`Logboek herstellen: toestand na PR #27, één tik, daarna Gesynct en de ASA-cursussen terug (${lang})`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Zoals op de telefoon: vier bestanden op GitHub en hun lokale kopieën onder een vreemde sleutel.
      const broken = ['transactions.json.enc', 'settings.json.enc', 'curricula.json.enc', 'students.json.enc']
      const oldShas = new Map<string, string>()
      for (const path of broken) {
        const file = github.files.get(path)!
        oldShas.set(path, `${file.sha}-vreemd`)
        github.files.set(path, { sha: `${file.sha}-vreemd`, content: Buffer.from(foreignBytes()).toString('base64') })
        await page.evaluate(([p, bytes]) => putForeignObject(p as string, bytes as number[]), [path, foreignBytes()] as const)
      }
      const tripsSha = github.files.get('trips.json.enc')!.sha
      const puts = github.requests.filter((r) => r.method === 'PUT').length
      // Openen: direct "Logboek herstellen", met in gewone taal wat er verloren gaat, nog vóór de wachtzin.
      await page.reload()
      await expect(page.getByRole('heading', { name: L('repair.title') })).toBeVisible({ timeout: 30_000 })
      const lost = page.locator('.loss-list')
      for (const key of ['key.file.transactions', 'key.file.settings', 'key.file.curricula', 'key.file.students'] as const) await expect(lost).toContainText(L(key))
      await expect(page.locator('.loss-list li')).toHaveCount(4)
      expect(github.requests.filter((r) => r.method === 'PUT').length).toBe(puts)
      await shots(page, 'herstellen', lang)

      // Tik plus wachtzin: herstellen.
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await page.getByRole('button', { name: L('repair.button') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      // Alleen de onleesbare bestanden vervangen, met de oude SHA als voorwaarde; leesbare bestanden niet aangeraakt.
      for (const path of broken) {
        const put = github.requests.find((r) => r.method === 'PUT' && r.url.endsWith(`/contents/${path}`) && r.body?.includes(oldShas.get(path)!))
        expect(put, path).toBeDefined()
      }
      expect(github.files.get('trips.json.enc')!.sha).toBe(tripsSha)
      await openMore(page, L('curriculum.courses'), L('nav.more'))
      await expect(page.getByRole('button', { name: /ASA 101/ })).toBeVisible()
      // Opnieuw openen: gewoon verder, geen herstelscherm meer.
      await page.reload()
      await expect(page.getByRole('heading', { name: L('repair.title') })).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test(`meta.json.enc op GitHub weg of kapot: met de wachtzin zet dit apparaat het logboek terug (${lang})`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const status = page.getByRole('status').first()
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })
      // Kapotte meta.json.enc op GitHub (geen ander logboek): niets schrijven zonder tik.
      github.files.set('meta.json.enc', { sha: 'sha-kapot', content: Buffer.from('{"kapot').toString('base64') })
      await page.getByRole('button', { name: new RegExp(L('sync.now')) }).click()
      const restore = page.getByRole('button', { name: L('key.metaRestore') })
      await expect(restore).toBeVisible({ timeout: 15_000 })
      expect(github.files.get('meta.json.enc')!.sha).toBe('sha-kapot')
      await shots(page, 'meta-terugzetten', lang)
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await restore.click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible({ timeout: 30_000 })
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect(github.files.get('meta.json.enc')!.sha).not.toBe('sha-kapot')
      // Repo helemaal leeg (bijvoorbeeld per ongeluk opnieuw aangemaakt): ook dan alles terug, met dezelfde knop.
      github.files.clear()
      await status.click()
      await expect(restore).toBeVisible({ timeout: 15_000 })
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await restore.click()
      await expect(status).toHaveText(L('sync.synced'), { timeout: 30_000 })
      expect([...github.files.keys()]).toEqual(expect.arrayContaining(['meta.json.enc', 'trips.json.enc', 'legs.json.enc']))
      expect(errors).toEqual([])
    })

    test(`nieuwe versies ruimen zelf oude versies, caches en vensters op (${lang})`, async ({ page }) => {
      const sw = await (await page.request.get('sw.js')).text()
      expect(sw).toContain('sw-vensters.js')
      expect(sw).toContain('skipWaiting')
      expect(sw).toContain('clientsClaim')
      expect(sw).toContain('cleanupOutdatedCaches')
      const extra = await (await page.request.get('sw-vensters.js')).text()
      expect(extra).toContain('navigate')
    })
  })
}

declare global {
  function sessionKeyStored(): Promise<boolean>
  function putForeignObject(path: string, bytes: number[]): Promise<void>
}

test.beforeEach(async ({ page }) => {
  // Hulpfuncties in de pagina (via addInitScript; de CSP van de app blokkeert dit niet).
  await page.addInitScript(() => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('logboek')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    globalThis.sessionKeyStored = async () => {
      const db = await open()
      const found = await new Promise<boolean>((resolve) => {
        const request = db.transaction('session').objectStore('session').get('masterKey')
        request.onsuccess = () => resolve(request.result !== undefined)
      })
      db.close()
      return found
    }
    globalThis.putForeignObject = async (path, bytes) => {
      const db = await open()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('objects', 'readwrite')
        tx.objectStore('objects').put({ path, blob: new Uint8Array(bytes), sha: 'oud' })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    }
  })
})
