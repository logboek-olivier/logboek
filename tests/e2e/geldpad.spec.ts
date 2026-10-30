import { expect, test } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Ronde 3 · PR 3: het geldpad per trip. Uitbetaling per organisatie (maandelijks), het salaris van een voorbije trip
// direct vanuit de agenda zetten (bolletje grijs, oranje, groen), op Vandaag "Uitbetaling van … ontvangen?" zonder
// bedragen, een uitbetaling met een verschil die de trips in één keer afvinkt, en een contante fooi die na "Gestort"
// uit Contant gaat. Alle gegevens verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

/** De derde dag van de vorige maand, plus `days`. */
function lastMonth(days: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  d.setDate(3 + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`geldpad: salaris vanuit de agenda, maandelijkse uitbetaling met verschil, contant gestort (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      const shoot = async (name: string) => {
        for (const width of [360, 412]) {
          for (const scheme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: 800 })
            await page.emulateMedia({ colorScheme: scheme })
            await expectNoHorizontalOverflow(page)
            await page.screenshot({ path: `screenshots/geldpad/${name}-${width}-${scheme}-${lang}.png` })
          }
        }
        await page.setViewportSize({ width: 360, height: 800 })
        await page.emulateMedia({ colorScheme: 'light' })
      }

      // Sailing Virgins betaalt maandelijks rond dag 1 (voor de trips van de vorige maand).
      await openMore(page, L('nav.settings'), L('nav.more'))
      await page.getByRole('button', { name: new RegExp(`^${L('salary.defaults')}`) }).click()
      const settings = page.getByRole('dialog')
      await settings.getByLabel(`${L('payout.rule')}: Sailing Virgins`).selectOption('maandelijks')
      await settings.getByLabel(`${L('payout.day')}: Sailing Virgins`).fill('1')
      await settings.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // Twee voorbije trips van Sailing Virgins (een voorbije trip krijgt nooit vanzelf een salaris).
      for (const [name, start] of [
        ['Nepweek een', lastMonth(0)],
        ['Nepweek twee', lastMonth(10)],
      ] as const) {
        await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
        await page.getByRole('main').getByRole('button', { name: L('week.new') }).first().click()
        const sheet = page.getByRole('dialog')
        await sheet.getByLabel(L('field.name'), { exact: true }).fill(name)
        await sheet.getByLabel(L('week.startDate')).fill(start)
        await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Sailing Virgins' })
        await sheet.getByRole('button', { name: L('week.start') }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }

      // Agenda, vorige maand: het salaris direct vanuit de trip zetten; het bolletje wordt oranje (te ontvangen).
      await page.getByRole('navigation').getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.prev') }).click()
      const list = page.locator('.month-salaries')
      for (const name of ['Nepweek een', 'Nepweek twee']) {
        const row = list.getByRole('button', { name: new RegExp(name) })
        await expect(row).toContainText(L('salaryState.geen'))
        await row.click()
        const sheet = page.getByRole('dialog')
        await sheet.getByLabel(L('salary.amount')).fill('1000')
        await sheet.getByRole('button', { name: L('common.save') }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(row).toContainText(L('salaryState.te-ontvangen'))
        await expect(row.locator('.salary-dot.te-ontvangen')).toHaveCount(1)
      }
      // Geen bedragen zonder erom te vragen; na "Toon bedragen" wel.
      await expect(list).not.toContainText('1.000')
      await expect(list).not.toContainText('1,000')
      await page.getByRole('button', { name: L('week.showAmounts') }).click()
      await expect(list.getByRole('button', { name: /Nepweek een/ })).toContainText(lang === 'nl' ? '1.000' : '1,000')
      await expect(page.locator('.cal-bar .salary-dot.te-ontvangen').first()).toBeAttached()
      await shoot('agenda')

      // Vandaag: één vraag voor de uitbetaling van vorige maand, zonder bedragen.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
      const question = page.locator('.salary-question', { hasText: 'Sailing Virgins' })
      await expect(question).toContainText(lang === 'nl' ? '2 trips' : '2 trips')
      await expect(question).not.toContainText('1.000')
      await expect(question).not.toContainText('1,000')
      await question.getByRole('button', { name: L('salary.otherAmount') }).click()

      // Een ander bedrag: beide trips staan aan, het verschil met het verwachte bedrag staat erbij.
      const payout = page.getByRole('dialog')
      await expect(payout.getByRole('checkbox')).toHaveCount(2)
      for (const box of await payout.getByRole('checkbox').all()) await expect(box).toBeChecked()
      await expect(payout.getByLabel(L('payout.amount'))).toHaveValue(lang === 'nl' ? '2.000' : '2,000')
      await payout.getByLabel(L('payout.amount')).fill(lang === 'nl' ? '1950' : '1950')
      await expect(payout.locator('.payout-expected')).toContainText(lang === 'nl' ? '−€ 50,00' : '−€50.00')
      await shoot('uitbetaling')
      await payout.getByRole('button', { name: L('payout.save', { n: 2 }) }).click()
      await expect(page.locator('.toast')).toContainText(L('payout.saved', { n: 2 }))
      await expect(page.locator('.salary-question', { hasText: 'Sailing Virgins' })).toHaveCount(0)

      // In de agenda staan beide trips nu op ontvangen (groen).
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      await page.getByRole('navigation').getByRole('button', { name: L('nav.calendar'), exact: true }).click()
      await page.getByRole('button', { name: L('calendar.prev') }).click()
      await expect(page.locator('.month-salaries .salary-dot.ontvangen')).toHaveCount(2)

      // Een contante fooi (de standaard), dan in Geld → Contant en "Gestort": daarna is Contant leeg.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await page.getByLabel(L('field.amount')).fill('40')
      await expect(page.getByRole('radio', { name: L('tipVia.contant') })).toHaveAttribute('aria-checked', 'true')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('nav.money'), L('nav.more'))
      const cash = page.locator('.cash-row')
      await expect(cash).toContainText(lang === 'nl' ? '€ 40,00' : '€40.00')
      await page.locator('.money-path').scrollIntoViewIfNeeded()
      await shoot('contant')
      await cash.getByRole('button', { name: L('cash.deposit') }).click()
      await page.getByRole('dialog').getByRole('button', { name: L('cash.depositSave') }).click()
      await expect(page.locator('.toast')).toContainText(L('cash.deposited'))
      await expect(page.locator('.cash-row')).toHaveCount(0)
      await expect(page.locator('.money-path')).toContainText(L('cash.none'))
      // Ongedaan maken zet de fooi terug in Contant.
      await page.locator('.toast').getByRole('button', { name: L('common.undo') }).click()
      await expect(page.locator('.cash-row')).toContainText(lang === 'nl' ? '€ 40,00' : '€40.00')
      expect(errors).toEqual([])
    })
  })
}
