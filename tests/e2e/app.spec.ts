import { expect, test } from '@playwright/test'

test('toont het eerste-keer-scherm zonder CSP-fouten', async ({ page }) => {
  const cspErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) cspErrors.push(msg.text())
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Eerste keer')
  await expect(page.getByRole('button', { name: 'Nieuw logboek' })).toBeVisible()
  expect(cspErrors).toEqual([])
})
