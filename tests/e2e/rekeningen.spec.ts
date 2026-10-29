import { expect, test, type Page } from '@playwright/test'
import { formatMoney } from '../../src/format'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Rekeningen: een betaalrekening met een verzonnen ASN-export (drie maanden) en een stand met de hand, een studieschuld,
// de netto waarde en het tempo; een onbekend bestand met zelf koppelen. Alle bedragen en namen zijn verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/rekeningen/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

/** De 15e van `back` maanden geleden, als dd-mm-jjjj (ASN) en jjjj-mm-dd. */
function monthsAgo(back: number): { nl: string; iso: string } {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - back, 15)
  const dd = '15'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return { nl: `${dd}-${mm}-${d.getFullYear()}`, iso: `${d.getFullYear()}-${mm}-${dd}` }
}

/** Verzonnen ASN-export (geen kopregel): saldo vóór de mutatie (kolom 9) plus het bedrag (kolom 11). */
function fakeAsn(): string {
  const line = (back: number, before: string, amount: string, n: number) => {
    const { nl } = monthsAgo(back)
    return `${nl},NL00NEPB0123456789,,Nep Tegenpartij,,,,EUR,${before},EUR,${amount},${nl},${nl},8810,IOB,${n},,"Nepomschrijving",1`
  }
  return [line(3, '0.00', '1000.00', 1), line(2, '1000.00', '1000.00', 2), line(1, '2000.00', '1000.00', 3)].join('\r\n')
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })

    test(`rekeningen: export importeren, stand met de hand, studieschuld, netto waarde en tempo (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const toast = page.locator('.toast')
      await openMore(page, L('accounts.screen'), L('nav.more'))
      await expect(page.getByText(L('accounts.empty'))).toBeVisible()

      // Betaalrekening bij ASN: de naam volgt de aanbieder.
      await page.getByRole('button', { name: L('accounts.add') }).click()
      const sheet = page.getByRole('dialog').last()
      await expect(sheet.getByRole('radio', { name: L('accounts.provider.asn') })).toHaveAttribute('aria-checked', 'true')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('accounts.saved'))
      const asn = page.locator('.row-button', { hasText: L('accounts.provider.asn') })
      await expect(asn).toContainText(L('accounts.noStand'))

      // Een verzonnen export: herkend, voorbeeld, drie standen.
      await asn.click()
      await page.getByRole('dialog').getByRole('button', { name: L('accounts.import') }).click()
      const importSheet = page.getByRole('dialog', { name: L('accounts.importTitle', { name: L('accounts.provider.asn') }) })
      await importSheet.getByLabel(L('accounts.chooseFile')).setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(fakeAsn()) })
      await expect(importSheet.getByRole('note')).toHaveText(L('accounts.recognised', { name: L('accounts.preset.asn') }))
      // Het voorbeeld: de laatste stand (2.000 vóór plus 1.000) vóór er iets wordt opgeslagen.
      await expect(importSheet).toContainText(formatMoney(3000, 'EUR', lang))
      await importSheet.getByRole('button', { name: L('accounts.importSave', { n: 3 }) }).click()
      await expect(toast).toHaveText(L('accounts.imported', { n: 3 }))
      const view = page.getByRole('dialog', { name: L('accounts.provider.asn') })
      await expect(view.locator('.rows .row-button')).toHaveCount(3)

      // Een stand met de hand, vandaag.
      await view.getByLabel(L('accounts.standAmount'), { exact: true }).fill(lang === 'nl' ? '4.000' : '4,000')
      await view.getByRole('button', { name: L('accounts.updateStand') }).click()
      await expect(toast).toHaveText(L('accounts.standSaved'))
      await expect(view.locator('.rows .row-button')).toHaveCount(4)
      await expect(view.locator('.rows .row-button').first()).toContainText(formatMoney(4000, 'EUR', lang))
      await shots(page, 'rekening', lang)
      await view.getByRole('button', { name: L('common.close') }).click()

      // Studieschuld: soort schuld, het openstaande bedrag telt negatief.
      await page.getByRole('button', { name: L('accounts.add') }).click()
      const debtSheet = page.getByRole('dialog').last()
      await debtSheet.getByRole('radio', { name: L('accounts.provider.duo') }).click()
      await expect(debtSheet.getByLabel(L('accounts.kind'))).toHaveValue('schuld')
      await expect(debtSheet.getByText(L('accounts.debtHint'))).toBeVisible()
      await debtSheet.getByRole('button', { name: L('common.save') }).click()
      const duo = page.locator('.row-button', { hasText: L('accounts.provider.duo') })
      await duo.click()
      const duoView = page.getByRole('dialog', { name: L('accounts.provider.duo') })
      await duoView.getByLabel(L('accounts.debtAmount'), { exact: true }).fill(lang === 'nl' ? '15.000' : '15,000')
      await duoView.getByRole('button', { name: L('accounts.updateStand') }).click()
      await expect(duoView.locator('.rows .row-button').first()).toContainText(formatMoney(-15000, 'EUR', lang))
      await duoView.getByRole('button', { name: L('common.close') }).click()

      // Netto waarde 4.000 − 15.000; het tempo komt van de bank (een schuld met één stand telt niet mee in het tempo).
      await expect(page.locator('.stat.hero dd')).toContainText(formatMoney(-11000, 'EUR', lang))
      const paceLine = page.locator('.accounts-pace')
      await expect(paceLine).not.toHaveText(L('accounts.pace.tooLittle'))
      await expect(paceLine).not.toHaveText(L('accounts.pace.positive'))
      await expect(paceLine).toContainText(lang === 'nl' ? 'tot netto waarde positief' : 'until your net worth is positive')
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await shots(page, 'overzicht', lang)

      // Een onbekend bestand: zelf koppelen, alleen bedragen met het saldo nu.
      await asn.click()
      await page.getByRole('dialog').getByRole('button', { name: L('accounts.import') }).click()
      const mapSheet = page.getByRole('dialog', { name: L('accounts.importTitle', { name: L('accounts.provider.asn') }) })
      const { iso } = monthsAgo(1)
      await mapSheet.getByLabel(L('accounts.chooseFile')).setInputFiles({ name: 'nep.csv', mimeType: '', buffer: Buffer.from(`Boekdatum;Omschrijving;Bedrag\n${iso};Nep;-10,00\n`) })
      await expect(mapSheet.getByRole('note')).toHaveText(L('accounts.notRecognised'))
      await expect(mapSheet.getByLabel(L('accounts.map.mode'))).toHaveValue('bedragen')
      await mapSheet.getByLabel(L('accounts.currentBalance')).fill('100')
      await expect(mapSheet.getByRole('button', { name: L('accounts.importSave', { n: 1 }) })).toBeEnabled()
      await shots(page, 'koppelen', lang)
      await mapSheet.getByRole('button', { name: L('common.close') }).click()

      // Op GitHub alleen versleuteld; geen andere bestemming.
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect(github.requests.some((r) => r.method === 'PUT' && r.url.endsWith('/contents/accounts.json.enc'))).toBe(true)
      expect(github.requests.some((r) => r.method === 'PUT' && r.url.endsWith('/contents/balances.json.enc'))).toBe(true)
      expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/') && !(r.body ?? '').includes('Nepomschrijving'))).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
