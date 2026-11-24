import { expect, test } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook, expectNoHorizontalOverflow, fillBoat } from './helpers/logbook'

test.use({ viewport: { width: 360, height: 740 } })

test('Lesweek: cursussen per student, blok afvinken voor iedereen, één student nog niet, overzicht per cursus', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page, 'nl', { olivier: true })
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()

  // Een lesweek met één student; de tweede komt erbij via "Persoon toevoegen" op de trip zelf.
  await page.getByRole('button', { name: 'Nieuwe trip' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('radio', { name: 'Training geven' }).click()
  await sheet.getByLabel('Deelnemer 1', { exact: true }).fill('Nepanna')
  await fillBoat(sheet)
  await sheet.getByRole('button', { name: 'Trip opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('main').getByRole('button', { name: 'Persoon toevoegen' }).click()
  const add = page.getByRole('dialog')
  await expect(add.getByRole('radio', { name: 'Student' })).toHaveAttribute('aria-checked', 'true')
  await expect(add.getByLabel('Trip')).toHaveCount(0)
  await add.getByLabel('Voornaam').fill('Nepbram')
  await add.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Geen tik op de kop meer naar een apart blad; geschiedenis en verwijderen staan onderaan.
  await expect(page.locator('.trip-head-summary')).toHaveCount(0)
  await expect(page.locator('.period-actions').getByRole('button', { name: 'Periode verwijderen' })).toBeVisible()

  const week = page.locator('.lesson-week')
  await expect(week.getByRole('heading', { name: 'Lesweek' })).toBeVisible()
  await expect(week.getByText('Tik op een naam om de cursussen te kiezen.')).toBeVisible()

  // Cursussen: meerdere per student, met een spoor als snelkeuze.
  await week.getByRole('button', { name: 'Cursussen kiezen: Nepanna' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '101 + 103' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Klaar' }).click()
  await week.getByRole('button', { name: 'Cursussen kiezen: Nepbram' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '104 + 114' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Klaar' }).click()
  await expect(week.getByRole('button', { name: 'Cursussen kiezen: Nepanna' })).toContainText('101 · 103')
  await expect(week.getByText('Tik op een naam om de cursussen te kiezen.')).toHaveCount(0)
  await expect(week.getByText('101: nog 15 van 15 open')).toBeVisible()
  await expect(week.getByRole('checkbox', { name: 'Catamaran' })).toBeVisible()

  // Groepsblok: één tik.
  await week.getByRole('checkbox', { name: 'Rondje over de boot' }).click()
  await expect(week.getByRole('checkbox', { name: 'Rondje over de boot' })).toHaveAttribute('aria-checked', 'true')

  // Studentblok: één tik = iedereen; de namen staan eronder; Nepbram nog niet.
  await week.getByRole('checkbox', { name: 'Overstag en gijpen' }).click()
  await week.getByRole('button', { name: 'Nepbram: gedaan' }).click()
  await expect(week.getByText('Nog niet: Nepbram')).toBeVisible()
  await expect(week.getByText('Gijpen', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await week.screenshot({ path: 'test-results/lesweek-360.png' })

  // Blijft na herladen.
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: 'Deze trip', exact: true }).click()
  await expect(week.getByText('Nog niet: Nepbram')).toBeVisible()
  await expect(week.getByText('101: nog 13 van 15 open')).toBeVisible()
  // Toch goed: één tik op de naam.
  await week.getByRole('button', { name: /Overstag en gijpen/ }).click()
  await week.getByRole('button', { name: 'Nepbram: nog niet' }).click()
  await expect(week.getByText('Nog niet: Nepbram')).toHaveCount(0)

  // Planning: één tik maakt het voorstel voor de hele week (zeven dagen, elke weekdag één keer).
  await week.getByRole('radio', { name: 'Planning' }).click()
  await week.getByRole('button', { name: 'Planning maken' }).click()
  await expect(week.locator('.lesson-day')).toHaveCount(7)
  await expect(week.locator('.lesson-chip', { hasText: 'Rondje over de boot' })).toHaveCount(1)
  await expect(week.locator('.lesson-chip', { hasText: 'Examen 101' })).toHaveCount(1)
  await expect(week.locator('.lesson-chip', { hasText: 'Catamaran' })).toHaveCount(1)
  // Zondag: onderdelen van de boot en knopen; geen oude "Nieuwe planning" meer.
  await expect(page.getByRole('button', { name: 'Nieuwe planning' })).toHaveCount(0)
  const sunday = week.locator('.lesson-day').filter({ hasText: /^zondag/ })
  await expect(sunday.locator('.lesson-chip')).toHaveText(['Rondje over de boot', 'Knopen'])
  // Verplaatsen: één tik op het blok, één tik op de nieuwe plek.
  await week.locator('.lesson-chip', { hasText: 'Kaart' }).click()
  const moveSheet = page.getByRole('dialog', { name: 'Kaart' })
  await moveSheet.getByRole('button', { name: /^zaterdag .* · Ochtend$/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(week.locator('.lesson-day').filter({ hasText: /^zaterdag/ }).locator('.lesson-chip', { hasText: 'Kaart' })).toHaveCount(1)
  await expect(week.getByText(/Voor examen 103 nog niet gepland: Kaart/)).toBeVisible()
  // Overstag en gijpen is al afgevinkt; een blok openen, afvinken en verplaatsen.
  await expect(week.locator('.lesson-chip.done', { hasText: 'Overstag en gijpen' })).toHaveCount(1)
  await week.locator('.lesson-chip', { hasText: 'Veiligheid' }).click()
  const blockSheet = page.getByRole('dialog', { name: 'Veiligheid' })
  await expect(blockSheet).toContainText('Brand, explosie en blussers')
  await blockSheet.getByRole('button', { name: 'Afvinken' }).click()
  await expect(blockSheet.getByRole('button', { name: 'Uitvinken' })).toBeVisible()
  await blockSheet.getByRole('button', { name: 'Uit de planning halen' }).click()
  await expect(week.locator('.lesson-chip', { hasText: 'Veiligheid' })).toHaveCount(0)
  // Wind en steiger per dag; nieuw voorstel pas na een tik.
  const first = week.locator('.lesson-day').first()
  await first.getByRole('button', { name: /Wind normaal/ }).click()
  await expect(first.getByRole('button', { name: /Veel wind/ })).toBeVisible()
  await first.getByRole('button', { name: 'Steiger' }).click()
  await expect(first.getByRole('button', { name: 'Steiger' })).toHaveAttribute('aria-pressed', 'true')
  await week.getByRole('button', { name: 'Nieuw voorstel vanaf vandaag' }).click()
  await expect(page.locator('.toast')).toContainText('Nieuw voorstel vanaf vandaag')
  // Wat al gedaan is, komt niet opnieuw in de planning en staat niet bij "Niet ingepland".
  await expect(week.locator('.lesson-chip', { hasText: 'Veiligheid' })).toHaveCount(0)
  await expect(week.getByText(/Niet ingepland:.*Veiligheid/)).toHaveCount(0)
  await expect(week.locator('.lesson-chip', { hasText: 'Steiger' })).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
  await week.screenshot({ path: 'test-results/lesweek-planning-360.png' })

  // Vandaag: de lesplanning van vandaag, één tik = afvinken (zaterdag staat er niets).
  await page.getByRole('navigation').getByRole('button', { name: 'Vandaag', exact: true }).click()
  const todayCard = page.locator('.lesson-today')
  if (new Date().getDay() === 6) await expect(todayCard).toHaveCount(0)
  else {
    await expect(todayCard.getByRole('heading', { name: 'Lesweek vandaag' })).toBeVisible()
    const item = todayCard.getByRole('checkbox').first()
    const was = await item.getAttribute('aria-checked')
    await item.click()
    await expect(item).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true')
  }
  expect(errors).toEqual([])
})
