import { expect, test, type Page } from '@playwright/test'
import { formatMoney } from '../../src/format'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Ronde 3 · PR 4: Geld → Mijn positie en de vooruitblik. Een betaalrekening en een studieschuld, een stand in een paar
// seconden vanuit Mijn positie, een voorbije trip met salaris te ontvangen, een komende trip in de planning; de netto
// waarde nu en "Sinds <start zeilcarrière>"; de vooruitblik met "Netto waarde eind …" en "Wat je planning toevoegt".
// Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/positie/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`mijn positie: bank, schuld, te ontvangen, sinds de start, vooruitblik (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const money = (n: number) => formatMoney(n, 'EUR', lang)
      const errors = collectConsoleErrors(page)
      const toast = page.locator('.toast')
      await mockGithub(page)
      await createNewLogbook(page, lang)

      // Een betaalrekening (ASN) en een studieschuld (DUO).
      await openMore(page, L('accounts.screen'), L('nav.more'))
      for (const provider of ['asn', 'duo'] as const) {
        await page.getByRole('button', { name: L('accounts.add') }).click()
        const sheet = page.getByRole('dialog').last()
        await sheet.getByRole('radio', { name: L(`accounts.provider.${provider}`) }).click()
        await sheet.getByRole('button', { name: L('common.save') }).click()
        await expect(toast).toHaveText(L('accounts.saved'))
      }

      // Een voorbije trip met salaris (te ontvangen) en een komende trip met salaris (de planning).
      for (const [name, start] of [
        ['Nepweek voorbij', iso(-20)],
        ['Nepweek straks', iso(20)],
      ] as const) {
        await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
        await page.getByRole('main').getByRole('button', { name: L('week.new') }).first().click()
        const sheet = page.getByRole('dialog')
        await sheet.getByLabel(L('field.name'), { exact: true }).fill(name)
        await sheet.getByLabel(L('week.startDate')).fill(start)
        await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Sailing Virgins' })
        await sheet.getByRole('button', { name: /^(Salaris|Salary)/ }).click()
        await sheet.getByLabel(L('salary.amount')).fill('1000')
        await sheet.getByRole('button', { name: L('week.start') }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }

      // Geld → Mijn positie: de stand van de bank en de schuld in een paar seconden.
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('nav.money'), L('nav.more'))
      const position = page.locator('.position')
      await expect(position).toContainText(L('position.noStand'))
      for (const [provider, amount] of [
        ['asn', '2500'],
        ['duo', '12000'],
      ] as const) {
        await position.locator('.position-account', { hasText: L(`accounts.provider.${provider}`) }).click()
        const sheet = page.getByRole('dialog')
        await sheet.locator('input.amount').fill(amount)
        await sheet.getByRole('button', { name: L('accounts.updateStand') }).click()
        await expect(toast).toHaveText(L('accounts.standSaved'))
        await expect(toast).toHaveCount(0, { timeout: 15_000 })
      }
      await expect(position).toContainText(L('position.bank'))
      await expect(position).toContainText(L('position.studentDebt'))
      await expect(position).toContainText(L('position.receivable'))
      // Netto waarde: 2.500 + 1.000 te ontvangen − 12.000.
      await expect(position.locator('.position-totals')).toContainText(money(-8500))
      // Sinds de start van de zeilcarrière (11 september 2026): er was toen nog geen stand, dus vanaf de eerste stand.
      await expect(position.locator('.position-totals')).toContainText(lang === 'nl' ? 'Sinds' : 'Since')
      await shots(page, 'positie', lang)

      // De vooruitblik: het salaris van de komende trip komt erbij.
      const forecast = page.locator('.forecast')
      await expect(forecast).toContainText(lang === 'nl' ? 'Netto waarde op' : 'Net worth on')
      await expect(forecast).toContainText(money(-7500))
      await expect(forecast).toContainText(`+${money(1000)}`)
      await expect(forecast.locator('svg.line-chart')).toBeVisible()
      await forecast.scrollIntoViewIfNeeded()
      await shots(page, 'vooruitblik', lang)

      // Periode zelf kiezen (van en tot), per apparaat onthouden: ook na herladen.
      const period = page.locator('.money-period')
      await period.getByRole('radio', { name: L('period.eigen') }).click()
      await period.getByLabel(L('period.to')).fill(iso(150))
      await expect(forecast).toContainText(lang === 'nl' ? 'Netto waarde op' : 'Net worth on')
      await period.scrollIntoViewIfNeeded()
      await shots(page, 'periode', lang)
      await page.reload()
      await openMore(page, L('nav.money'), L('nav.more'))
      await expect(page.locator('.money-period').getByRole('radio', { name: L('period.eigen') })).toHaveAttribute('aria-checked', 'true')
      await page.locator('.money-period').getByRole('radio', { name: L('period.carriere') }).click()

      // Instellingen → Start zeilcarrière.
      await openMore(page, L('nav.settings'), L('nav.more'))
      await page.getByRole('button', { name: new RegExp(`^${L('position.careerStart')}`) }).click()
      await page.getByRole('dialog').getByLabel(L('position.careerStartDate')).fill(iso(-1))
      await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
