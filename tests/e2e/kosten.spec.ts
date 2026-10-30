import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Ronde 3 · PR 5: kosten met zo weinig werk mogelijk. Een vaste last met een nieuw bedrag vanaf volgende maand (oude
// maanden blijven kloppen), standaardbedragen per dagsoort, een losse uitgave met een soort (ook zonder trip), en de
// weekafsluiting met "Ongeveer los uitgegeven deze week?". De vooruitblik trekt de kosten af. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/kosten/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`kosten: vaste last vanaf een maand, standaard per dagsoort, uitgave met soort, weekschatting (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      // Zondag 14 februari 2027: de weekafsluiting staat op Vandaag.
      await page.clock.setSystemTime(new Date('2027-02-14T10:00:00'))
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const toast = page.locator('.toast')
      await mockGithub(page)
      await createNewLogbook(page, lang)

      // Weekafsluiting: één getal voor de losse uitgaven van deze week.
      const card = page.locator('.week-close')
      await card.getByLabel(L('weekClose.spent')).fill('140')
      await card.getByRole('button', { name: L('weekClose.save') }).click()
      await expect(toast).toHaveText(L('weekClose.saved'))
      await expect(toast).toHaveCount(0, { timeout: 15_000 })

      // Een losse uitgave met een soort, zonder trip.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabExpense') }).click()
      await page.getByLabel(L('field.amount')).fill('12,50')
      await page.getByRole('radio', { name: L('costCategory.eten') }).click()
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveCount(0, { timeout: 15_000 })

      // Geld → Kosten: een vaste last, dan een nieuw bedrag vanaf volgende maand.
      await openMore(page, L('nav.money'), L('nav.more'))
      const costs = page.locator('.costs')
      await costs.getByRole('button', { name: L('costs.addFixed') }).click()
      let sheet = page.getByRole('dialog')
      await sheet.getByLabel(L('costs.name')).fill('Neptelefoon')
      await sheet.getByLabel(L('costs.amount')).fill('30')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('costs.saved'))
      await expect(costs).toContainText('Neptelefoon')
      await costs.getByRole('button', { name: /Neptelefoon/ }).click()
      await page.getByRole('dialog').getByRole('button', { name: L('common.edit'), exact: true }).click()
      sheet = page.getByRole('dialog')
      await expect(sheet.getByLabel(L('costs.amount'))).toHaveValue('30')
      await sheet.getByLabel(L('costs.amount')).fill('35')
      await sheet.getByLabel(L('costs.fromMonth')).fill('2027-03')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toContainText(L('costs.saved'))
      // Deze maand nog 30; vanaf maart 35.
      await expect(costs.getByRole('button', { name: /Neptelefoon/ })).toContainText(lang === 'nl' ? '€ 30,00' : '€30.00')
      await costs.getByRole('button', { name: /Neptelefoon/ }).click()
      await expect(page.getByRole('dialog')).toContainText(lang === 'nl' ? '€ 35,00' : '€35.00')
      await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()

      // Standaardbedragen per dagsoort (nog te weinig eigen gegevens).
      await costs.getByRole('button', { name: L('costs.defaults') }).click()
      sheet = page.getByRole('dialog')
      await sheet.getByLabel(L('costs.defaultFor', { type: L('dayType.thuis') })).fill('20')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(costs.locator('.cost-day').first()).toContainText(L('costs.standard'))
      await expect(costs.locator('.cost-day').first()).toContainText(lang === 'nl' ? '€ 20,00' : '€20.00')
      await costs.scrollIntoViewIfNeeded()
      await shots(page, 'kosten', lang)
      expect(errors).toEqual([])
    })
  })
}
