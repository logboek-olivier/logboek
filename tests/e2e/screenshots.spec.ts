import { expect, test } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { mockRates } from './helpers/rates'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openLogbook, openMore, fillBoat } from './helpers/logbook'

// Schermafbeeldingen van elk scherm op 360 en 412 px, licht en donker, in het Nederlands en het Engels.
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
  { width: 412, scheme: 'light', lang: 'en' },
  { width: 412, scheme: 'dark', lang: 'en' },
]

for (const { width, scheme, lang } of RUNS) {
  test.describe(`${lang} ${width} ${scheme}`, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })

    test(`schermafbeeldingen ${width} px ${scheme === 'light' ? 'licht' : 'donker'} ${lang}`, async ({ page }) => {
      test.setTimeout(300_000)
      const L = (key: MessageKey) => translate(lang, key as 'common.save')
      const button = (key: MessageKey, exact = true) => page.getByRole('button', { name: L(key), exact })
      const errors = collectConsoleErrors(page)
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      let n = 0
      const shot = async (name: string) => {
        await expectNoHorizontalOverflow(page)
        // Geen bevestiging over de inhoud heen, en bovenaan beginnen (vaste maandkoppen).
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 12_000 })
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
        await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
        await page.getByLabel(L('field.amount')).fill(amount)
        await page.getByLabel(L('field.date')).fill(isoDaysAgo(daysAgo))
        await button('common.save').click()
        await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      }

      await mockGithub(page)
      await mockRates(page)
      await page.goto('./')
      await expect(page.getByRole('heading', { name: L('setup.title') })).toBeVisible()
      await shot('eerste-keer')

      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      await shot('vandaag-leeg')
      await button('nav.calendar').click()
      await shot('agenda-leeg')
      await openLogbook(page, lang)
      await shot('zeilen-leeg')
      await page.getByRole('navigation').getByRole('button', { name: L('nav.more'), exact: true }).click()
      await shot('meer')
      await openMore(page, L('nav.money'), L('nav.more'))
      await shot('geld-leeg')

      // Gegevens: import van de nep-werkmap, een paar fooien en kosten, twee dagen.
      await openLogbook(page, lang)
      await page.getByLabel(L('import.file')).setInputFiles(fixture)
      await expect(page.getByRole('heading', { name: L('import.check') })).toBeVisible()
      await shot('import-controle')
      await button('import.import').click()
      await expect(page.getByRole('heading', { name: L('boats.check') })).toBeVisible()
      await shot('boten-controle')
      await button('gaps.skip').click()
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
      await page.getByRole('tab', { name: L('quick.tabExpense') }).click()
      await shot('toevoegen-kosten')
      await page.getByLabel(L('field.amount')).fill('42,80')
      await page.getByLabel(L('field.description')).fill('Havengeld Nephaven')
      await button('common.save').click()
      await button('nav.add').click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await shot('toevoegen-fooi')
      await page.getByRole('tab', { name: L('quick.tabDay') }).click()
      // Een eerdere overtocht: een trip uit Dag is lopend tot drie dagen na zijn laatste dag, dus ruim daarvoor.
      await page.getByLabel(L('field.date'), { exact: true }).fill(isoDaysAgo(20))
      await page.getByLabel(L('field.to'), { exact: true }).fill('Nepbaai')
      await page.getByLabel(L('field.nm')).fill('23,5')
      await page.getByLabel(L('field.boat'), { exact: true }).fill('Nepboot Vijf')
      await page.getByRole('combobox', { name: L('field.week'), exact: true }).selectOption({ label: L('quick.newWeek') })
      await page.getByLabel(L('field.weekName')).fill('Overtocht naar de Nepbaai met een lange naam')
      await shot('toevoegen-dag')
      await button('common.save').click()

      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      await shot('vandaag')
      await button('nav.week').click()
      await shot('deze-week-leeg')
      await page.getByRole('main').getByRole('button', { name: L('week.new') }).click()
      const weekSheet = page.getByRole('dialog')
      await fillBoat(weekSheet, lang, 'Nepboot Vijf')
      await weekSheet.getByLabel(L('week.area')).fill('Nepgebied')
      for (const [n, name, level] of [[1, 'Nepanna', 'level.beginner'], [2, 'Nepbram', 'level.gevorderd'], [3, 'Nepcees', 'level.gemiddeld']] as const) {
        const T = translate as (l: Lang, k: MessageKey, p: { n: number }) => string
        await weekSheet.getByLabel(T(lang, 'week.participantName', { n }), { exact: true }).fill(name)
        await weekSheet.getByRole('combobox', { name: T(lang, 'week.participantLevel', { n }) }).selectOption({ label: L(level) })
        await weekSheet.getByRole('combobox', { name: T(lang, 'week.participantCourse', { n }) }).selectOption('seed-asa-101')
      }
      await shot('nieuwe-week')
      await button('week.start').click()
      await expect(page.locator('.student')).toHaveCount(3)
      await shot('deze-week')
      await page.locator('.student button').first().click()
      for (const row of [0, 1, 1, 3, 5]) await page.locator('.check-row').nth(row).click()
      await shot('student')
      await button('students.edit', false).click()
      await shot('student-bewerken')
      await button('common.close').click()
      await page.getByRole('button', { name: L('students.backToList') }).click()
      await shot('studenten')
      await button('students.groupTick').click()
      await shot('groep-afvinken')
      await button('common.close').click()
      await button('plan.new').click()
      await page.getByLabel(L('plan.dayCount')).fill('4')
      await button('plan.next').click()
      await button('plan.addGroup').click()
      await page.locator('.plan-group').nth(1).getByRole('radio', { name: L('level.gevorderd') }).click()
      await shot('planning-groepen')
      await button('plan.makeConcept').click()
      await shot('planning-concept')
      await button('plan.save').click()
      await page.locator('.plan-theme.tick').first().click()
      await shot('planning')
      await page.locator('.plan-block-head button:last-child').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('blok-bewerken')
      await button('common.close').click()
      await button('plan.present').click()
      await shot('tonen')
      await button('plan.stopPresenting').click()
      await button('nav.today').click()
      await shot('vandaag-planning')
      await openMore(page, L('nav.studentArchive'), L('nav.more'))
      await shot('studentenarchief')
      await openMore(page, L('curriculum.courses'), L('nav.more'))
      await shot('cursussen')
      await page.getByRole('button', { name: /ASA 101/ }).click()
      await shot('cursus')
      await button('common.edit').click()
      await page.locator('.topic button').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('onderwerp-bewerken')
      await button('common.close').click()
      await button('curriculum.done').click()
      await openLogbook(page, lang)
      await shot('zeilen')
      // Eerst bekijken, bewerken via het potlood: tripoverzicht, dag, dag bewerken.
      await page.locator('.trip').first().getByRole('button').first().click()
      const overview = page.getByRole('dialog')
      await expect(overview).toBeVisible()
      await shot('tripoverzicht')
      // Geld van de trip achter "Toon bedragen": het resultaat van de trip.
      if ((await overview.getByRole('button', { name: L('week.showAmounts') }).count()) > 0) {
        await overview.getByRole('button', { name: L('week.showAmounts') }).click()
        await overview.locator('.trip-result').scrollIntoViewIfNeeded()
        await shot('tripoverzicht-geld')
      }
      await page.locator('.leg-button').first().click()
      const day = page.getByRole('dialog').last()
      await expect(day.locator('.view-rows')).toBeVisible()
      await shot('dag')
      await day.getByRole('button', { name: L('common.edit') }).click()
      await expect(page.getByRole('dialog').last().getByRole('button', { name: L('common.delete') })).toBeVisible()
      await shot('dag-bewerken')
      await page.getByRole('dialog').last().getByRole('button', { name: L('common.close') }).click()
      // Trip bewerken: salaris en de fooien en inkomsten van de trip.
      await overview.getByRole('button', { name: L('common.edit') }).click()
      const tripEdit = page.getByRole('dialog')
      await tripEdit.getByRole('button', { name: new RegExp(`^${L('salary.title')}`) }).click()
      await tripEdit.getByRole('button', { name: new RegExp(L('tripIncome.title')) }).click()
      await tripEdit.locator('.trip-income').scrollIntoViewIfNeeded()
      await shot('trip-bewerken-geld')
      await tripEdit.getByRole('button', { name: L('common.close') }).click()
      await openMore(page, L('nav.money'), L('nav.more'))
      await shot('geld')
      await page.locator('.tx button').first().click()
      await shot('transactie')
      await button('common.edit').click()
      await shot('transactie-bewerken')
      await button('common.close').click()
      await openMore(page, L('nav.stats'), L('nav.more'))
      await page.getByRole('radio', { name: L('stats.all') }).click()
      await button('week.showAmounts').click()
      await shot('statistieken')
      await openMore(page, L('nav.storage'), L('nav.more'))
      await button('storage.checkNow').click()
      await expect(button('storage.checking')).toHaveCount(0, { timeout: 30_000 })
      await expect(page.locator('.storage-ok')).toBeVisible()
      await shot('opslag')
      await openMore(page, L('nav.settings'), L('nav.more'))
      await shot('instellingen')
      await button('settings.lock').click()
      await expect(button('unlock.unlock')).toBeVisible()
      await shot('ontgrendelen')
      expect(errors).toEqual([])
    })
  })
}
