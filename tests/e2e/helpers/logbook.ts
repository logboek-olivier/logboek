import { expect, type Page } from '@playwright/test'

// Verzonnen testgegevens; dit is geen echte token en geen echte wachtzin.
export const TOKEN = 'github_pat_E2E_TEST_0123456789abcdefghijklmnopqrstuvwxyz'
export const PASSPHRASE = 'nep wachtzin voor e2e'

/** Doorloopt "Nieuw logboek" tot en met het ontgrendelde hoofdscherm. Geeft de herstelwoorden terug. */
export async function createNewLogbook(page: Page): Promise<string[]> {
  await page.goto('./')
  await page.getByRole('button', { name: 'Nieuw logboek' }).click()
  await page.getByLabel('GitHub-token').fill(TOKEN)
  await page.getByRole('button', { name: 'Verder' }).click()
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Nog een keer').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Verder' }).click()
  await expect(page.getByRole('heading', { name: 'Herstelcode' })).toBeVisible({ timeout: 30_000 })
  const words = await page.locator('.words li').allTextContents()
  expect(words).toHaveLength(24)
  await page.getByRole('button', { name: 'Ik heb ze opgeschreven' }).click()
  for (const label of await page.locator('label').allTextContents()) {
    const m = /Woord (\d+)/.exec(label)
    if (m) await page.getByLabel(`Woord ${m[1]}`, { exact: true }).fill(words[Number(m[1]) - 1] ?? '')
  }
  await page.getByRole('button', { name: 'Logboek aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  return words
}

/** Vergrendelt via Instellingen. */
export async function lock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Instellingen' }).click()
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
