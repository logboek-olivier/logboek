import { expect, test } from '@playwright/test'
import { mockGithub, newGithub, type E2eGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, enterToken, expectNoHorizontalOverflow, lock, PASSPHRASE, storedLastUsed, TOKEN, openMore } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('nieuw logboek: token, wachtzin, herstelcode bevestigen, gesynct, vergrendelen, ontgrendelen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expectNoHorizontalOverflow(page)

  await expect(page.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  expect(github.files.has('meta.json.enc')).toBe(true)
  expect(github.files.has('trips.json.enc')).toBe(true)

  // Niets leesbaar over de lijn: de token alleen in de header, de wachtzin nergens.
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain(TOKEN)
  expect(wire).not.toContain(PASSPHRASE)
  expect(wire).not.toContain('nep')

  await lock(page)

  await page.getByLabel('Wachtzin').fill('verkeerd verkeerd verkeerd')
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wachtzin of herstelcode klopt niet', { timeout: 30_000 })

  await page.getByLabel('Wachtzin').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })

  // Herladen binnen 5 minuten: niet vergrendeld (de niet-exporteerbare hoofdsleutel staat in IndexedDB).
  // Het opslaan na ontgrendelen is asynchroon; eerst afwachten, anders vraagt de app (terecht) weer de wachtzin.
  await expect.poll(() => storedLastUsed(page)).not.toBeNull()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  // Na handmatig vergrendelen blijft herladen vergrendeld, geen eerste-keer-scherm.
  await lock(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ontgrendelen' })).toBeVisible()
  expect(errors).toEqual([])
})

test('bestaand logboek koppelen op een tweede apparaat met de herstelcode', async ({ browser }) => {
  const first = await browser.newContext({ viewport: { width: 360, height: 740 } })
  const pageA = await first.newPage()
  const github = await mockGithub(pageA)
  const words = await createNewLogbook(pageA)
  await expect(pageA.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  await first.close()

  const second = await browser.newContext({ viewport: { width: 360, height: 740 } })
  const pageB = await second.newPage()
  await mockGithub(pageB, github as E2eGithub)
  await pageB.goto('./')
  await pageB.getByRole('button', { name: 'Bestaand logboek koppelen' }).click()
  await enterToken(pageB)
  await pageB.getByRole('button', { name: 'Herstelcode gebruiken' }).click()
  await pageB.getByLabel(/Herstelcode/).fill(words.join(' '))
  await pageB.getByRole('button', { name: 'Koppelen' }).click()
  await expect(pageB.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  await expect(pageB.getByRole('status')).toHaveText('Gesynct', { timeout: 15_000 })
  await second.close()
})

test('nieuw logboek weigert een repo die al een logboek bevat', async ({ page }) => {
  const github = await mockGithub(page)
  github.files.set('meta.json.enc', { sha: 'sha-bestaand', content: 'e30=' })
  await page.goto('./')
  await page.getByRole('button', { name: 'Nieuw logboek' }).click()
  await page.getByLabel('GitHub-token').fill(TOKEN)
  await page.getByRole('button', { name: 'Controleren', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('bevat al een logboek')
})

test('nieuw logboek weigert een repo met databestanden zonder meta.json.enc (bijvoorbeeld van een oude sleutel)', async ({ page }) => {
  const github = await mockGithub(page)
  github.files.set('legs.json.enc', { sha: 'sha-oud', content: 'AQID' })
  await page.goto('./')
  await page.getByRole('button', { name: 'Nieuw logboek' }).click()
  await page.getByLabel('GitHub-token').fill(TOKEN)
  await page.getByRole('button', { name: 'Controleren', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('databestanden zonder meta.json.enc')
  expect(github.requests.some((r) => r.method === 'PUT')).toBe(false)
})

test('nieuw logboek in een repo zonder commits (409) en met alleen een README', async ({ browser }) => {
  for (const variant of ['leeg', 'readme'] as const) {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } })
    const page = await context.newPage()
    const github = newGithub({ emptyRepo: variant === 'leeg' })
    if (variant === 'readme') github.files.set('README.md', { sha: 'sha-readme', content: 'IyBsb2dib2VrLWRhdGE=' })
    await mockGithub(page, github)
    await createNewLogbook(page)
    await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
    expect(github.files.has('meta.json.enc')).toBe(true)
    expect(github.files.has('trips.json.enc')).toBe(true)
    if (variant === 'readme') expect(github.files.has('README.md')).toBe(true)
    await context.close()
  }
})

test('vervaldatum van de token: vooraf ingevuld uit de header, waarschuwing op Vandaag binnen 30 dagen', async ({ page }) => {
  // Lokale datum, net als de app (todayIso): anders schuift de dag rond middernacht UTC.
  const d = new Date()
  d.setDate(d.getDate() + 10)
  const soon = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const github = newGithub({ tokenExpiration: `${soon} 12:00:00 UTC` })
  await mockGithub(page, github)
  await page.goto('./')
  await page.getByRole('button', { name: 'Nieuw logboek' }).click()
  await page.getByLabel('GitHub-token').fill(TOKEN)
  await page.getByRole('button', { name: 'Controleren', exact: true }).click()
  await expect(page.getByLabel('Vervaldatum van de token')).toHaveValue(soon)
  await expect(page.getByText('Overgenomen van GitHub')).toBeVisible()
  await page.getByRole('button', { name: 'Verder', exact: true }).click()
  await page.getByLabel('Wachtzin', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Nog een keer').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Verder' }).click()
  await expect(page.getByRole('heading', { name: 'Herstelcode' })).toBeVisible({ timeout: 30_000 })
  const words = await page.locator('.words li').allTextContents()
  await page.getByRole('button', { name: 'Ik heb ze opgeschreven' }).click()
  for (const label of await page.locator('label').allTextContents()) {
    const m = /Woord (\d+)/.exec(label)
    if (m) await page.getByLabel(`Woord ${m[1]}`, { exact: true }).fill(words[Number(m[1]) - 1] ?? '')
  }
  await page.getByRole('button', { name: 'Logboek aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('alert')).toContainText('Token verloopt op')
  await expect(page.getByRole('alert')).toContainText('over 10 dagen')
  await page.getByRole('alert').getByRole('button', { name: 'Token vervangen' }).click()
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible()

  // Token vervangen: nieuwe token met een vervaldatum ver weg; de waarschuwing verdwijnt.
  github.tokenExpiration = null
  await page.getByRole('button', { name: 'Token vervangen' }).click()
  await page.getByLabel('GitHub-token').fill('github_pat_E2E_NIEUW_0123456789abcdefghijklmnopqrstuvwxyz')
  await page.getByRole('button', { name: 'Controleren', exact: true }).click()
  await expect(page.getByText('Niet leesbaar van GitHub')).toBeVisible()
  await page.getByLabel('Vervaldatum van de token').fill('2030-01-01')
  await page.getByRole('button', { name: 'Vervangen', exact: true }).click()
  await expect(page.locator('.toast')).toHaveText('Token vervangen', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Vandaag' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('github_pat_E2E_NIEUW')
})

test('een 401 toont "Token verlopen of ingetrokken", de outbox blijft staan en herladen bewaart de outbox', async ({ page }) => {
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  // Token ingetrokken: GitHub antwoordt 401. Een fooi toevoegen blijft gewoon werken.
  github.forceStatus = 401
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Fooi' }).click()
  await page.getByLabel('Bedrag').fill('12')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Fooi opgeslagen')).toBeVisible()
  await expect(page.getByRole('status').first()).toHaveText('Token verlopen of ingetrokken · Token vervangen', { timeout: 15_000 })
  await expect(page.getByRole('alert')).toContainText('Token verlopen of ingetrokken')

  // Herladen (zoals na "Nieuwe versie beschikbaar · Herladen"): de outbox staat in IndexedDB en overleeft dat.
  github.forceStatus = null
  github.offline = true
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('status').first()).toHaveText('Geen verbinding', { timeout: 15_000 })
  await openMore(page, 'Geld')
  await expect(page.locator('.tx')).toHaveCount(1)

  // Verbinding terug: de wachtende wijziging gaat alsnog mee.
  github.offline = false
  await page.getByRole('button', { name: 'Vandaag' }).click()
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await page.getByLabel('Wachtzin').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 30_000 })
  const puts = github.requests.filter((r) => r.method === 'PUT' && r.url.endsWith('transactions.json.enc'))
  expect(puts.length).toBeGreaterThanOrEqual(1)
})
