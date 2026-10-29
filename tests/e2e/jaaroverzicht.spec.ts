import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'
import { mockRates } from './helpers/rates'

// Jaaroverzicht voor de belasting (Meer → Geld): inkomsten per jaar en per organisatie in euro, met de gebruikte koers
// en datum, als PDF via de printfunctie. Alle gegevens en koersen verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/geld/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    // De service worker haalt rates.json zelf op (page.route ziet dat niet): hier geblokkeerd.
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 }, serviceWorkers: 'block' })

    test(`jaaroverzicht: per organisatie in euro met koers en datum, als PDF (${lang})`, async ({ page }) => {
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const money = (nl: string, en: string) => (lang === 'nl' ? nl : en)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      // Koersen tot en met vandaag: USD 1,25 per euro.
      await mockRates(page, 0)
      await createNewLogbook(page, lang)

      for (const [amount, currency, source] of [['125', 'USD', 'sailing-virgins'], ['40', 'EUR', 'yacht-week']] as const) {
        await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
        await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
        await page.getByLabel(L('field.amount')).fill(amount)
        await page.getByRole('combobox', { name: L('field.currency') }).selectOption(currency)
        await page.getByRole('combobox', { name: L('field.source') }).selectOption(source)
        await page.getByRole('button', { name: L('common.save') }).click()
        await expect(page.locator('.toast')).toBeVisible()
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      }

      await openMore(page, L('nav.money'), L('nav.more'))
      const section = page.locator('.tax-year')
      await expect(section.getByRole('heading', { name: L('tax.title') })).toBeVisible()
      await expect(section.getByRole('combobox', { name: L('tax.year') })).toHaveValue(String(new Date().getFullYear()))
      // 125 USD / 1,25 = 100 euro bij Sailing Virgins; 40 euro bij Yacht Week.
      await expect(section.locator('tr', { hasText: 'Sailing Virgins' })).toContainText(money('€ 100,00', '€100.00'))
      await expect(section.locator('tr', { hasText: 'Yacht Week' })).toContainText(money('€ 40,00', '€40.00'))
      await expect(section.locator('.total-row')).toContainText(money('€ 140,00', '€140.00'))
      await section.scrollIntoViewIfNeeded()
      await shots(page, 'jaaroverzicht', lang)

      // Afdrukken (de testbrowser heeft geen printer): alle regels met het oorspronkelijke bedrag, de koers en de datum.
      await page.evaluate(() => {
        ;(window as unknown as { printed: number }).printed = 0
        window.print = () => {
          ;(window as unknown as { printed: number }).printed++
        }
      })
      await section.getByRole('button', { name: L('tax.print') }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
      const print = page.locator('.print-root.tax-print')
      // Op het scherm verborgen (alleen bij afdrukken zichtbaar), dus op tekst controleren.
      await expect(print.locator('h1')).toHaveText(L('tax.printTitle', { year: new Date().getFullYear() }))
      await expect(print).toContainText(L('tax.rate', { rate: money('1,25', '1.25'), currency: 'USD' }))
      await expect(print).toContainText(money('$ 125,00', '$125.00'))
      await expect(print).toContainText(L('tax.basis'))
      await page.emulateMedia({ media: 'print' })
      await page.screenshot({ path: `screenshots/geld/jaaroverzicht-print-${lang}.png`, fullPage: true })
      await page.emulateMedia({ media: 'screen' })

      // Er gaat niets naar een andere bestemming dan api.github.com en de eigen origin.
      expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
