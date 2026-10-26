import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook } from './helpers/logbook'

// Beveiligingsregel 10: verversen of kort naar een andere app gaan vergrendelt niet; 5 minuten zonder gebruik wel.

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

/** Het tijdstip van laatste gebruik in IndexedDB, of null als er geen sleutel staat. */
async function storedLastUsed(page: Page): Promise<number | null> {
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

test('wisselen van app en verversen vergrendelen niet; de opgeslagen sleutel is niet exporteerbaar', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  await expect.poll(() => storedLastUsed(page)).not.toBeNull()

  await setVisibility(page, 'hidden')
  await setVisibility(page, 'visible')
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await page.getByRole('button', { name: 'Zeilen' }).click()
  await expect(page.getByRole('heading', { name: 'Zeilen' })).toBeVisible()
  expect(errors).toEqual([])
})

test('na 5 minuten zonder gebruik: vergrendeld en de sleutel is gewist, ook na verversen', async ({ page }) => {
  await page.clock.install()
  await mockGithub(page)
  await createNewLogbook(page)
  await expect.poll(() => storedLastUsed(page)).not.toBeNull()

  await page.clock.fastForward('05:01')
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
  await expect.poll(() => storedLastUsed(page)).toBeNull()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
})

test('terugkomen na meer dan 5 minuten op de achtergrond vergrendelt direct', async ({ page }) => {
  await page.clock.install()
  await mockGithub(page)
  await createNewLogbook(page)
  await setVisibility(page, 'hidden')
  // Op de achtergrond lopen timers niet betrouwbaar: alleen de klok verzetten, geen timers afvuren.
  await page.clock.setSystemTime(Date.now() + 6 * 60 * 1000)
  await setVisibility(page, 'visible')
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
})
