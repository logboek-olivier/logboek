import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Ronde 3 · PR 6: declaraties. + → Declaratie met een foto van het bonnetje (versleuteld in de kluis, de naam staat
// nergens in een verzoek), automatisch bij de trip van vandaag, per trip een lijst met de status, "Bonnetje delen" met
// daarna "Ingediend?", en "Terugbetaling invoeren" (bij Geld als terugbetaling, niet als verdiend). Open declaraties met
// een bedrag tellen als te ontvangen in Mijn positie. Alle gegevens verzonnen.

const NEP_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test.use({ viewport: { width: 360, height: 800 } })

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/declaraties/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`declaraties: bonnetje, bij de trip, delen en ingediend, terugbetaald (${lang})`, async ({ page }) => {
      test.setTimeout(150_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const toast = page.locator('.toast')
      // Delen: de deelfunctie van de telefoon nabootsen (het bestand en de naam onthouden).
      await page.addInitScript(() => {
        const shared: { name: string; type: string; title?: string }[] = []
        ;(window as unknown as { __shared: typeof shared }).__shared = shared
        Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
        Object.defineProperty(navigator, 'share', {
          value: async (data: { files?: File[]; title?: string }) => {
            for (const f of data.files ?? []) shared.push({ name: f.name, type: f.type, ...(data.title ? { title: data.title } : {}) })
          },
          configurable: true,
        })
      })
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)

      // Een trip die vandaag loopt.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.getByRole('main').getByRole('button', { name: L('week.new') }).first().click()
      let sheet = page.getByRole('dialog')
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek declaratie')
      await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Sailing Virgins' })
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(toast).toHaveCount(0, { timeout: 15_000 })

      // + → Declaratie: foto uit de galerij, notitie en bedrag.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabClaim') }).click()
      await page.getByLabel(L('claims.fromGallery')).setInputFiles({ name: 'nep-bonnetje.png', mimeType: 'image/png', buffer: NEP_PNG })
      await expect(page.locator('.claim-preview')).toBeVisible()
      await page.getByLabel(L('claims.note')).fill('Nepdiesel')
      await page.getByLabel(L('claims.amount')).fill(lang === 'nl' ? '42,50' : '42.50')
      await expect(page.getByRole('combobox', { name: L('field.trip') })).toHaveValue(/.+/)
      await shots(page, 'nieuw', lang)
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toContainText(L('claims.saved'))
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      // Het bonnetje gaat versleuteld de kluis in: de notitie en de bestandsnaam staan nergens in een verzoek.
      await expect.poll(() => github.requests.some((r) => r.method === 'PUT' && r.url.includes('/contents/documents/')), { timeout: 20_000 }).toBe(true)
      const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
      expect(wire).not.toContain('nep-bonnetje')
      expect(wire).not.toContain('Nepdiesel')

      // In de trip: de declaratie met status open.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      const list = page.locator('.trip-claims')
      await expect(list).toContainText('Nepdiesel')
      await expect(list).toContainText(L('claimStatus.open'))
      await list.getByRole('button', { name: /Nepdiesel/ }).click()
      const view = page.getByRole('dialog')
      await expect(view.locator('.claim-receipt')).toBeVisible()
      await shots(page, 'declaratie', lang)

      // Delen met de app van de organisatie: een neutrale bestandsnaam, geen titel; daarna "Ingediend?".
      await view.getByRole('button', { name: L('claims.share') }).click()
      await expect(view.getByText(L('claims.askSubmitted'))).toBeVisible()
      const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; title?: string }[] }).__shared)
      // Een foto wordt op het apparaat verkleind tot JPEG (zonder EXIF of locatie).
      expect(shared).toEqual([{ name: 'bonnetje.jpg', type: 'image/jpeg' }])
      await view.getByRole('button', { name: L('claims.yesSubmitted') }).click()
      await expect(toast).toContainText(L('claims.submittedToast'))
      await expect(view).toContainText(L('claimStatus.ingediend'))

      // Mijn positie: de ingediende declaratie telt als te ontvangen.
      await view.getByRole('button', { name: L('common.close') }).click()
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('nav.money'), L('nav.more'))
      await expect(page.locator('.position')).toContainText(L('position.receivable'))
      await expect(page.locator('.position')).toContainText(lang === 'nl' ? '€ 42,50' : '€42.50')

      // Terugbetaald: een inkomen van soort terugbetaling; niet meer te ontvangen.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.locator('.trip-claims').getByRole('button', { name: /Nepdiesel/ }).click()
      await page.getByRole('dialog').getByRole('button', { name: L('claims.markRepaid') }).click()
      sheet = page.getByRole('dialog').last()
      await expect(sheet.getByLabel(L('claims.repaidAmount'))).toHaveValue(lang === 'nl' ? '42,50' : '42.50')
      await sheet.getByRole('button', { name: L('claims.saveRepaid') }).click()
      await expect(toast).toContainText(L('claims.repaidToast'))
      await expect(page.getByRole('dialog')).toContainText(L('claimStatus.terugbetaald'))
      await page.getByRole('dialog').getByRole('button', { name: L('common.close') }).click()
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('nav.money'), L('nav.more'))
      await expect(page.getByRole('heading', { name: L('nav.money') })).toBeVisible()
      await expect(page.locator('.position-group', { hasText: L('position.receivable') })).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
