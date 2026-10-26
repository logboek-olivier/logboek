import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('Studenten: toevoegen, afvinken met één tik, examenkritisch bovenaan, groep afvinken, archiveren en wissen', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const github = await mockGithub(page)
  await createNewLogbook(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Studenten' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Nog geen studenten.', { exact: false })).toBeVisible()

  for (const name of ['Nepanna', 'Nepbram']) {
    await page.getByRole('button', { name: 'Student toevoegen' }).click()
    await expect(page.getByText('Geen contactgegevens.', { exact: false })).toBeVisible()
    await page.getByLabel('Voornaam').fill(name)
    await expect(page.getByLabel('Cursus')).toHaveValue('seed-asa-101')
    await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  }
  await expect(page.locator('.student')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)

  // Checklist: één tik = volgende status; examenkritisch en nieuw staat bovenaan.
  await page.locator('.student').filter({ hasText: 'Nepanna' }).getByRole('button').click()
  await expect(page.getByRole('heading', { name: 'Nepanna' })).toBeVisible()
  const critical = page.locator('.section').filter({ has: page.getByRole('heading', { name: 'Examenkritisch, nog nieuw' }) })
  await expect(critical.getByText('Overstag gaan')).toBeVisible()
  await critical.getByRole('button', { name: /^Overstag gaan: Nieuw/ }).click()
  await expect(critical.getByText('Overstag gaan')).toHaveCount(0)
  const tack = page.getByRole('button', { name: /^Overstag gaan: / })
  await expect(tack).toHaveAccessibleName(/Geoefend/)
  await tack.click()
  await expect(tack).toHaveAccessibleName(/Beheerst/)
  await tack.click()
  await expect(critical.getByText('Overstag gaan')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Hele onderwerpgroep in één tik, met ongedaan maken.
  const firstGroup = page.locator('.section').nth(1)
  await firstGroup.getByRole('button', { name: 'Alles geoefend' }).click()
  await expect(firstGroup.getByRole('button', { name: 'Alles beheerst' })).toBeVisible()
  await page.locator('.toast').getByRole('button').click()
  await expect(firstGroup.getByRole('button', { name: 'Alles geoefend' })).toBeVisible()
  await page.getByRole('button', { name: 'Terug naar Studenten' }).click()

  // Groep afvinken: één onderwerp voor beide studenten.
  await page.getByRole('button', { name: 'Groep afvinken' }).click()
  await page.getByRole('dialog').getByLabel('Onderwerp').selectOption({ label: 'Gijpen onder controle' })
  await page.getByRole('dialog').getByRole('button', { name: 'Afvinken voor 2 studenten' }).click()
  await expect(page.locator('.toast')).toHaveText(/Afgevinkt voor 2 studenten/)
  await page.locator('.student').filter({ hasText: 'Nepbram' }).getByRole('button').click()
  await expect(page.getByRole('button', { name: /^Gijpen onder controle: Geoefend/ })).toBeVisible()

  // Examen invullen en archiveren.
  await page.getByRole('button', { name: 'Student bewerken' }).click()
  await page.getByLabel('Examendatum').fill('2026-10-30')
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('examen gehaald op', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Student bewerken' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archiveren' }).click()
  await expect(page.locator('.student')).toHaveCount(1)

  // Archief: terugzetten en wissen.
  await page.getByRole('button', { name: 'Archief (1)' }).click()
  await page.getByRole('button', { name: 'Nepbram terugzetten' }).click()
  await expect(page.getByText('Het archief is leeg.')).toBeVisible()
  await page.getByRole('button', { name: 'Terug naar Studenten' }).click()
  await expect(page.locator('.student')).toHaveCount(2)
  await page.locator('.student').filter({ hasText: 'Nepbram' }).getByRole('button').click()
  await page.getByRole('button', { name: 'Student bewerken' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archiveren' }).click()
  await page.getByRole('button', { name: 'Archief (1)' }).click()
  await page.getByRole('button', { name: 'Archief wissen' }).click()
  await expect(page.locator('.toast')).toContainText('Archief gewist')
  await expect(page.getByRole('button', { name: /^Archief/ })).toHaveCount(0)

  // Per cursus groeperen.
  await page.getByRole('radio', { name: 'Per cursus' }).click()
  await expect(page.getByRole('heading', { name: /ASA 101/ })).toBeVisible()

  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  await expect(page.getByRole('status').first()).toHaveText('Gesynct', { timeout: 15_000 })
  const wire = github.requests.map((r) => `${r.url} ${r.body ?? ''}`).join('\n')
  expect(wire).not.toContain('Nepanna')
  expect(wire).not.toContain('Nepbram')
  expect(errors).toEqual([])
})
