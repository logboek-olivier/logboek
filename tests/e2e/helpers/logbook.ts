import { expect, type Locator, type Page } from '@playwright/test'
import { translate, type Lang } from '../../../src/i18n'

// Verzonnen testgegevens; dit is geen echte token en geen echte wachtzin.
export const TOKEN = 'github_pat_E2E_TEST_0123456789abcdefghijklmnopqrstuvwxyz'
export const PASSPHRASE = 'nep wachtzin voor e2e'

/** Token invoeren in twee stappen: controleren bij GitHub, dan de vervaldatum bevestigen. */
export async function enterToken(page: Page, submitLabel = 'Verder', lang: Lang = 'nl'): Promise<void> {
  await page.getByLabel(translate(lang, 'token.label')).fill(TOKEN)
  await page.getByRole('button', { name: translate(lang, 'token.check'), exact: true }).click()
  await expect(page.getByLabel(translate(lang, 'token.expiry'))).toBeVisible()
  await page.getByRole('button', { name: submitLabel, exact: true }).click()
}

/** Doorloopt "Nieuw logboek" tot en met het ontgrendelde hoofdscherm. Geeft de herstelwoorden terug. */
export async function createNewLogbook(page: Page, lang: Lang = 'nl'): Promise<string[]> {
  const L = (key: Parameters<typeof translate>[1]) => translate(lang, key as 'common.next')
  await page.goto('./')
  await page.getByRole('button', { name: L('setup.new') }).click()
  await enterToken(page, L('common.next'), lang)
  await page.getByLabel(L('passphrase.label'), { exact: true }).fill(PASSPHRASE)
  await page.getByLabel(L('passphrase.again')).fill(PASSPHRASE)
  await page.getByRole('button', { name: L('common.next') }).click()
  await expect(page.getByRole('heading', { name: L('setup.recovery') })).toBeVisible({ timeout: 30_000 })
  const words = await page.locator('.words li').allTextContents()
  expect(words).toHaveLength(24)
  await page.getByRole('button', { name: L('setup.wroteDown') }).click()
  for (const label of await page.locator('label').allTextContents()) {
    const m = /(?:Woord|Word) (\d+)/.exec(label)
    if (m) await page.getByLabel(label.trim(), { exact: true }).fill(words[Number(m[1]) - 1] ?? '')
  }
  await page.getByRole('button', { name: L('setup.create') }).click()
  await expect(page.getByRole('heading', { name: L('nav.today') })).toBeVisible({ timeout: 30_000 })
  return words
}

/** Vergrendelt via Instellingen. */
export async function lock(page: Page): Promise<void> {
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
}

/** Consolefouten, behalve de verwachte 404's van de nagebootste GitHub (bestand bestaat nog niet). */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

/** Niets loopt buiten het scherm: geen horizontale scroll. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Tijdstip van laatste gebruik van de opgeslagen hoofdsleutel in IndexedDB, of null als er geen staat. */
export async function storedLastUsed(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const open = indexedDB.open('logboek')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction('session').objectStore('session').get('masterKey')
          get.onsuccess = () => {
            const record = get.result as { key: CryptoKey; lastUsed: number } | undefined
            if (record && record.key.extractable) reject(new Error('sleutel is exporteerbaar'))
            resolve(record ? record.lastUsed : null)
            open.result.close()
          }
        }
      }),
  )
}

/** Geld en Instellingen zitten onder Meer in de onderbalk. */
export async function openMore(page: Page, item: string, more = 'Meer'): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: more, exact: true }).click()
  await page.getByRole('button', { name: new RegExp(`^${item}`) }).click()
}

/** Vult de verplichte bootgegevens van een trip in (naam, model, lengte, basis). Verzonnen waarden. */
export async function fillBoat(scope: Locator, lang: Lang = 'nl', boat = 'Nepboot'): Promise<void> {
  const L = (key: Parameters<typeof translate>[1]) => translate(lang, key as 'common.next')
  await scope.getByLabel(L('boat.name'), { exact: true }).fill(boat)
  await scope.getByLabel(L('boat.model'), { exact: true }).fill('Nepmodel 40')
  await scope.getByLabel(L('boat.length'), { exact: true }).fill('40')
  await scope.getByLabel(L('boat.base'), { exact: true }).fill('Nepbasis')
}
