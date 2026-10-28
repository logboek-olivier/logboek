import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, PASSPHRASE, openMore } from './helpers/logbook'

// Alle schermen op 360 px breed, zonder horizontale overloop; offline openen na het eerste bezoek.

test.use({ viewport: { width: 360, height: 740 } })

test('alle schermen passen op 360 px en Instellingen werkt', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const cspErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) cspErrors.push(msg.text())
  })
  await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  // Vandaag: dag loggen en nm dit jaar; nm totaal en laatste tocht staan in het logboek.
  await expect(page.getByRole('button', { name: 'Dag van vandaag loggen' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Jaardoel wijzigen/ })).toContainText('0 nm')
  await expect(page.locator('main')).not.toContainText('nm totaal')
  await expectNoHorizontalOverflow(page)

  for (const tab of ['Deze trip', 'Agenda', 'Toevoegen', 'Meer']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expectNoHorizontalOverflow(page)
  }
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  // Opent op Dag, met alle velden in beeld.
  await expect(page.getByRole('tab', { name: 'Dag' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Meer velden' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.getByRole('tab', { name: 'Uitgave' }).click()
  await page.getByRole('button', { name: 'Meer velden' }).click()
  await expectNoHorizontalOverflow(page)

  // Instellingen: herstelcode tonen na wachtzin; wachtzin wijzigen; vingerafdruk alleen als de browser een platform-authenticator meldt.
  await page.getByRole('button', { name: 'Vandaag' }).click()
  await openMore(page, 'Instellingen')
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible()
  const platformAuth = await page.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  await expect(page.getByRole('button', { name: /Vingerafdruk of schermvergrendeling/ })).toHaveCount(platformAuth ? 1 : 0)
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Herstelcode tonen' }).click()
  await page.getByLabel('Wachtzin').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Tonen', exact: true }).click()
  await expect(page.locator('.words li')).toHaveCount(24, { timeout: 30_000 })
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Verbergen' }).click()

  await page.getByRole('button', { name: 'Wachtzin wijzigen' }).click()
  await page.getByLabel('Huidige wachtzin').fill(PASSPHRASE)
  await page.getByLabel('Nieuwe wachtzin').fill('tweede nep wachtzin e2e')
  await page.getByLabel('Nog een keer').fill('tweede nep wachtzin e2e')
  await page.getByRole('button', { name: 'Wijzigen', exact: true }).click()
  await expect(page.getByText('Wachtzin gewijzigd')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await page.getByLabel('Wachtzin').fill('tweede nep wachtzin e2e')
  await page.getByRole('button', { name: 'Ontgrendelen' }).click()
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })

  expect(cspErrors).toEqual([])
  expect(errors).toEqual([])
})

test('vingerafdruk aanzetten en ermee ontgrendelen (virtuele authenticator met prf)', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  })
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })

  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: 'Vingerafdruk of schermvergrendeling aanzetten' }).click()
  await page.getByLabel('Wachtzin').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Aanzetten', exact: true }).click()
  // exact: de knop "… aanzetten" bevat dezelfde tekst.
  await expect(page.getByText('Vingerafdruk of schermvergrendeling aan', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Vingerafdruk of schermvergrendeling uitzetten' })).toBeVisible()

  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  // Bij openen vraagt de app direct om de vingerafdruk; de virtuele authenticator keurt goed.
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible({ timeout: 30_000 })

  // Niets van de vingerafdruk gaat naar GitHub.
  const wire = github.requests.map((r) => `${r.url}\n${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('fingerprint')
  expect(wire).not.toContain('prf')

  // Uitzetten: daarna alleen de wachtzin.
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: 'Vingerafdruk of schermvergrendeling uitzetten' }).click()
  await page.getByRole('button', { name: 'Uitzetten', exact: true }).click()
  await expect(page.getByText('Vingerafdruk of schermvergrendeling uit', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await expect(page.getByRole('button', { name: 'Vingerafdruk of schermvergrendeling', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Wachtzin')).toBeVisible()
})

test('opent offline na het eerste bezoek', async ({ page, context }) => {
  await mockGithub(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Eerste keer' })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Even wachten tot de precache gevuld is.
  await page.waitForFunction(async () => (await caches.keys()).length > 0)
  await page.waitForTimeout(500)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Eerste keer' })).toBeVisible()
  await context.setOffline(false)
})
