import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Voorgeschoten voor een vriend en een schuld aan een vriend (+ → Declaratie, soort kiezen, alleen een voornaam). Geld
// toont per persoon wat Olivier nog krijgt en wat hij nog moet betalen; Mijn positie telt een schuld als te betalen; een
// schuld betalen is een gewone uitgave op die dag. Op 360 px, Nederlands en Engels. Alle namen en bedragen verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

async function shots(page: Page, name: string, lang: Lang) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/voorschotten/${name}-360-${scheme}-${lang}.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`voorschotten en schulden: invoeren, overzicht per persoon, schuld betalen (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const toast = page.locator('.toast')
      await mockGithub(page)
      await createNewLogbook(page, lang)
      const nav = page.getByRole('navigation')

      async function add(kind: 'voorgeschoten' | 'schuld', person: string, note: string, amount: string, currency: string) {
        await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
        await page.getByRole('tab', { name: L('quick.tabClaim') }).click()
        await page.getByRole('radio', { name: L(`claimKind.${kind}`) }).click()
        await page.getByLabel(L('claims.person'), { exact: true }).fill(person)
        await page.getByLabel(L('claims.note')).fill(note)
        await page.getByLabel(L('claims.amount')).fill(amount)
        await page.getByLabel(L('field.currency')).selectOption(currency)
        if (kind === 'voorgeschoten') await shots(page, 'invoeren', lang)
        await page.getByRole('button', { name: L('common.save') }).click()
        await expect(page.locator('.add-layer')).toHaveCount(0)
        await expect(toast).toHaveCount(0, { timeout: 15_000 })
      }

      // Voor een vriend voorgeschoten (een achternaam wordt niet bewaard), en een vriend schoot voor mij voor.
      await add('voorgeschoten', 'Nepgaspar Achternaam', 'Nepbier', '71', 'USD')
      await add('schuld', 'Nepjoep', 'Nepdiner', '20', 'EUR')

      // Geld: per persoon te ontvangen en te betalen.
      await openMore(page, L('nav.money'), L('nav.more'))
      const section = page.locator('.claims-section')
      await expect(section.getByRole('heading', { name: L('claims.overviewTitle') })).toBeVisible()
      const receive = section.locator('.stack-sm', { has: page.getByRole('heading', { name: L('claims.toReceive') }) })
      const pay = section.locator('.stack-sm', { has: page.getByRole('heading', { name: L('claims.toPay') }) })
      await expect(receive.locator('.claim-balances li')).toHaveText([lang === 'nl' ? /Nepgaspar.*\$ 71,00/ : /Nepgaspar.*\$71\.00/])
      await expect(pay.locator('.claim-balances li')).toHaveText([lang === 'nl' ? /Nepjoep.*−€ 20,00/ : /Nepjoep.*−€20\.00/])
      await expect(section).not.toContainText('Achternaam')
      // Mijn positie: te ontvangen en te betalen samen.
      await expect(page.locator('.position')).toContainText(L('position.owedTo', { person: 'Nepjoep' }))
      await section.scrollIntoViewIfNeeded()
      await shots(page, 'overzicht', lang)

      // De schuld betalen: een gewone uitgave op die dag, en Te betalen verdwijnt.
      await section.getByRole('button', { name: new RegExp(L('claims.oneDebt', { person: 'Nepjoep' })) }).click()
      const view = page.getByRole('dialog')
      await expect(view).toContainText(L('claimStatus.debtOpen'))
      await expect(view.getByRole('button', { name: L('claims.markSubmitted') })).toHaveCount(0)
      await view.getByRole('button', { name: L('claims.markPaid') }).click()
      const sheet = page.getByRole('dialog').last()
      await expect(sheet.getByLabel(L('claims.paidAmount'))).toHaveValue('20')
      await sheet.getByRole('button', { name: L('claims.savePaid') }).click()
      await expect(toast).toContainText(L('claims.paidToast'))
      await expect(page.getByRole('dialog')).toContainText(L('claimStatus.debtPaid'))
      await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(pay).toHaveCount(0)
      await expect(receive).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
