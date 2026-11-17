import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openMore } from './helpers/logbook'

// Vandaag doen op 360 px (src/components/TodoToday.tsx): de weektaken van een lesweek op hun dag, te laat in rood,
// afvinken met ongedaan maken, de boodschappenlijst delen, "Morgen: …", en het blok Taken op de trip. Alle namen zijn
// verzonnen.

test.use({ viewport: { width: 360, height: 800 } })

for (const lang of ['nl', 'en'] as const) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB' })
    const L = (key: Parameters<typeof translate>[1], p?: unknown) => (translate as (l: Lang, k: string, p?: unknown) => string)(lang, key, p)

    async function shots(page: Page, name: string) {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await expectNoHorizontalOverflow(page)
        await page.screenshot({ path: `screenshots/vandaag-doen/${name}-360-${scheme}-${lang}.png`, fullPage: true })
      }
      await page.emulateMedia({ colorScheme: 'light' })
    }

    test('weektaken: op hun dag, te laat, afvinken, boodschappenlijst delen, morgen en Taken op de trip', async ({ page }) => {
      // Zaterdag 13 maart 2027; de lesweek begint zondag 14 maart.
      await page.clock.setSystemTime(new Date('2027-03-13T08:00:00'))
      await page.addInitScript(() => {
        const w = window as unknown as { __shared: string[] }
        w.__shared = []
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: { text?: string }) => void w.__shared.push(data.text ?? '') })
      })
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang, { olivier: true })
      const sheet = page.getByRole('dialog')

      // Een lesweek bij Sailing Virgins.
      await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
      await page.getByRole('main').getByRole('button', { name: L('week.new') }).click()
      await sheet.getByLabel(L('field.name'), { exact: true }).fill('Neples')
      await sheet.getByRole('radio', { name: L('weekType.training-geven') }).click()
      await sheet.getByLabel(L('week.startDate')).fill('2027-03-14')
      await fillBoat(sheet, lang, 'Nepster')
      await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Sailing Virgins' })
      await sheet.getByRole('button', { name: L('week.start') }).click()
      await expect(sheet).toHaveCount(0)

      // Vandaag: introductie (woensdag, te laat), boodschappenlijst (gisteren) en lesplanning (vandaag).
      await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
      const todo = page.locator('.todo-today')
      await expect(todo.getByRole('heading', { name: L('todo.title') })).toBeVisible()
      const rows = todo.locator('.todo-row')
      await expect(rows).toHaveCount(3)
      await expect(rows.nth(0)).toContainText(L('task.introductie'))
      await expect(rows.nth(0)).toContainText(L('todo.late', { n: 3 }))
      await expect(rows.nth(1)).toContainText(L('task.boodschappen'))
      await expect(rows.nth(1)).toContainText(L('todo.late', { n: 1 }))
      await expect(rows.nth(2)).toContainText(L('task.lesplanning'))
      await expect(rows.nth(2)).toContainText(L('expiry.today'))
      await expect(todo.locator('.todo-tomorrow')).toContainText(L('task.safety'))
      await expect(page.getByRole('main')).not.toContainText('€')
      await shots(page, 'vandaag')

      // De boodschappenlijst: delen (nagebootst deelmenu), dan Verstuurd; weg van de lijst.
      await rows.nth(1).locator('.todo-main').click()
      await expect(sheet.getByRole('heading', { name: L('msgKind.boodschappen') })).toBeVisible()
      await shots(page, 'boodschappen')
      await sheet.getByRole('button', { name: L('msg.share') }).click()
      const shared = await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)
      expect(shared).toHaveLength(1)
      expect(shared[0]).toContain('provisioning list')
      expect(shared[0]).toContain('Sunday')
      await sheet.getByRole('button', { name: L('msg.sent'), exact: true }).click()
      await expect(sheet).toHaveCount(0)
      await expect(rows).toHaveCount(2)

      // Lesplanning afvinken met het rondje; ongedaan maken zet hem terug.
      await todo.getByRole('button', { name: L('todo.markAria', { task: L('task.lesplanning') }) }).click()
      await expect(rows).toHaveCount(1)
      await page.locator('.toast').getByRole('button', { name: L('common.undo') }).click()
      await expect(rows).toHaveCount(2)
      await todo.getByRole('button', { name: L('todo.markAria', { task: L('task.lesplanning') }) }).click()
      await expect(rows).toHaveCount(1)

      // Introductie: niet nodig.
      await rows.nth(0).locator('.todo-main').click()
      await sheet.getByRole('button', { name: L('msg.notNeeded') }).click()
      await expect(todo).toContainText(L('todo.none'))

      // De trip (begint morgen; via Meer → Periodes): het blok Taken met de stand (3 van 8 afgehandeld).
      await openMore(page, L('periods.title'), L('nav.more'))
      const row = page.locator('.period-row', { hasText: 'Neples' })
      if (!(await row.isVisible())) await page.locator('summary', { hasText: lang === 'nl' ? 'maart 2027' : 'March 2027' }).click()
      await row.click()
      const tasks = page.locator('.trip-tasks')
      await expect(tasks).toContainText('3/8')
      await expect(tasks.getByRole('checkbox', { name: L('task.lesplanning') })).toHaveAttribute('aria-checked', 'true')
      await expect(tasks.getByRole('checkbox', { name: L('task.safety') })).toHaveAttribute('aria-checked', 'false')
      await tasks.scrollIntoViewIfNeeded()
      await shots(page, 'trip-taken')

      // Terug (terugknop van Android) en dan Meer → Berichten: de boodschappenlijst als vaste soort, te bewerken.
      await page.goBack()
      await expect(tasks).toHaveCount(0)
      await openMore(page, L('nav.messages'), L('nav.more'))
      await expect(page.getByRole('heading', { name: L('msgKind.boodschappen'), exact: true })).toBeVisible()

      // Alles versleuteld: geen namen of lijsttekst op de lijn, alleen api.github.com.
      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
      for (const secret of ['Neples', 'provisioning', 'Nepster']) expect(wire).not.toContain(secret)
      expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
