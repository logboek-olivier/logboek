import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Carrière: een sollicitatie met de volgende actie (die bij de termijnen staat), een contact met alleen een voornaam en
// een project; bekijken, bewerken en verwijderen met ongedaan maken. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/carriere/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })

    test(`carrière: sollicitatie met volgende actie als termijn, netwerk met voornaam, project (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const sheet = page.getByRole('dialog')
      const toast = page.locator('.toast')
      await openMore(page, L('career.screen'), L('nav.more'))
      await expect(page.getByText(L('career.applicationsEmpty'))).toBeVisible()

      // Sollicitatie met een volgende actie.
      await page.getByRole('button', { name: L('career.newApplication') }).click()
      await sheet.getByLabel(L('career.company')).fill('Nepwerf')
      await sheet.getByLabel(L('career.role'), { exact: true }).fill('Nepskipper')
      await sheet.getByLabel(L('career.status')).selectOption('gesprek')
      await sheet.getByLabel(L('career.nextAction')).fill('Nabellen')
      await sheet.getByLabel(L('career.nextDate')).fill('2031-05-04')
      await shots(page, 'sollicitatie', lang)
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('career.saved'))
      const appRow = page.locator('.row-button', { hasText: 'Nepwerf' })
      await expect(appRow).toContainText(L('career.status.gesprek'))
      await expect(appRow).toContainText('Nabellen')

      // Contact: alleen de voornaam blijft over.
      await page.getByRole('button', { name: L('career.newContact') }).click()
      await sheet.getByLabel(L('career.firstName')).fill('Nepnoor Nepachternaam')
      await sheet.getByLabel(L('career.contactRole')).fill('Nepschipper')
      await sheet.getByLabel(L('career.metAt')).fill('Nephaven')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.row-button', { hasText: 'Nepnoor' })).toBeVisible()
      await expect(page.getByText('Nepachternaam')).toHaveCount(0)

      // Project.
      await page.getByRole('button', { name: L('career.newProject') }).click()
      await sheet.getByLabel(L('career.projectName')).fill('Nepproject')
      await sheet.getByRole('radio', { name: L('career.project.gepauzeerd') }).click()
      await sheet.getByLabel(L('career.nextStep')).fill('Nepstap')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.row-button', { hasText: 'Nepproject' })).toContainText(L('career.project.gepauzeerd'))
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await shots(page, 'overzicht', lang)

      // Bekijken, bewerken (aangenomen: geen termijn meer), verwijderen met ongedaan maken.
      await appRow.click()
      await expect(sheet.locator('.view-rows')).toContainText('Nepskipper')
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await sheet.getByRole('button', { name: L('common.delete') }).click()
      await expect(appRow).toHaveCount(0)
      await page.getByRole('button', { name: L('common.undo') }).click()
      await expect(appRow).toBeVisible()

      // De volgende actie staat bij de termijnen.
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('reminder.screen'), L('nav.more'))
      await expect(page.locator('.due-list')).toContainText('Nepwerf: Nabellen')
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      // Vandaag (studenten kijken mee): wel de termijn, niet het bedrijf.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
      await expect(page.locator('.due-list')).toContainText(L('career.dueTitle'))
      await expect(page.locator('.due-list')).not.toContainText('Nepwerf')
      expect(github.requests.some((r) => r.method === 'PUT' && r.url.endsWith('/contents/career.json.enc'))).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
