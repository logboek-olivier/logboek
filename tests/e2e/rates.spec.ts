import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore, fillBoat } from './helpers/logbook'
import { mockRates } from './helpers/rates'

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
    // De service worker neemt direct over en haalt rates.json zelf op (page.route ziet dat niet): hier geblokkeerd.
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 }, serviceWorkers: 'block' })

    test(`koersen: voorlopig met de laatst bekende koers, ontvangen eurobedrag gaat voor, weektotalen in euro (${lang})`, async ({ page }) => {
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      // Het koersbestand loopt tot gisteren: een fooi van vandaag krijgt voorlopig de laatst bekende koers.
      await mockRates(page, 1)
      await createNewLogbook(page, lang)

      // Een week, zodat de weektotalen meedoen.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.getByRole('main').getByRole('button', { name: L('week.new') }).click()
      await page.getByRole('dialog').getByRole('radio', { name: L('weekType.skipper-charter') }).click()
      await fillBoat(page.getByRole('dialog'), lang)
      await page.getByRole('dialog').getByRole('button', { name: L('week.start') }).click()

      for (const [amount, currency] of [['100', 'USD'], ['40', 'EUR']] as const) {
        await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
        await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
        await page.getByLabel(L('field.amount')).fill(amount)
        await page.getByRole('combobox', { name: L('field.currency') }).selectOption(currency)
        await page.getByRole('button', { name: L('common.save') }).click()
        await expect(page.locator('.toast')).toBeVisible()
      }

      await openMore(page, L('nav.money'), L('nav.more'))
      const usd = page.locator('.tx').filter({ hasText: lang === 'nl' ? '$ 100,00' : '$100.00' })
      // 100 USD / 1,25 = 80 EUR, voorlopig.
      await expect(usd).toContainText(lang === 'nl' ? '€ 80,00' : '€80.00')
      await expect(usd).toContainText(L('money.provisional'))
      await expect(page.locator('.grid').first()).toContainText(lang === 'nl' ? '€ 120,00' : '€120.00')
      await shots(page, 'geld-voorlopig', lang)

      // Werkelijk ontvangen eurobedrag gaat voor de omrekening.
      await usd.getByRole('button').click()
      await expect(page.getByRole('dialog')).toContainText(L('money.rateProvisional', { rate: lang === 'nl' ? '1,25' : '1.25', currency: 'USD', date: '' }).split(' (')[0]!)
      await shots(page, 'transactie-koers', lang)
      await page.getByRole('dialog').getByLabel(L('money.receivedEur')).fill(lang === 'nl' ? '78,50' : '78.50')
      await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
      await expect(usd).toContainText(lang === 'nl' ? '€ 78,50' : '€78.50')
      await expect(usd).not.toContainText(L('money.provisional'))

      // Deze week: fooien en kosten in euro, pas na "Toon bedragen".
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      await expect(page.locator('main')).not.toContainText('€')
      await page.getByRole('button', { name: L('week.showAmounts') }).click()
      await expect(page.locator('main')).toContainText(lang === 'nl' ? '€ 118,50' : '€118.50')
      await shots(page, 'deze-week-bedragen', lang)

      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      // Er gaat niets naar een andere bestemming dan api.github.com en de eigen origin.
      expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
