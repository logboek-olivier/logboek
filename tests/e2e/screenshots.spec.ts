import { expect, test } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Schermafbeeldingen van elk scherm op 360 en 412 px, licht en donker, in het Nederlands; plus Engels op 360 px.
// CI uploadt de map screenshots/ als artifact. Elk scherm wordt ook op horizontale overloop gecontroleerd.
// Knoppen en velden worden gevonden via de vertalingen zelf, zodat dezelfde stappen in beide talen werken.

const fixture = new URL('../fixtures/mijlen-nep.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const RUNS: { width: number; scheme: 'light' | 'dark'; lang: Lang }[] = [
  { width: 360, scheme: 'light', lang: 'nl' },
  { width: 360, scheme: 'dark', lang: 'nl' },
  { width: 412, scheme: 'light', lang: 'nl' },
  { width: 412, scheme: 'dark', lang: 'nl' },
  { width: 360, scheme: 'light', lang: 'en' },
  { width: 360, scheme: 'dark', lang: 'en' },
]

for (const { width, scheme, lang } of RUNS) {
  test.describe(`${lang} ${width} ${scheme}`, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`schermafbeeldingen ${width} px ${scheme === 'light' ? 'licht' : 'donker'} ${lang}`, async ({ page }) => {
      test.setTimeout(150_000)
      const L = (key: MessageKey) => translate(lang, key as 'common.save')
      const button = (key: MessageKey, exact = true) => page.getByRole('button', { name: L(key), exact })
      const errors = collectConsoleErrors(page)
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      let n = 0
      const shot = async (name: string) => {
        await expectNoHorizontalOverflow(page)
        // Geen bevestiging over de inhoud heen, en bovenaan beginnen (vaste maandkoppen).
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6_000 })
        await page.evaluate(() => window.scrollTo(0, 0))
        n++
        const path = `screenshots/${width}-${scheme}${lang === 'nl' ? '' : `-${lang}`}/${String(n).padStart(2, '0')}-${name}`
        // Volledige pagina met de onderbalk onderaan in plaats van zwevend halverwege, plus het scherm zoals op de telefoon.
        // Via CSSOM (CSP staat dat toe, een geïnjecteerd stylesheet niet).
        const setBar = (position: string) =>
          page.evaluate((p) => {
            const bar = document.querySelector<HTMLElement>('.bottom-bar')
            if (bar) bar.style.position = p
          }, position)
        await page.screenshot({ path: `${path}-scherm.png` })
        await setBar('static')
        await page.screenshot({ path: `${path}.png`, fullPage: true })
        await setBar('')
      }
      const addTip = async (amount: string, daysAgo: number) => {
        await button('nav.add').click()
        await page.getByLabel(L('field.amount')).fill(amount)
        await page.getByLabel(L('field.date')).fill(isoDaysAgo(daysAgo))
        await button('common.save').click()
        await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      }

      await mockGithub(page)
      await page.goto('./')
      await expect(page.getByRole('heading', { name: L('setup.title') })).toBeVisible()
      await shot('eerste-keer')

      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      await shot('vandaag-leeg')
      await button('nav.sailing').click()
      await shot('zeilen-leeg')
      await button('nav.money').click()
      await shot('geld-leeg')

      // Gegevens: import van de nep-werkmap, een paar fooien en kosten, twee dagen.
      await button('nav.sailing').click()
      await page.getByLabel(L('import.file')).setInputFiles(fixture)
      await expect(page.getByRole('heading', { name: L('import.check') })).toBeVisible()
      await shot('import-controle')
      await button('import.import').click()
      for (const [amount, days] of [
        ['85', 2],
        ['120,50', 9],
        ['64', 17],
        ['140', 30],
        ['95', 45],
        ['30', 70],
      ] as const) {
        await addTip(amount, days)
      }
      await button('nav.add').click()
      await page.getByRole('tab', { name: L('quick.tabCost') }).click()
      await shot('toevoegen-kosten')
      await page.getByLabel(L('field.amount')).fill('42,80')
      await page.getByLabel(L('field.description')).fill('Havengeld Nephaven')
      await button('common.save').click()
      await button('nav.add').click()
      await shot('toevoegen-fooi')
      await page.getByRole('tab', { name: L('quick.tabDay') }).click()
      await button('common.more').click()
      await shot('toevoegen-dag-meer')
      await page.getByLabel(L('field.toPlace')).fill('Nepbaai')
      await page.getByLabel(L('field.nm')).fill('23,5')
      await page.getByLabel(L('field.boat')).fill('Nepboot Vijf')
      await page.getByLabel(L('field.tripName')).fill('Overtocht naar de Nepbaai met een lange naam')
      await button('common.save').click()

      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      await shot('vandaag')
      await button('nav.sailing').click()
      await page.locator('.trip').first().getByRole('button').first().click()
      await shot('zeilen')
      await page.locator('.leg-button').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('dag-bewerken')
      await button('common.close').click()
      await button('nav.money').click()
      await shot('geld')
      await page.locator('.tx button').first().click()
      await shot('transactie-bewerken')
      await button('common.close').click()
      await button('nav.settings').click()
      await button('settings.backup').click()
      await shot('instellingen')
      await button('settings.lock').click()
      await expect(button('unlock.unlock')).toBeVisible()
      await shot('ontgrendelen')
      expect(errors).toEqual([])
    })
  })
}
