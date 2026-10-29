import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Notitievelden: een tekstvak dat meegroeit met de tekst (drie tot ongeveer tien regels), met Enter voor een nieuwe regel
// (inspreken via het toetsenbord); de pagina krimpt mee met het toetsenbord. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/notities/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })

    test(`notities: meegroeiend tekstvak, Enter voor een nieuwe regel, pagina krimpt mee met het toetsenbord (${lang})`, async ({ page }) => {
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      await mockGithub(page)
      await createNewLogbook(page, lang)
      const nav = page.getByRole('navigation')
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')

      const note = page.getByRole('textbox', { name: L('field.note'), exact: true })
      await expect(note).toHaveJSProperty('tagName', 'TEXTAREA')
      await expect(note).toHaveAttribute('autocapitalize', 'sentences')
      // De pagina krimpt mee met het toetsenbord, zodat het veld erboven blijft.
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /interactive-widget=resizes-content/)
      const empty = (await note.boundingBox())!.height
      await note.focus()
      // Inspreken: zinnen achter elkaar, Enter voor een nieuwe regel (Enter verstuurt het formulier niet).
      await note.pressSequentially('Mooie oversteek met vier gasten.')
      await note.press('Enter')
      await note.pressSequentially('Wind draaide na de lunch naar het westen.')
      await note.press('Enter')
      await note.pressSequentially('Anker hield goed in het zand.')
      await expect(page.getByRole('button', { name: L('common.save') })).toBeVisible()
      await expect(note).toHaveValue('Mooie oversteek met vier gasten.\nWind draaide na de lunch naar het westen.\nAnker hield goed in het zand.')
      const three = (await note.boundingBox())!.height
      expect(three).toBeGreaterThanOrEqual(empty)
      await note.press('Enter')
      await note.pressSequentially('Nog een regel.\nEn nog een.\nEn de laatste.')
      const six = (await note.boundingBox())!.height
      // Het veld groeit mee, maar niet eindeloos: hoogstens ongeveer tien regels.
      expect(six).toBeGreaterThan(three)
      await note.fill(Array.from({ length: 30 }, (_, i) => `Regel ${i + 1}`).join('\n'))
      const many = (await note.boundingBox())!.height
      expect(many).toBeLessThan(400)
      await note.fill('Mooie oversteek met vier gasten.\nAnker hield goed in het zand.')
      await shots(page, 'dag', lang)
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.locator('.toast')).toHaveText(L('toast.daySaved'))
      expect(errors).toEqual([])
    })
  })
}
