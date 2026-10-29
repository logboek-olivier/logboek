import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// PR A: betrouwbaarheid. Elk commitbericht in logboek-data noemt versie en apparaat; Meer → Opslag toont per bestand
// wie het laatst schreef. Een trip die via Toevoegen → Dag ontstaat, krijgt zijn datums uit de dagen en staat direct
// in Deze trip. Verzonnen gegevens.

test.use({ viewport: { width: 360, height: 800 } })

function iso(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('trip via Dag krijgt datums uit de dagen; commitberichten met versie en apparaat; Opslag toont de schrijver', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)

  // Gisteren een dag in een nieuwe trip, vandaag nog een: de trip loopt van gisteren tot vandaag en is lopend.
  for (const [date, to] of [
    [iso(-1), 'Nepdorp'],
    [iso(0), 'Nepbaai'],
  ] as const) {
    await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
    await page.getByLabel('Datum', { exact: true }).fill(date)
    await page.getByLabel('Naar', { exact: true }).fill(to)
    await page.getByLabel('Zeemijlen').fill('12')
    if (date === iso(-1)) await page.getByLabel('Naam van de trip').fill('Nepweek via dag')
    await page.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.getByText('Dag opgeslagen')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  const head = page.locator('.week-head')
  await expect(head).toContainText('Nepweek via dag')
  // Twee dagen, van gisteren tot vandaag; geen melding over vergeten dagen.
  await expect(head).toContainText(/\d/)
  await expect(page.locator('main')).not.toContainText('vergeten')
  await expect(page.locator('main')).not.toContainText('Geen lopende trip')

  // Elke schrijfactie: "sync <tijd> v<versie> d<apparaat-id>", zonder inhoud.
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const puts = github.requests.filter((r) => r.method === 'PUT')
  expect(puts.length).toBeGreaterThan(0)
  const devices = new Set<string>()
  for (const put of puts) {
    const message = (JSON.parse(put.body ?? '{}') as { message: string }).message
    expect(message).toMatch(/^sync \d{4}-\d{2}-\d{2}T\S+ v\S+ d[0-9a-f]{8}$/)
    expect(message).not.toContain('Nep')
    devices.add(message.slice(-8))
  }
  expect(devices.size).toBe(1)

  // Meer → Opslag: per bestand wie het laatst schreef.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 })
  await openMore(page, 'Opslag')
  await page.getByRole('button', { name: 'Controleer nu' }).click()
  await expect(page.getByRole('button', { name: 'Controleren…' })).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.storage-ok')).toBeVisible()
  const trips = page.locator('.storage-file').filter({ hasText: 'Trips' })
  await expect(trips.locator('.storage-writer')).toContainText('Laatst geschreven door dit apparaat · v')
  await expect(page.locator('main')).toContainText(`Dit apparaat: ${[...devices][0]}`)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'screenshots/diagnose/opslag.png', fullPage: true })
  expect(errors).toEqual([])
})
