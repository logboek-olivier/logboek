import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Kluis: een nepfoto en een nep-PDF toevoegen, bekijken, bewerken en verwijderen met ongedaan maken; op GitHub alleen
// versleutelde bestanden met een willekeurige naam; de vervaldatum staat bij de termijnen. Alle bestanden verzonnen.

/** Een verzonnen foto van 1 × 1 pixel. */
const NEP_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const NEP_PDF = Buffer.from('%PDF-1.4\n% nepdocument\n%%EOF\n')

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/kluis/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })

    test(`kluis: nepdocumenten versleuteld met een willekeurige naam, bekijken, bewerken, verwijderen, termijnen (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const sheet = page.getByRole('dialog')
      const toast = page.locator('.toast')

      await openMore(page, L('vault.screen'), L('nav.more'))
      await expect(page.getByRole('heading', { name: L('vault.screen'), level: 1 })).toBeVisible()
      await expect(page.getByText(L('vault.testPhase'))).toBeVisible()

      // Geen foto en geen PDF: geweigerd.
      await page.getByRole('button', { name: L('vault.add') }).click()
      await page.getByLabel(L('vault.chooseFile')).setInputFiles({ name: 'nep.txt', mimeType: 'text/plain', buffer: Buffer.from('nep') })
      await expect(sheet.getByRole('alert')).toHaveText(L('vault.unsupported'))

      // Een nepfoto als certificaat, met een vervaldatum; certificaten zijn standaard offline.
      await page.getByLabel(L('vault.chooseFile')).setInputFiles({ name: 'nep.png', mimeType: 'image/png', buffer: NEP_PNG })
      await expect(sheet.locator('.vault-preview img')).toBeVisible()
      await expect(sheet.locator('.vault-preview')).toContainText('JPEG')
      await sheet.getByLabel(L('vault.titleField')).fill('Nepcertificaat STCW')
      await sheet.getByLabel(L('vault.expiresAt')).fill('2031-03-01')
      await expect(sheet.getByLabel(L('vault.offline'))).toBeChecked()
      await shots(page, 'toevoegen', lang)
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('vault.saved'))
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Op GitHub: het bestand onder een UUID, versleuteld; de naam staat nergens in een pad of in de inhoud.
      const bin = github.requests.filter((r) => r.method === 'PUT' && /\/contents\/documents\/[0-9a-f-]{36}\.bin$/.test(r.url))
      expect(bin).toHaveLength(1)
      expect(github.requests.some((r) => r.method === 'PUT' && r.url.endsWith('/contents/documents/index.json.enc'))).toBe(true)
      expect(github.requests.every((r) => !r.url.includes('Nepcertificaat') && !(r.body ?? '').includes('Nepcertificaat'))).toBe(true)
      const sent = JSON.parse(bin[0]!.body!) as { content: string; message: string }
      expect(Buffer.from(sent.content, 'base64')[0]).toBe(1)
      expect(sent.message).toMatch(/^sync /)

      // De lijst en het document zelf.
      const row = page.locator('.row-button', { hasText: 'Nepcertificaat STCW' })
      await expect(row).toContainText(L('vault.expiresOn', { date: lang === 'nl' ? '1 maart 2031' : '1 March 2031' }))
      await shots(page, 'lijst', lang)
      await row.click()
      await expect(sheet.locator('img.vault-image')).toBeVisible()
      await expect(sheet.locator('img.vault-image')).toHaveAttribute('src', /^blob:/)
      await expect(sheet.locator('.view-rows')).toContainText(L('vault.offlineYes'))
      await shots(page, 'bekijken', lang)
      // Bewerken: een andere naam.
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await sheet.getByLabel(L('vault.titleField')).fill('Nepcertificaat VHF')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.row-button', { hasText: 'Nepcertificaat VHF' })).toBeVisible()

      // Een nep-PDF (verzekering): openen geeft "Openen of delen".
      await page.getByRole('button', { name: L('vault.add') }).click()
      await page.getByLabel(L('vault.chooseFile')).setInputFiles({ name: 'nep.pdf', mimeType: '', buffer: NEP_PDF })
      await expect(sheet.locator('.vault-preview')).toContainText('PDF')
      await sheet.getByLabel(L('vault.titleField')).fill('Nepverzekering')
      await sheet.getByLabel(L('vault.category')).selectOption('verzekering')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('vault.saved'))
      await page.locator('.row-button', { hasText: 'Nepverzekering' }).click()
      await expect(sheet.locator('.vault-pdf')).toHaveText(L('vault.pdf'))
      await expect(sheet.getByRole('button', { name: L('vault.open') })).toBeVisible()
      // Verwijderen en ongedaan maken.
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await sheet.getByRole('button', { name: L('common.delete') }).click()
      await expect(page.locator('.row-button', { hasText: 'Nepverzekering' })).toHaveCount(0)
      await page.getByRole('button', { name: L('common.undo') }).click()
      await expect(page.locator('.row-button', { hasText: 'Nepverzekering' })).toBeVisible()

      // De vervaldatum staat bij de termijnen.
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('reminder.screen'), L('nav.more'))
      await expect(page.locator('.due-list')).toContainText('Nepcertificaat VHF')
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      // Alleen api.github.com, nooit een andere bestemming.
      expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
