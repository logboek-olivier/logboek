import { expect, test } from '@playwright/test'
import { META_PATH, parseMeta, unlock } from '../../src/crypto/keys'
import { translate, type Lang, type MessageKey } from '../../src/i18n'
import type { Leg, SyncRecord, Trip } from '../../src/model/types'
import { decryptRecords, encryptRecords } from '../../src/storage/sync'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook, expectNoHorizontalOverflow, openMore, PASSPHRASE } from './helpers/logbook'

// Meer → Opslag → Logboek herstellen in de echte app (360 px): een logboek zoals na terugzetten van een samengevoegde
// trip met de vorige versie (een geïmporteerde trip met datums over een andere trip heen, en een deelnemer dubbel),
// het voorbeeld, één tik op Herstellen, en ongedaan maken. Alle gegevens verzonnen.

const T = '2026-10-20T10:00:00.000Z'

function leg(trip: string, date: string, n: number, from: string, to: string): Leg {
  return { id: `import:${trip}:${date}:${n}`, tripId: trip, date, fromPlace: from, fromCountry: 'NL', toPlace: to, toCountry: 'NL', role: 'schipper', boat: 'Nepboot', nmInland: 0, nmSea: 10, nmTidal: 0, nightHours: 0, dateEstimated: false, source: 'import', updatedAt: T, deletedAt: null }
}

const TRIPS: Trip[] = [
  // Samengevoegd en weer gesplitst: de datums van samenvoegen (over de andere trip heen) en de deelnemer van de ander.
  { id: 'herstel-a', name: 'Nep trainingsweek', startDate: '2024-04-13', endDate: '2024-10-16', participants: [{ id: 'herstel-pa', firstName: 'Nepanna' }, { id: 'herstel-pb', firstName: 'Nepbob' }], updatedAt: T, deletedAt: null },
  { id: 'herstel-b', name: 'Nep zeilweekend', participants: [{ id: 'herstel-pb', firstName: 'Nepbob' }], updatedAt: T, deletedAt: null },
]
const LEGS: Leg[] = [
  leg('herstel-a', '2024-04-13', 0, 'Nephaven', 'Nepbaai'),
  leg('herstel-a', '2024-04-14', 0, 'Nepbaai', 'Nephaven'),
  leg('herstel-b', '2024-10-15', 0, 'Nepdorp', 'Nepzand'),
  leg('herstel-b', '2024-10-16', 0, 'Nepzand', 'Nepdorp'),
]

for (const lang of ['nl', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test.use({ locale: lang === 'nl' ? 'nl-NL' : 'en-GB', viewport: { width: 360, height: 800 } })
    test(`Logboek herstellen: voorbeeld, één tik, ongedaan maken (${lang})`, async ({ page }) => {
      test.setTimeout(120_000)
      const L = (key: MessageKey, ...args: unknown[]) => (translate as (l: Lang, k: MessageKey, ...a: unknown[]) => string)(lang, key, ...args)
      const github = await mockGithub(page)
      await createNewLogbook(page, lang)
      const status = page.getByRole('status').first()
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })

      // Een ander apparaat (de vorige versie) zette de beschadigde trips en dagen op GitHub.
      const key = await unlock(parseMeta(Buffer.from(github.files.get(META_PATH)!.content, 'base64').toString('utf8')), { passphrase: PASSPHRASE })
      for (const [path, records] of [
        ['trips.json.enc', TRIPS],
        ['legs.json.enc', LEGS],
      ] as const) {
        const sealed = await encryptRecords(key, path, records as readonly SyncRecord[])
        github.files.set(path, { sha: `sha-herstel-${path}`, content: Buffer.from(sealed).toString('base64') })
      }
      await status.click()
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })

      await openMore(page, L('nav.storage'), L('nav.more'))
      const section = page.locator('.link-repair')
      await expect(section.getByRole('heading', { name: L('links.title') })).toBeVisible()
      await expect(section).toContainText(L('links.intro'))
      await expect(section).toContainText('Nep trainingsweek')
      await expect(section).toContainText(L('links.fromDays'))
      await expect(section).toContainText(L('links.dupes', { people: 'Nepbob' }))
      await section.scrollIntoViewIfNeeded()
      await expectNoHorizontalOverflow(page)

      await section.getByRole('button', { name: L('links.button') }).click()
      await expect(page.locator('.toast')).toContainText(L('links.done'))
      await expect(section).toContainText(L('links.ok'))

      // Op GitHub: de trip weer zonder eigen datums, de deelnemer alleen nog bij zijn eigen trip.
      await expect(status).toHaveText(L('sync.synced'), { timeout: 15_000 })
      const trips = await decryptRecords<Trip>(key, 'trips.json.enc', Uint8Array.from(Buffer.from(github.files.get('trips.json.enc')!.content, 'base64')))
      const a = trips.find((t) => t.id === 'herstel-a')!
      expect([a.startDate, a.endDate]).toEqual([undefined, undefined])
      expect((a.participants ?? []).map((p) => p.id)).toEqual(['herstel-pa'])
      expect((trips.find((t) => t.id === 'herstel-b')!.participants ?? []).map((p) => p.id)).toEqual(['herstel-pb'])

      // Ongedaan maken: het voorbeeld staat er weer.
      await page.locator('.toast').getByRole('button', { name: L('common.undo') }).click()
      await expect(section.getByRole('button', { name: L('links.button') })).toBeVisible()
    })
  })
}
