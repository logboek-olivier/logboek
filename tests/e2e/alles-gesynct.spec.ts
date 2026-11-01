import { expect, test } from '@playwright/test'
import { translate } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, openMore } from './helpers/logbook'

// "1 wijziging wacht" (CLAUDE.md, Opslag en synchronisatie): na een reeks verschillende wijzigingen, ook een korte tijd
// zonder verbinding, staat de syncstatus vanzelf weer op "Gesynct", zonder tik. Alles wat de app vandaag schrijft komt
// langs: Excel importeren (Opslag), een dag en inkomsten (Toevoegen), een dag verwijderen, de prullenbak en de
// geschiedenis. Alle gegevens verzonnen.

const L = (key: Parameters<typeof translate>[1], params?: unknown) => (translate as (l: 'nl', k: string, p?: unknown) => string)('nl', key, params)
const fixture = new URL('../fixtures/mijlen-nep.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

test.use({ locale: 'nl-NL', viewport: { width: 360, height: 800 } })

test('na importeren, toevoegen, verwijderen, terugzetten en zonder verbinding: vanzelf weer Gesynct', async ({ page }) => {
  test.setTimeout(150_000)
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page, 'nl')
  const status = page.getByRole('status').first()
  await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })
  const nav = page.getByRole('navigation')
  const layer = page.locator('.add-layer')

  // Excel importeren onder Opslag.
  await openMore(page, L('nav.storage'), L('nav.more'))
  await page.getByLabel(L('import.file')).setInputFiles(fixture)
  await page.getByRole('button', { name: L('import.import') }).click()
  await expect(page.getByText(L('import.done'), { exact: true })).toBeVisible()

  // Een dag en inkomsten, waarvan één zonder verbinding.
  await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
  await layer.getByLabel(L('field.to'), { exact: true }).fill('Nepbaai')
  await layer.getByRole('button', { name: L('common.save') }).click()
  await expect(layer).toHaveCount(0)
  github.offline = true
  await nav.getByRole('button', { name: L('nav.add'), exact: true }).click()
  await layer.getByRole('tab', { name: L('quick.tabIncome') }).click()
  await layer.getByLabel(L('field.amount')).fill('25')
  await layer.getByRole('button', { name: L('common.save') }).click()
  await expect(layer).toHaveCount(0)
  await expect(status).not.toHaveText(L('sync.synced'))
  github.offline = false

  // Een dag verwijderen en terugzetten uit de prullenbak, en een regel uit de geschiedenis terugzetten.
  await openMore(page, L('nav.logbook'), L('nav.more'))
  await page.locator('.trip').first().getByRole('button').first().click()
  const sheet = page.getByRole('dialog')
  await sheet.locator('.leg-row .btn.icon').first().click()
  await page.getByRole('dialog').last().getByRole('button', { name: L('common.delete') }).click()
  // Na verwijderen weer het tripoverzicht.
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await sheet.getByRole('button', { name: L('common.close') }).click()
  await openMore(page, L('trash.title'), L('nav.more'))
  await page.locator('.settings-row').first().click()
  await sheet.getByRole('button', { name: L('trash.restore') }).click()
  await openMore(page, L('history.title'), L('nav.more'))
  await page.getByRole('button', { name: L('history.revert') }).first().click()

  // Geen tik meer: de wachtende wijzigingen gaan vanzelf (na opslaan, en het vangnet elke 30 seconden).
  await expect(status).toHaveText(L('sync.synced'), { timeout: 60_000 })
  // Alleen de bewuste periode zonder verbinding geeft een netwerkmelding in de console.
  expect(errors.filter((e) => !e.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([])
})
