import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Wekelijks 2 minuten. De weekafsluiting op zondag krijgt een geldstap, ingeklapt (Vandaag toont geen bedragen zonder
// tik): de stand per rekening en ontvangen salaris afvinken (contant en gestort bestaan niet meer); alles overslaan mag.
// Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

/**
 * Het salaris van een tocht zetten (één loon-transactie, src/domain/geldmodel.ts): Meer → Periodes → zoeken → het
 * tripoverzicht → Bewerken → Fooien en inkomsten → Salaris → bedrag (verwacht) → Opslaan.
 */
async function setSalary(page: Page, L: (key: MessageKey, ...args: unknown[]) => string, name: string, amount: string) {
  await openMore(page, L('periods.title'), L('nav.more'))
  await page.getByLabel(L('periods.search')).fill(name)
  await page.locator('.period-row', { hasText: name }).click()
  await page.getByRole('dialog').getByRole('button', { name: L('common.edit'), exact: true }).first().click()
  const edit = page.getByRole('dialog', { name: L('week.edit') })
  await edit.getByRole('button', { name: new RegExp(`^${L('tripIncome.title')}`) }).click()
  await edit.locator('.salary-row').click()
  const sheet = page.getByRole('dialog').last()
  await sheet.getByLabel(L('salary.amount')).fill(amount)
  await sheet.getByRole('button', { name: L('common.save') }).click()
  await expect(page.locator('.toast')).toContainText(L('salary.tripSaved'))
  await page.getByRole('dialog', { name: L('week.edit') }).getByRole('button', { name: L('common.close'), exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: L('common.close'), exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
}

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/weekgeld/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`weekgeld: stand en salaris in de weekafsluiting (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      // Zondag 14 februari 2027.
      await page.clock.setSystemTime(new Date('2027-02-14T10:00:00'))
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const toast = page.locator('.toast')
      await mockGithub(page)
      await createNewLogbook(page, lang, { olivier: true })

      // Een betaalrekening, een voorbije trip met salaris te ontvangen, en een fooi.
      await openMore(page, L('accounts.screen'), L('nav.more'))
      await page.getByRole('button', { name: L('accounts.add') }).click()
      await page.getByRole('dialog').last().getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('accounts.saved'))
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.getByRole('main').getByRole('button', { name: L('week.new') }).first().click()
      const sheet = page.getByRole('dialog')
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek weekgeld')
      await sheet.getByLabel(L('week.startDate')).fill('2027-02-01')
      await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Sailing Virgins' })
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await setSalary(page, L, 'Nepweek weekgeld', '1000')
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await page.getByLabel(L('field.amount')).fill('60')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveCount(0, { timeout: 15_000 })

      // Vandaag: de weekafsluiting met de geldstap ingeklapt (geen bedragen zonder tik).
      await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
      const card = page.locator('.week-close')
      await expect(card).not.toContainText('1.000')
      await expect(card).not.toContainText('1,000')
      await card.getByRole('button', { name: L('weekMoney.title') }).click()
      await card.getByLabel(/ASN/).fill(lang === 'nl' ? '2.500' : '2,500')
      await card.getByRole('checkbox', { name: /Nepweek weekgeld/ }).check()
      // Geen contanten meer om af te vinken.
      await expect(card.getByRole('checkbox')).toHaveCount(1)
      await card.scrollIntoViewIfNeeded()
      await shots(page, 'geldstap', lang)
      await card.getByRole('button', { name: L('weekClose.save') }).click()
      await expect(toast).toContainText(L('weekClose.saved'))
      // Alleen de geldstap is genoeg: de week is afgesloten en de kaart is weg.
      await expect(card).toHaveCount(0)
      await expect(toast).toHaveCount(0, { timeout: 15_000 })

      // Geld: de stand staat erin, het salaris is ontvangen (niets meer te ontvangen of open).
      await openMore(page, L('nav.money'), L('nav.more'))
      const position = page.locator('.position')
      await expect(position.locator('.position-account', { hasText: 'ASN' })).toContainText(lang === 'nl' ? '€ 2.500,00' : '€2,500.00')
      await expect(page.locator('.position-group', { hasText: L('position.receivable') })).toHaveCount(0)
      await expect(page.locator('.money-path')).toContainText(L('payout.nothingOpen'))
      expect(errors).toEqual([])
    })
  })
}
