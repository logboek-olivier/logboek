import { expect, test } from '@playwright/test'
import { translate } from '../../src/i18n'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, openMore } from './helpers/logbook'

// PR 5: een nieuwe gebruiker. Het eerste scherm biedt de demo of een eigen logboek (met uitleg over GitHub), in de taal
// van de telefoon. Een nieuw logboek begint leeg: geen organisaties, geen cursussen van een ander, alles als voorstel.

test.use({ viewport: { width: 360, height: 740 } })

test.describe('telefoon in het Engels', () => {
  test.use({ locale: 'en-GB' })

  test('eerste scherm: demo bekijken en terug, eigen logboek met uitleg over GitHub', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await mockGithub(page)
    await page.goto('./')
    await expect(page.getByRole('heading', { name: translate('en', 'setup.title') })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // De demo: voorbeelddata, en "Demo stoppen" brengt het keuzescherm terug.
    await page.getByRole('button', { name: translate('en', 'setup.demo') }).click()
    await expect(page.getByText(translate('en', 'demo.bar'))).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: translate('en', 'demo.stop') }).click()
    await expect(page.getByRole('heading', { name: translate('en', 'setup.title') })).toBeVisible({ timeout: 30_000 })

    // Eigen logboek: eerst wat er bij GitHub nodig is (account, lege privé repository, token met alleen Contents).
    await page.getByRole('button', { name: translate('en', 'setup.own') }).click()
    await expect(page.getByRole('link', { name: 'github.com/signup' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'github.com/new' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'github.com/settings/personal-access-tokens/new' })).toBeVisible()
    await expect(page.getByText(translate('en', 'setup.guide3'))).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: translate('en', 'common.next') }).click()
    await expect(page.getByLabel(translate('en', 'token.label'))).toBeVisible()
    expect(errors).toEqual([])
  })
})

test('een nieuw logboek begint leeg: geen organisaties en geen cursussen van een ander, wel als voorstel', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)

  // Organisaties: geen, met Sailing Virgins en Yacht Week alleen als voorstel.
  await openMore(page, 'Instellingen')
  await page.getByRole('button', { name: new RegExp(`^${translate('nl', 'orgs.title')}`) }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText(translate('nl', 'orgs.none'))).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Sailing Virgins (SV)' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Sluiten' }).click()

  // Cursussen: geen meegeleverde cursussen, wel pakketten om toe te voegen.
  await openMore(page, 'Cursussen')
  await expect(page.getByRole('button', { name: /ASA 101/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: translate('nl', 'curriculum.addPack', { body: 'ASA' }) })).toBeVisible()

  // Een naam met "Sailing Virgins" maakt in dit logboek geen teller ("SV #1"): die organisatie bestaat hier niet.
  await page.getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('tab', { name: 'Trip' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Sailing Virgins nepweek')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('.toast')).toHaveText('Trip opgeslagen')
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(page.getByText('Sailing Virgins nepweek').first()).toBeVisible()
  await expect(page.getByText(/SV #|YW #/)).toHaveCount(0)
  expect(errors).toEqual([])
})
