import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Fooi per persoon: deelnemers met voornaam, optioneel land en kort kenmerk (dubbele voornaam: "Nick B." of
// "Nick (VS)"); fooi van één of meer personen (per persoon of samen), de hele groep of onbekend; terugkerende gasten
// pas gekoppeld na "ja"; overzichten onder Geld. Alle namen verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/fooi/${name}-${width}-${scheme}-${lang}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, params)
    const eur = (n: number) => (lang === 'nl' ? `€ ${n},00` : `€${n}.00`)

    test(`fooi per persoon: deelnemers, van wie, terugkerende gast, overzichten (${lang})`, async ({ page }) => {
      // Maandag 8 maart 2027; de tijd loopt door.
      await page.clock.setSystemTime(new Date('2027-03-08T10:00:00'))
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const nav = page.getByRole('navigation')
      const sheet = page.getByRole('dialog')
      const row = (n: number) => ({
        name: sheet.getByLabel(L('week.participantName', { n }), { exact: true }),
        country: sheet.getByLabel(L('week.participantCountry', { n }), { exact: true }),
        tag: sheet.getByLabel(L('week.participantTag', { n }), { exact: true }),
      })

      // Een eerdere trip in februari met Nick uit de VS.
      await nav.getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.getByRole('button', { name: L('week.new') }).first().click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Een')
      await sheet.getByLabel(L('week.startDate')).fill('2027-02-01')
      await row(1).name.fill('Nick')
      await row(1).country.fill('VS')
      await sheet.getByRole('button', { name: L('week.start') }).click()

      // De lopende trip: twee keer Nick, de app vraagt om land of kenmerk.
      await page.getByRole('button', { name: L('week.new') }).first().click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Twee')
      await row(1).name.fill('Nick')
      await row(1).country.fill('VS')
      await row(2).name.fill('Nick')
      await expect(sheet.getByText(L('guest.duplicate', { name: 'Nick' }))).toHaveCount(1)
      await row(2).country.fill('VS')
      await expect(sheet.getByText(L('guest.duplicate', { name: 'Nick' }))).toHaveCount(2)
      await row(2).country.fill('')
      await row(2).tag.fill('B')
      await expect(sheet.getByText(L('guest.duplicate', { name: 'Nick' }))).toHaveCount(0)
      await row(3).name.fill('Nepanna')
      await row(3).country.fill('NL')
      await shots(page, 'deelnemers', lang)
      await sheet.getByRole('button', { name: L('week.start') }).click()

      const chips = page.locator('.participant-chips')
      await expect(chips).toContainText('Nick (VS)')
      await expect(chips).toContainText('Nick B.')
      await expect(chips).toContainText('Nepanna')
      // Terugkerende gast: pas koppelen na "ja".
      const question = page.locator('.returning-guest')
      await expect(question).toHaveCount(1)
      await expect(question).toContainText(L('guest.same', { name: 'Nick (VS)', previous: 'Nick (VS)', trip: 'Nepweek Een' }))
      await shots(page, 'terugkerende-gast', lang)
      await question.getByRole('button', { name: L('guest.yes') }).click()
      await expect(question).toHaveCount(0)

      // Fooi van twee personen, per persoon: het totaal is de som.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await expect(page.getByRole('combobox', { name: new RegExp(`^${L('field.trip')}`) })).toHaveValue(/.+/)
      await page.getByRole('button', { name: 'Nick (VS)', exact: true }).click()
      await page.getByRole('button', { name: 'Nepanna', exact: true }).click()
      await page.getByRole('radio', { name: L('tip.perPerson') }).click()
      await page.getByLabel(L('tip.amountFor', { name: 'Nick (VS)' })).fill('40')
      await page.getByLabel(L('tip.amountFor', { name: 'Nepanna' })).fill('20')
      await expect(page.getByLabel(L('field.amount'), { exact: true })).toHaveValue('60')
      await shots(page, 'van-wie', lang)
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()

      // Fooi van de hele groep.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await page.getByLabel(L('field.amount'), { exact: true }).fill('30')
      await page.getByRole('button', { name: L('tip.group') }).click()
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()

      // Fooi in de eerdere trip (de trip volgt de datum) van Nick.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabIncome') }).click()
      await page.getByLabel(L('field.amount'), { exact: true }).fill('15')
      await page.getByLabel(L('field.date')).fill('2027-02-03')
      await page.getByRole('button', { name: 'Nick', exact: true }).click()
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible()

      // Overzichten onder Geld: Nick (VS) samen over twee trips: 40 + 10 + 15 = 65.
      await openMore(page, L('nav.money'), L('nav.more'))
      const overview = page.locator('.tip-overview')
      await expect(overview.locator('tbody tr').first()).toContainText('Nick (VS)')
      await expect(overview.locator('tbody tr').first()).toContainText(eur(65))
      await expect(overview.locator('tbody tr').first()).toContainText(L('money.trips', { n: 2 }))
      await expect(overview).toContainText('Nick B.')
      await shots(page, 'per-gast', lang)
      await overview.getByRole('radio', { name: L('money.tipsByTrip'), exact: true }).click()
      // Nepweek Twee: 90 over 3 gasten = 30 per gast.
      await expect(overview.locator('tbody tr', { hasText: 'Nepweek Twee' })).toContainText(eur(30))
      await overview.getByRole('radio', { name: L('money.tipsByCountry') }).click()
      await expect(overview.locator('tbody tr').first()).toContainText('VS')
      await shots(page, 'per-land', lang)

      // Achteraf wijzigen: de fooi van twee personen wordt "samen gegeven".
      await page.locator('.tx button', { hasText: lang === 'nl' ? '€ 60,00' : '€60.00' }).first().click()
      // Eerst de weergave met van wie; bewerken via het potlood.
      await expect(sheet).toContainText('Nick (VS)')
      await sheet.getByRole('button', { name: L('common.edit') }).click()
      await expect(sheet.getByRole('radio', { name: L('tip.perPerson') })).toHaveAttribute('aria-checked', 'true')
      await sheet.getByRole('radio', { name: L('tip.together') }).click()
      await sheet.getByLabel(L('field.amount'), { exact: true }).fill('60')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      // Samen gegeven: 30 voor Nick (VS) in plaats van 40.
      await overview.getByRole('radio', { name: L('money.tipsByGuest'), exact: true }).click()
      await expect(overview.locator('tbody tr').first()).toContainText(eur(55))

      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      // Namen en landen gaan alleen versleuteld naar GitHub.
      expect(github.requests.some((r) => /Nepanna|Nick|"VS"/.test(r.body ?? ''))).toBe(false)
      expect(errors).toEqual([])
    })
  })
}
