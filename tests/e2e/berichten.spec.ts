import { expect, test, type Page } from '@playwright/test'
import { translate } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat, openMore } from './helpers/logbook'

// Berichtengenerator op 360 px: een sjabloon aanpassen (Meer → Berichten, invulvelden als chips), de introductie maken
// vanaf de herinnering op Vandaag met een ontbrekende verzamelplaats, invullen, delen (nagebootst deelmenu) en
// "Verstuurd". De app verstuurt zelf niets. Alle namen en plaatsen zijn verzonnen.

const L = (key: Parameters<typeof translate>[1], p?: unknown) => (translate as (l: 'nl', k: string, p?: unknown) => string)('nl', key, p)

async function shots(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `screenshots/berichten/${name}-360-${scheme}-nl.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test.use({ locale: 'nl-NL', viewport: { width: 360, height: 800 } })

test('bericht: sjabloon aanpassen, introductie met ontbrekende verzamelplaats invullen, delen en verstuurd', async ({ page }) => {
  // Maandag 8 maart 2027; de trip begint donderdag 11 maart: de herinnering staat er (3 dagen vooraf).
  await page.clock.setSystemTime(new Date('2027-03-08T10:00:00'))
  // Nagebootst deelmenu van Android (Web Share API): onthoudt de tekst.
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: string[] }
    w.__shared = []
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: { text?: string }) => void w.__shared.push(data.text ?? '') })
  })
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })
  const sheet = page.getByRole('dialog')

  // Een trip bij Yacht Week met twee gasten en een catamaran.
  await page.getByRole('navigation').getByRole('button', { name: L('nav.week'), exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: L('week.new') }).click()
  await sheet.getByLabel(L('field.name'), { exact: true }).fill('Nepweek Berichten')
  await sheet.getByRole('radio', { name: 'Skipper charter' }).click()
  await sheet.getByLabel(L('week.startDate')).fill('2027-03-11')
  await fillBoat(sheet, 'nl', 'Nepster')
  await sheet.getByRole('radiogroup', { name: L('boat.kind') }).getByRole('radio', { name: L('boatKind.catamaran') }).click()
  await sheet.getByRole('combobox', { name: L('week.organisation') }).selectOption({ label: 'Yacht Week' })
  await sheet.getByLabel(L('week.participantName', { n: 1 }), { exact: true }).fill('Nick')
  await sheet.getByLabel(L('week.participantName', { n: 2 }), { exact: true }).fill('Anna')
  await sheet.getByRole('button', { name: L('week.start') }).click()
  await expect(sheet).toHaveCount(0)

  // Meer → Berichten: het meegeleverde Engelse introductiesjabloon aanpassen, met een invulveld als chip.
  await openMore(page, L('nav.messages'), L('nav.more'))
  await expect(page.getByRole('heading', { name: L('msg.title'), exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Engels · Algemeen/ }).first().click()
  const text = sheet.getByRole('textbox', { name: L('msg.text'), exact: true })
  await text.fill('Hi {voornamen gasten}, we meet at ')
  await sheet.getByRole('button', { name: L('msgToken.meetingPlace'), exact: true }).click()
  await text.press('Control+End')
  await text.pressSequentially(' on {datum start}. Boat: {naam boot} ({type boot}).')
  await shots(page, 'sjabloon')
  await sheet.getByRole('button', { name: L('common.save') }).click()
  await expect(sheet).toHaveCount(0)

  // Vandaag: de herinnering. Bericht maken: de verzamelplaats ontbreekt en houdt delen tegen.
  await page.getByRole('navigation').getByRole('button', { name: L('nav.today'), exact: true }).click()
  const reminder = page.locator('.msg-reminder', { hasText: L('msg.remind.introductie', { trip: 'YW #1 · Nepweek Berichten' }) })
  await expect(reminder).toBeVisible()
  await reminder.getByRole('button', { name: L('msg.open') }).click()
  await expect(sheet.getByText(L('msg.missing', { field: L('msgField.meetingPlace') }))).toBeVisible()
  await expect(sheet.getByRole('button', { name: L('msg.share') })).toHaveCount(0)
  await expect(sheet.locator('.msg-preview')).not.toContainText('{')
  await shots(page, 'ontbreekt')

  // Invullen: alleen voor deze trip (en de standaard voor Yacht Week).
  await sheet.getByRole('button', { name: L('msg.fill') }).click()
  const field = page.getByRole('dialog').last()
  await field.getByLabel(L('msgField.meetingPlace'), { exact: true }).fill('Nepmarina')
  await field.getByRole('button', { name: L('common.save') }).click()
  const message = sheet.getByRole('textbox', { name: L('msg.editBefore'), exact: true })
  await expect(message).toHaveValue('Hi Nick and Anna, we meet at Nepmarina on Thursday, 11 March 2027. Boat: Nepster (catamaran).')
  // Voor dit ene bericht aanpassen (het sjabloon blijft zoals het is).
  await message.press('Control+End')
  await message.pressSequentially(' See you there.')
  await shots(page, 'klaar')

  // Delen via het deelmenu; daarna één tik "Verstuurd".
  await sheet.getByRole('button', { name: L('msg.share') }).click()
  expect(await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)).toEqual([
    'Hi Nick and Anna, we meet at Nepmarina on Thursday, 11 March 2027. Boat: Nepster (catamaran). See you there.',
  ])
  await sheet.getByRole('button', { name: L('msg.sent'), exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(reminder).toHaveCount(0)

  // De app maakte geen andere verbinding dan api.github.com (het deelmenu is nagebootst).
  expect(github.requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true)
  expect(errors).toEqual([])
})
