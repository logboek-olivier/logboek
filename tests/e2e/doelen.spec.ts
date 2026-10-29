import { expect, test, type Page } from '@playwright/test'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// Doelen en skills: een doel dat zichzelf vult uit het logboek, een doel dat Olivier zelf meet ("5 kilo afvallen"),
// een skill met een mijlpaal, en snel loggen via + → Skill. Alle gegevens verzonnen.

async function shots(page: Page, name: string, lang: Lang) {
  for (const width of [360, 412]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ colorScheme: scheme })
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `screenshots/doelen/${name}-${width}-${scheme}-${lang}.png` })
    }
  }
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
}

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })

    test(`doelen en skills: zelfvullend, zelf gemeten, skill met mijlpaal, loggen via het plusje (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const errors = collectConsoleErrors(page)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const year = new Date().getFullYear()
      const nav = page.getByRole('navigation')
      const toast = page.locator('.toast')

      // Een dag van 12 nm, zodat het zelfvullende doel iets laat zien.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByLabel(L('field.to'), { exact: true }).fill('Nephaven')
      await page.getByLabel(L('field.nm')).fill('12')
      await page.getByRole('button', { name: L('common.save') }).click()
      await expect(toast).toHaveText(L('toast.daySaved'))
      await expect(toast).toHaveCount(0, { timeout: 15_000 })

      await openMore(page, L('goals.screen'), L('nav.more'))
      await expect(page.getByRole('heading', { name: L('goals.screen'), level: 1 })).toBeVisible()
      await expect(page.getByText(L('goals.empty'))).toBeVisible()

      // Zelfvullend: zeemijlen dit jaar, doel 100.
      await page.getByRole('button', { name: L('goals.new') }).click()
      const sheet = page.getByRole('dialog')
      await sheet.getByRole('radio', { name: L('goals.metric.nm') }).click()
      await sheet.getByLabel(L('goals.target'), { exact: true }).fill('100')
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(sheet).toHaveCount(0)
      const nmRow = page.locator('.goal-row', { hasText: L('goals.label.nm', { year }) })
      await expect(nmRow).toContainText(L('goals.of', { now: '12 nm', target: '100 nm' }))
      await expect(nmRow.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12')

      // Zelf meten: "5 kilo afvallen" met nu 82 kg; het doel wordt 77 kg.
      await page.getByRole('button', { name: L('goals.new') }).click()
      await sheet.getByRole('radio', { name: L('goals.kindMeasured') }).click()
      await sheet.getByRole('button', { name: L('goals.suggestion.afvallen') }).click()
      await sheet.getByLabel(L('goals.now'), { exact: true }).fill('82')
      await expect(sheet.getByLabel(L('goals.target'), { exact: true })).toHaveValue('77')
      await shots(page, 'doel-meten', lang)
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(sheet).toHaveCount(0)
      const kgRow = page.locator('.goal-row', { hasText: L('goals.suggestion.afvallen') })
      await expect(kgRow).toContainText(L('goals.measured', { now: '82 kg', target: '77 kg' }))
      // Een meting: 80 kg, 40% van de weg.
      await kgRow.click()
      await sheet.getByLabel(L('goals.valueWithUnit', { unit: 'kg' })).fill('80')
      await sheet.getByRole('button', { name: L('goals.addMeasurement') }).click()
      await expect(sheet.locator('.goal-progress')).toContainText(L('goals.measured', { now: '80 kg', target: '77 kg' }))
      await expect(sheet.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
      await sheet.getByRole('button', { name: L('common.close') }).click()

      // Skill: adem inhouden (beste waarde in seconden), met een mijlpaal.
      await page.getByRole('button', { name: L('goals.newSkill') }).click()
      await sheet.getByRole('button', { name: L('goals.skill.adem') }).click()
      await expect(sheet.getByLabel(L('goals.skillName'))).toHaveValue(L('goals.skill.adem'))
      await expect(sheet.getByLabel(L('goals.valueUnit'))).toHaveValue('s')
      await expect(sheet.getByRole('radio', { name: L('goals.valueBest') })).toHaveAttribute('aria-checked', 'true')
      await sheet.getByLabel(L('goals.newMilestone')).fill(lang === 'nl' ? 'Twee minuten' : 'Two minutes')
      await sheet.getByRole('button', { name: L('goals.addMilestone') }).click()
      await sheet.getByRole('button', { name: L('common.save') }).click()
      await expect(sheet).toHaveCount(0)
      await shots(page, 'doelen', lang)

      // Snel loggen via + → Skill: 10 minuten, beste 95 s.
      await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
      await page.getByRole('tab', { name: L('quick.tabSkill') }).click()
      await expectNoHorizontalOverflow(page)
      await page.getByRole('combobox', { name: L('goals.whatLog') }).selectOption({ label: L('goals.skill.adem') })
      await page.getByLabel(L('goals.minutesField')).fill('10')
      await page.getByLabel(L('goals.valueWithUnit', { unit: 's' })).fill('95')
      await shots(page, 'toevoegen-skill', lang)
      const before = github.requests.filter((r) => r.method === 'PUT' && r.url.includes('sessions.json.enc')).length
      await page.getByRole('button', { name: L('goals.logSession') }).click()
      await expect(toast).toHaveText(L('goals.sessionSaved'))
      await expect.poll(() => github.requests.filter((r) => r.method === 'PUT' && r.url.includes('sessions.json.enc')).length, { timeout: 15_000 }).toBeGreaterThan(before)

      // De skill: sessie, minuten en beste waarde; mijlpaal afvinken; een sessie verwijderen en ongedaan maken.
      await expect(toast).toHaveCount(0, { timeout: 15_000 })
      await openMore(page, L('goals.screen'), L('nav.more'))
      const skillRow = page.locator('.skill-list button', { hasText: L('goals.skill.adem') })
      await expect(skillRow).toContainText(L('goals.sessions', { n: 1 }))
      await expect(skillRow).toContainText(L('goals.minutes', { m: 10 }))
      await expect(skillRow).toContainText(L('goals.best', { value: '95 s' }))
      await skillRow.click()
      const milestone = sheet.getByRole('button', { name: lang === 'nl' ? 'Twee minuten' : 'Two minutes' })
      await expect(milestone).toHaveAttribute('aria-pressed', 'false')
      await milestone.click()
      await expect(milestone).toHaveAttribute('aria-pressed', 'true')
      await expect(sheet).toContainText(L('goals.milestones', { done: 1, total: 1 }))
      await shots(page, 'skill', lang)
      await sheet.getByRole('button', { name: new RegExp(`^${L('goals.deleteSession', { date: '.+' })}$`) }).click()
      await expect(sheet.getByText(L('goals.recent'))).toHaveCount(0)
      await page.getByRole('button', { name: L('common.undo') }).click()
      await expect(sheet.getByText(L('goals.recent'))).toBeVisible()
      await sheet.getByRole('button', { name: L('common.close') }).click()

      await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 15_000 })
      expect(errors).toEqual([])
    })
  })
}
