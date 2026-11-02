import { expect, test, type Page } from '@playwright/test'
import { formatMoney } from '../../src/format'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Geld → Mijn positie en de vooruitblik: de rekeningen plus wat nog te ontvangen is (geen contant meer). Een
// betaalrekening en een studieschuld, een stand in een paar seconden vanuit Mijn positie, een voorbije trip met salaris te
// ontvangen, een komende trip in de planning; de netto waarde vandaag en de verandering in de periode (eerst onbekend,
// dan "Beginsaldo invoeren" en de uitsplitsing om door te klikken); de vooruitblik met "Netto waarde op …" en "Wat je
// planning toevoegt". Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

function iso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  await edit.getByRole('button', { name: new RegExp(`^${L('tripMoney.title')}`) }).click()
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
      await createNewLogbook(page, lang, { olivier: true })

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
        await sheet.getByRole('button', { name: L('week.start') }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        // Het salaris is een eigen transactie bij de tocht: zetten via het salaris in Trip bewerken.
        await setSalary(page, L, name, '1000')
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
      // Netto waarde vandaag: 2.500 + 1.000 te ontvangen − 12.000.
      const totalsBox = position.locator('.position-totals')
      await expect(totalsBox).toContainText(L('position.netAll'))
      await expect(totalsBox).toContainText(money(-8500))
      // De verandering sinds een begindag zonder stand: onbekend, nooit een verzonnen getal. Beginsaldo invoeren: één
      // bedrag per rekening op de begindag.
      const periodBox = page.locator('.money-period')
      await periodBox.getByRole('radio', { name: L('period.eigen') }).click()
      await periodBox.getByLabel(L('period.from')).fill(iso(-30))
      await periodBox.getByLabel(L('period.to')).fill(iso(150))
      const unknown = position.locator('.change-unknown')
      await expect(unknown).toContainText(L('accounts.provider.asn'))
      await expect(totalsBox).not.toContainText(L('position.partSailing'))
      await shots(page, 'verandering-onbekend', lang)
      await unknown.getByRole('button', { name: L('position.enterStart') }).click()
      const startSheet = page.getByRole('dialog')
      await startSheet.getByLabel(`${L('accounts.provider.asn')} (EUR)`).fill('2000')
      await startSheet.getByLabel(`${L('accounts.provider.duo')} (EUR)`).fill('12500')
      await startSheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toContainText(L('position.startSaved'))
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // Begin: 2.000 − 12.500 = −10.500; vandaag −8.500: +2.000 = zeilresultaat 0 + te ontvangen +1.000 + schulden +500
      // (de studieschuld ging van 12.500 naar 12.000) + overig +500 (de bank van 2.000 naar 2.500).
      await expect(totalsBox).toContainText(`+${money(2000)}`)
      await expect(totalsBox.getByRole('button', { name: new RegExp(L('position.partReceivable')) })).toContainText(`+${money(1000)}`)
      await expect(totalsBox.getByRole('button', { name: new RegExp(`^${L('position.partDebts')}`) })).toContainText(`+${money(500)}`)
      await expect(totalsBox.getByRole('button', { name: new RegExp(L('position.partOther').replace(/[()]/g, '.')) })).toContainText(`+${money(500)}`)
      await shots(page, 'positie', lang)
      // Doorklikken: te ontvangen op het einde min op de begindag; terug = Geld op dezelfde plek.
      await totalsBox.getByRole('button', { name: new RegExp(L('position.partReceivable')) }).click()
      const drill = page.getByRole('dialog', { name: L('position.partReceivable') })
      await expect(drill.locator('.drill-total')).toContainText(`+${money(1000)}`)
      await expect(drill).toContainText('Nepweek voorbij')
      await page.goBack()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(position).toBeVisible()

      // De vooruitblik (Verwacht): het salaris van de komende trip komt erbij.
      await page.getByRole('tab', { name: L('money.expected') }).click()
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
      // Zonder start van de zeilcarrière is er geen snelkeuze "sinds de start" (geen datum van een ander).
      await expect(page.locator('.money-period').getByRole('radio', { name: L('period.carriere') })).toHaveCount(0)
      await page.locator('.money-period').getByRole('radio', { name: L('period.jaar') }).click()

      // Instellingen → Start zeilcarrière: daarna staat de snelkeuze er wel.
      await openMore(page, L('nav.settings'), L('nav.more'))
      await expect(page.getByRole('button', { name: new RegExp(`^${L('position.careerStart')}`) })).toContainText(L('position.careerStartNotSet'))
      await page.getByRole('button', { name: new RegExp(`^${L('position.careerStart')}`) }).click()
      await page.getByRole('dialog').getByLabel(L('position.careerStartDate')).fill(iso(-1))
      await page.getByRole('dialog').getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await openMore(page, L('nav.money'), L('nav.more'))
      await expect(page.locator('.money-period').getByRole('radio', { name: L('period.carriere') })).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
