import { expect, test } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook, expectNoHorizontalOverflow, PASSPHRASE } from './helpers/logbook'

/** Geldige vorm (versie 1, iv, tag) maar onder een andere sleutel versleuteld: ontsleutelen faalt. */
function foreignCiphertext(): string {
  const bytes = new Uint8Array(1 + 12 + 64 + 16)
  bytes[0] = 1
  for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 37) % 256
  return Buffer.from(bytes).toString('base64')
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 740 } })

    test(`onleesbaar bestand: pad in de syncstatus, herstel alleen na een tik (${lang})`, async ({ page }) => {
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const status = page.getByRole('status').first()
      await expect(status).toHaveText(translate(lang, 'sync.synced'), { timeout: 15_000 })

      const plans = github.files.get('plans.json.enc')!
      github.files.set('plans.json.enc', { sha: `${plans.sha}-vreemd`, content: foreignCiphertext() })
      await page.getByRole('button', { name: new RegExp(translate(lang, 'sync.now')) }).click()
      // Meta hoort bij deze sleutel: één scherm "Logboek herstellen". De lokale kopie is leesbaar, dus er gaat niets verloren.
      await expect(page.getByRole('heading', { name: translate(lang, 'repair.title') })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(translate(lang, 'repair.nothingLost'))).toBeVisible()
      for (const width of [360, 412]) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 740 })
          await page.emulateMedia({ colorScheme: scheme })
          await expectNoHorizontalOverflow(page)
          await page.screenshot({ path: `screenshots/onleesbaar/${width}-${scheme}-${lang}.png` })
        }
      }
      // Niets automatisch overschreven.
      expect(github.files.get('plans.json.enc')!.sha).toBe(`${plans.sha}-vreemd`)

      // Tik plus wachtzin: de lokale versie gaat naar GitHub (met de oude SHA als voorwaarde).
      await page.getByLabel(translate(lang, 'passphrase.label'), { exact: true }).fill(PASSPHRASE)
      await page.getByRole('button', { name: translate(lang, 'repair.button') }).click()
      await expect(status).toHaveText(translate(lang, 'sync.synced'), { timeout: 15_000 })
      expect(github.files.get('plans.json.enc')!.sha).not.toBe(`${plans.sha}-vreemd`)
    })
  })
}
