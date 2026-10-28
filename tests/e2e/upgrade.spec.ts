import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { META_PATH, parseMeta, unlock } from '../../src/crypto/keys'
import { translate } from '../../src/i18n'
import { COLLECTION_PATHS } from '../../src/model/types'
import { decryptRecords } from '../../src/storage/sync'
import { UPGRADE_SAMPLES } from '../upgrade/upgrade-samples'
import { mockGithub, newGithub, type E2eGithub } from './helpers/fake-github'
import { enterToken, PASSPHRASE } from './helpers/logbook'
import { startStaticServer } from './helpers/static-server'

// Verplichte upgradetest (harde regel): gegevens van de vorige release, bijwerken in dezelfde browseropslag,
// synchroniseren, en daarna op een schoon apparaat koppelen met de wachtzin. Alle bestanden moeten leesbaar zijn en
// het herstelscherm mag nergens verschijnen. De vorige release staat in .vorige/ (npm run upgrade:vorige; CI doet dat
// vóór de Playwright-tests).

const previous = fileURLToPath(new URL('../../.vorige/', import.meta.url))
const current = fileURLToPath(new URL('../../dist/', import.meta.url))
const L = (key: Parameters<typeof translate>[1]) => translate('nl', key)

test.skip(!process.env.CI && !existsSync(`${previous}data.json`), 'Vorige release ontbreekt; eerst npm run upgrade:vorige')

function mainScript(html: string): string | null {
  return /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1] ?? null
}

async function link(page: Page): Promise<void> {
  await page.getByRole('button', { name: L('setup.link') }).click()
  await enterToken(page)
  await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
  await page.getByRole('button', { name: L('setup.linkButton') }).click()
  await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible({ timeout: 30_000 })
}

async function expectSynced(page: Page): Promise<void> {
  await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: L('repair.title') })).toHaveCount(0)
}

test('upgrade: vorige release → deze release in dezelfde opslag → schoon apparaat leest alles', async ({ browser }) => {
  test.setTimeout(180_000)
  const data = JSON.parse(readFileSync(`${previous}data.json`, 'utf8')) as { paths: string[]; files: Record<string, string> }
  const github: E2eGithub = newGithub()
  let n = 0
  for (const [path, content] of Object.entries(data.files)) github.files.set(path, { sha: `sha-vorige-${++n}`, content })
  const server = await startStaticServer(4175, `${previous}src/dist/`)
  try {
    // 1. De vorige release koppelt het logboek: lokale opslag in het formaat van die release.
    const phone = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'nl-NL' })
    const page = await phone.newPage()
    await mockGithub(page, github)
    await page.goto(server.url)
    await link(page)
    await expectSynced(page)
    await page.evaluate(() => navigator.serviceWorker.ready)

    // 2. Deploy van deze release; de app werkt zichzelf bij in dezelfde browseropslag.
    server.root = current
    const newScript = mainScript(readFileSync(`${current}index.html`, 'utf8'))
    expect(newScript).not.toBeNull()
    await page.reload()
    await expect
      .poll(async () => page.evaluate(() => document.querySelector('script[type="module"]')?.getAttribute('src') ?? null), { timeout: 60_000 })
      .toBe(newScript)
    // Binnen 5 minuten hervat de sessie; anders ontgrendelen met de wachtzin.
    const unlockButton = page.getByRole('button', { name: L('unlock.unlock') })
    await expect(page.getByRole('heading', { name: L('nav.today') }).or(unlockButton)).toBeVisible({ timeout: 30_000 })
    if (await unlockButton.isVisible()) {
      await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await unlockButton.click()
    }
    // 3. Synchroniseren met deze release.
    await page.getByRole('status').first().click()
    await expectSynced(page)
    await phone.close()

    // 4. Een schoon apparaat koppelt met de wachtzin.
    const clean = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'nl-NL' })
    const second = await clean.newPage()
    await mockGithub(second, github)
    await second.goto(server.url)
    await link(second)
    await expectSynced(second)
    await clean.close()

    // Elk bestand op GitHub is met de wachtzin te lezen, en elk voorbeeld van de vorige release staat er nog.
    const meta = parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8'))
    const key = await unlock(meta, { passphrase: PASSPHRASE })
    for (const path of COLLECTION_PATHS) {
      const file = github.files.get(path)
      if (!data.paths.includes(path)) continue
      expect(file, path).toBeDefined()
      const records = await decryptRecords(key, path, Uint8Array.from(Buffer.from(file!.content, 'base64')))
      for (const sample of UPGRADE_SAMPLES[path] ?? []) expect(records.map((r) => r.id), path).toContain(sample.id)
    }
  } finally {
    await server.close()
  }
})
