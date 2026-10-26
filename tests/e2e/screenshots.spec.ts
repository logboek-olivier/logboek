import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

// Schermafbeeldingen van elk scherm op 360 en 412 px, licht en donker. CI uploadt de map screenshots/ als artifact,
// zodat ze vóór het mergen bekeken kunnen worden. Elk scherm wordt ook op horizontale overloop gecontroleerd.

const fixture = new URL('../fixtures/mijlen-nep.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function addTip(page: Page, amount: string, daysAgo: number) {
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByLabel('Bedrag').fill(amount)
  await page.getByLabel('Datum').fill(isoDaysAgo(daysAgo))
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
}

for (const width of [360, 412]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`schermafbeeldingen ${width} px ${scheme === 'light' ? 'licht' : 'donker'}`, async ({ page }) => {
      test.setTimeout(120_000)
      const errors = collectConsoleErrors(page)
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      let n = 0
      const shot = async (name: string) => {
        await expectNoHorizontalOverflow(page)
        // Geen bevestiging over de inhoud heen, en bovenaan beginnen (vaste maandkoppen).
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5_000 })
        await page.evaluate(() => window.scrollTo(0, 0))
        n++
        const path = `screenshots/${width}-${scheme}/${String(n).padStart(2, '0')}-${name}`
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

      await mockGithub(page)
      await page.goto('./')
      await expect(page.getByRole('heading', { name: 'Eerste keer' })).toBeVisible()
      await shot('eerste-keer')

      await createNewLogbook(page)
      await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
      await shot('vandaag-leeg')
      await page.getByRole('button', { name: 'Zeilen' }).click()
      await shot('zeilen-leeg')
      await page.getByRole('button', { name: 'Geld' }).click()
      await shot('geld-leeg')

      // Gegevens: import van de nep-werkmap, een paar fooien en kosten, twee dagen.
      await page.getByRole('button', { name: 'Zeilen' }).click()
      await page.getByLabel('Mijlenbestand').setInputFiles(fixture)
      await expect(page.getByRole('heading', { name: 'Controle import' })).toBeVisible()
      await shot('import-controle')
      await page.getByRole('button', { name: 'Importeren' }).click()
      for (const [amount, days] of [
        ['85', 2],
        ['120,50', 9],
        ['64', 17],
        ['140', 30],
        ['95', 45],
        ['30', 70],
      ] as const) {
        await addTip(page, amount, days)
      }
      await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
      await page.getByRole('tab', { name: 'Kosten' }).click()
      await shot('toevoegen-kosten')
      await page.getByLabel('Bedrag').fill('42,80')
      await page.getByLabel('Omschrijving').fill('Havengeld Nephaven')
      await page.getByRole('button', { name: 'Opslaan' }).click()
      await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
      await shot('toevoegen-fooi')
      await page.getByRole('tab', { name: 'Dag' }).click()
      await page.getByRole('button', { name: 'Meer' }).click()
      await shot('toevoegen-dag-meer')
      await page.getByLabel('Naar (plaats)').fill('Nepbaai')
      await page.getByLabel('Zeemijlen').fill('23,5')
      await page.getByLabel('Boot').fill('Nepboot Vijf')
      await page.getByLabel('Naam tocht').fill('Overtocht naar de Nepbaai met een lange naam')
      await page.getByRole('button', { name: 'Opslaan' }).click()

      await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
      await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
      await shot('vandaag')
      await page.getByRole('button', { name: 'Zeilen' }).click()
      await page.locator('.trip').first().getByRole('button').click()
      await shot('zeilen')
      await page.getByRole('button', { name: 'Geld' }).click()
      await shot('geld')
      await page.getByRole('button', { name: 'Instellingen' }).click()
      await page.getByRole('button', { name: 'Back-up maken' }).click()
      await shot('instellingen')
      await page.getByRole('button', { name: 'Vergrendelen' }).click()
      await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
      await shot('ontgrendelen')
      expect(errors).toEqual([])
    })
  }
}
