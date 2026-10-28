import { expect, test } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

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

    test(`onleesbaar bestand: alleen dat onderdeel, herstel met één tik, meegeleverde bestanden vanzelf (${lang})`, async ({ page }) => {
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const status = page.getByRole('status').first()
      await expect(status).toHaveText(translate(lang, 'sync.synced'), { timeout: 15_000 })

      const plans = github.files.get('plans.json.enc')!
      github.files.set('plans.json.enc', { sha: `${plans.sha}-vreemd`, content: foreignCiphertext() })
      await page.getByRole('button', { name: new RegExp(translate(lang, 'sync.now')) }).click()
      // Eén onleesbaar bestand blokkeert alleen zijn eigen onderdeel: de app blijft open, met een melding en een knop.
      await expect(status).toHaveText(translate(lang, 'sync.unreadable', { paths: 'plans.json.enc' }), { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: translate(lang, 'repair.title') })).toHaveCount(0)
      const repair = page.getByRole('button', { name: translate(lang, 'sync.repair') })
      await expect(repair).toBeVisible()
      for (const width of [360, 412]) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 740 })
          await page.emulateMedia({ colorScheme: scheme })
          await expectNoHorizontalOverflow(page)
          await page.screenshot({ path: `screenshots/onleesbaar/${width}-${scheme}-${lang}.png` })
        }
      }
      // De rest van de app werkt gewoon, zonder de melding: die hoort alleen bij het onderdeel planning.
      await page.getByRole('navigation').getByRole('button', { name: translate(lang, 'nav.calendar'), exact: true }).click()
      await expect(page.getByRole('heading', { name: translate(lang, 'nav.calendar') })).toBeVisible()
      await expect(repair).toHaveCount(0)
      await expect(status).toHaveText(translate(lang, 'sync.unreadable', { paths: 'plans.json.enc' }))
      // Niets automatisch overschreven (planning is geen meegeleverd bestand).
      expect(github.files.get('plans.json.enc')!.sha).toBe(`${plans.sha}-vreemd`)

      // Bij Deze trip (waar de planning staat): één tik, de lokale versie gaat naar GitHub (met de oude SHA als voorwaarde).
      await page.getByRole('navigation').getByRole('button', { name: translate(lang, 'nav.week'), exact: true }).click()
      await page.getByRole('button', { name: translate(lang, 'sync.repair') }).click()
      await expect(status).toHaveText(translate(lang, 'sync.synced'), { timeout: 15_000 })
      expect(github.files.get('plans.json.enc')!.sha).not.toBe(`${plans.sha}-vreemd`)

      // Een meegeleverd bestand (checklists) herstelt de app vanzelf.
      const lists = github.files.get('checklists.json.enc')!
      github.files.set('checklists.json.enc', { sha: `${lists.sha}-vreemd`, content: foreignCiphertext() })
      await status.click()
      await expect(status).toHaveText(translate(lang, 'sync.synced'), { timeout: 15_000 })
      expect(github.files.get('checklists.json.enc')!.sha).not.toBe(`${lists.sha}-vreemd`)
    })
  })
}
