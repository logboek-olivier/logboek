import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openLogbook } from './helpers/logbook'

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/weken/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })

    test(`week starten, dag in de week loggen, week bewerken en afronden (${lang})`, async ({ page }) => {
      test.setTimeout(90_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const nav = page.getByRole('navigation')
      await nav.getByRole('button', { name: L('nav.week'), exact: true }).click()
      const card = page.locator('main')
      await expect(card).toContainText(L('week.noActive'))

      // Nieuwe trip, in één scherm.
      await card.getByRole('button', { name: L('week.new') }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByLabel(L('field.name'), { exact: true })).toHaveAttribute('placeholder', new RegExp(`^${L('field.trip')} `))
      await expect(sheet.getByRole('radio', { name: L('weekType.training-geven') })).toHaveAttribute('aria-checked', 'true')
      await expect(sheet.getByLabel(L('week.dayCount'))).toHaveValue('7')
      await fillBoat(sheet, lang)
      await sheet.getByLabel(L('week.area')).fill('Nepgebied')
      await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Sailing Virgins' })
      // Bij Sailing Virgins en Yacht Week: naamvoorstel met de teller per organisatie.
      await expect(sheet.getByLabel(L('field.name'), { exact: true })).toHaveAttribute('placeholder', 'SV #1 · Nepgebied')
      await sheet.getByLabel(L('week.participantName', { n: 1 }), { exact: true }).fill('Nepanna')
      await sheet.getByRole('combobox', { name: L('week.participantLevel', { n: 1 }) }).selectOption({ label: L('level.beginner') })
      await sheet.getByLabel(L('week.participantName', { n: 2 }), { exact: true }).fill('Nepbram')
      await expect(sheet.getByLabel(L('week.participantName', { n: 3 }), { exact: true })).toHaveValue('')
      await shots(page, 'nieuwe-week', lang)
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(page.locator('.toast')).toHaveText(L('week.started'))
      await expect(card).toContainText(L('weekType.training-geven'))
      await expect(card).toContainText('Nepboot')

      // Dag loggen: week, boot en rol komen uit de lopende week.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await expect(page.getByRole('combobox', { name: L('field.role'), exact: true })).toHaveValue('instructeur')
      await expect(page.getByLabel(L('field.boat'), { exact: true })).toHaveValue('Nepboot')
      await expect(page.getByRole('combobox', { name: L('field.week'), exact: true }).locator('option:checked')).toHaveText('SV #1 · Nepgebied')
      await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')
      await page.getByLabel(L('field.nm')).fill('12')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.toast')).toHaveText(L('toast.daySaved'))
      await nav.getByRole('button', { name: L('nav.week'), exact: true }).click()
      await expect(card).toContainText('Nephaven')

      // Trip bewerken: tien dagen geleden begonnen, dus voorbij; Vandaag vraagt om afronden.
      await card.getByRole('button', { name: new RegExp(L('week.edit')) }).click()
      await sheet.getByLabel(L('week.startDate')).fill(isoDaysAgo(10))
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(card.getByRole('button', { name: L('week.close') })).toBeVisible()
      await shots(page, 'deze-week-afronden', lang)
      await card.getByRole('button', { name: L('week.close') }).click()
      await expect(sheet).toContainText('Nepanna')
      await expect(sheet).toContainText(L('level.beginner'))
      // In een minuut: cijfer en één zin; de review van gasten staat ingeklapt.
      await sheet.getByRole('radio', { name: '8', exact: true }).click()
      await sheet.getByLabel(L('close.lesson')).fill('Nep: eerder reven')
      await sheet.getByRole('button', { name: L('close.guestReview') }).click()
      await sheet.getByLabel(L('week.reviewScore')).fill(lang === 'nl' ? '9,4' : '9.4')
      await sheet.getByLabel(L('week.quotes')).fill('Best skipper ever\nGreat week')
      await shots(page, 'week-afronden', lang)
      await sheet.getByRole('button', { name: L('week.closeSave') }).click()
      await expect(page.locator('.toast')).toContainText(L('week.closed'))
      await expect(card).toContainText(L('week.noActive'))
      // De afgeronde week staat in het logboek met zijn dag.
      await openLogbook(page, lang)
      await expect(page.locator('.trip').first()).toContainText('SV #1 · Nepgebied')

      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const wire = github.requests.map((r) => r.body ?? '').join('\n')
      for (const secret of ['Nepanna', 'Nepgebied', 'Best skipper', 'eerder reven']) expect(wire).not.toContain(secret)
      expect(errors).toEqual([])
    })
  })
}
