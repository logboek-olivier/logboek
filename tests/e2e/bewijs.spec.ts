import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Onleesbare bestanden in Meer → Opslag: het bewijs (wie schreef wat, met welke versie, wat de app ermee kan) staat bij
// het bestand en in "Kopieer foutdetails"; "Alles herstellen" zet de leesbare kopie terug en leest terug; de
// service worker bewaart nooit iets van api.github.com. Alle gegevens verzonnen.

/** Geldige vorm (versie 1, iv, tag) maar onder een andere sleutel versleuteld: ontsleutelen faalt. */
function foreignCiphertext(): string {
  const bytes = new Uint8Array(1 + 12 + 64 + 16)
  bytes[0] = 1
  for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 41) % 256
  return Buffer.from(bytes).toString('base64')
}

async function cachedApiUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) urls.push(request.url)
    }
    return urls.filter((u) => u.startsWith('https://api.github.com'))
  })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })

    test(`onleesbaar: bewijs per bestand, Alles herstellen met teruglezen, geen API-antwoorden in de cache (${lang})`, async ({ page, context }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const status = page.getByRole('status').first()
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Een tweede schrijver (apparaat abcdef12, oudere versie) zet een onleesbare versie neer.
      const settings = github.files.get('settings.json.enc')!
      github.files.set('settings.json.enc', { sha: `${settings.sha}-vreemd`, content: foreignCiphertext(), message: 'sync 2026-10-29T23:44:00.000Z v1.0.0+0ld0000 dabcdef12' })
      await status.click()
      await expect(status).toHaveText(L('sync.unreadable', { paths: 'settings.json.enc' }), { timeout: 15_000 })

      // In Opslag: het bewijs bij het bestand.
      await openMore(page, L('nav.storage'), L('nav.more'))
      const row = page.locator('.storage-file', { hasText: L('storage.file.settings') })
      await expect(row.locator('.storage-evidence')).toBeVisible({ timeout: 15_000 })
      await expect(row.locator('.storage-evidence')).toContainText(L('storage.verdict.key'))
      await expect(row.locator('.storage-evidence')).toContainText(L('storage.writerOtherDevice', { id: 'abcdef12' }))
      await expect(row.locator('.storage-evidence')).toContainText(L('storage.verdict.readable'))
      for (const width of [360, 412]) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 800 })
          await page.emulateMedia({ colorScheme: scheme })
          await expectNoHorizontalOverflow(page)
          await row.scrollIntoViewIfNeeded()
          await page.screenshot({ path: `screenshots/bewijs/opslag-${width}-${scheme}-${lang}.png` })
        }
      }
      await page.setViewportSize({ width: 360, height: 800 })
      await page.emulateMedia({ colorScheme: 'light' })

      // Kopieer foutdetails: met het bewijs, zonder inhoud.
      await page.locator('.storage-repair').getByRole('button', { name: L('error.copyDetails') }).click()
      const report = await page.evaluate(() => navigator.clipboard.readText())
      expect(report).toContain('Bewijs settings.json.enc')
      expect(report).toContain('dabcdef12')
      expect(report).toContain('sleutel')

      // Alles herstellen: de leesbare kopie terug, teruggelezen via de blob-sha.
      await page.getByRole('button', { name: L('storage.repairAll') }).click()
      await expect(page.getByText(L('storage.repairAllDone', { n: 1 }))).toBeVisible({ timeout: 20_000 })
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const repaired = github.files.get('settings.json.enc')!.sha
      expect(repaired).not.toBe(`${settings.sha}-vreemd`)
      expect(github.requests.some((r) => r.url.endsWith(`/git/blobs/${repaired}`))).toBe(true)
      await page.getByRole('button', { name: L('storage.checkNow') }).click()
      await expect(page.locator('.storage-ok')).toBeVisible({ timeout: 20_000 })

      // De service worker bewaart niets van api.github.com (alle GitHub-verzoeken gaan buiten elke cache om).
      expect(await cachedApiUrls(page)).toEqual([])
      expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true)
    })
  })
}
