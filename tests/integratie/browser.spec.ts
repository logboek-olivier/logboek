import { expect, test, type Page } from '@playwright/test'
import { translate } from '../../src/i18n'
import { createNewLogbook, enterToken, openMore, PASSPHRASE } from '../e2e/helpers/logbook'
import { createBranch, deleteBranch, rewrite, target, TOKEN } from './echte-github'

// Integratietest in de browser tegen de echte GitHub-API (alleen met LOGBOEK_IT_TOKEN, in CI): de echte app in Chromium,
// met service worker en browsercache, praat met api.github.com; elk verzoek voor logboek-data gaat naar een tijdelijke
// branch van deze repo, met de token van de workflow. Nieuw logboek, opslaan, herladen, twee vensters tegelijk, een
// schoon apparaat koppelen, en elke keer "Controleer nu": alles leesbaar. Alleen nepdata; de branch gaat daarna weg.

const t = target('browser')
const L = (key: Parameters<typeof translate>[1], ...args: unknown[]) => (translate as (l: 'nl', k: typeof key, ...a: unknown[]) => string)('nl', key, ...args)

/** Elk verzoek naar logboek-data gaat naar de tijdelijke branch, met de echte token; de browser doet het echte verzoek. */
async function toBranch(page: Page): Promise<void> {
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request()
    const { url, body } = rewrite(request.url(), request.method(), request.postData(), t)
    await route.continue({ url, headers: { ...request.headers(), authorization: `Bearer ${TOKEN}` }, ...(body !== null ? { postData: body } : {}) })
  })
}

async function expectSynced(page: Page): Promise<void> {
  await expect(page.getByRole('status').first()).toHaveText(L('sync.synced'), { timeout: 60_000 })
}

/** Meer → Opslag → Controleer nu: GitHub en dit apparaat komen overeen en alles is leesbaar. */
async function checkAllReadable(page: Page): Promise<void> {
  await openMore(page, L('nav.storage'), L('nav.more'))
  await page.getByRole('button', { name: L('storage.checkNow') }).click()
  await expect(page.locator('.storage-ok')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.storage-state.bad')).toHaveCount(0)
}

async function addReminder(page: Page, title: string): Promise<void> {
  await openMore(page, L('reminder.screen'), L('nav.more'))
  await page.getByRole('button', { name: L('reminder.new') }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel(L('reminder.title')).fill(title)
  await sheet.getByRole('button', { name: L('common.save') }).click()
  await expect(page.locator('.due-list')).toContainText(title)
}

test.skip(!TOKEN, 'alleen met LOGBOEK_IT_TOKEN (CI)')

test.beforeAll(async () => {
  await createBranch(t)
})

test.afterAll(async () => {
  await deleteBranch(t)
})

test('echte GitHub in de browser: nieuw logboek, opslaan, herladen, twee vensters, schoon apparaat', async ({ browser }) => {
  test.setTimeout(600_000)
  const phone = await browser.newContext()
  const page = await phone.newPage()
  await toBranch(page)
  await createNewLogbook(page)
  await expectSynced(page)
  await addReminder(page, 'Neptermijn 1')
  await expectSynced(page)
  await checkAllReadable(page)

  // Herladen (de sessie hervat binnen 5 minuten) en meteen weer synchroniseren.
  await page.reload()
  await expectSynced(page)

  // Twee vensters (zoals het Chrome-tabblad en de geïnstalleerde app) slaan tegelijk op.
  const second = await phone.newPage()
  await toBranch(second)
  await second.goto('./')
  await expectSynced(second)
  await Promise.all([addReminder(page, 'Neptermijn 2'), addReminder(second, 'Neptermijn 3')])
  await expectSynced(page)
  await expectSynced(second)
  await checkAllReadable(page)
  await second.close()

  // Een schoon apparaat koppelt het logboek en leest alles.
  const clean = await browser.newContext()
  const fresh = await clean.newPage()
  await toBranch(fresh)
  await fresh.goto('./')
  await fresh.getByRole('button', { name: L('setup.link') }).click()
  await enterToken(fresh)
  await fresh.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
  await fresh.getByRole('button', { name: L('setup.linkButton') }).click()
  await expectSynced(fresh)
  await checkAllReadable(fresh)
  await openMore(fresh, L('reminder.screen'), L('nav.more'))
  for (const title of ['Neptermijn 1', 'Neptermijn 2', 'Neptermijn 3']) await expect(fresh.locator('.due-list')).toContainText(title)
  await clean.close()
  await phone.close()
})
