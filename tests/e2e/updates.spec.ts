import { expect, test, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { createNewLogbook } from './helpers/logbook'

// Updates zijn in elke toestand mogelijk: de app-pagina komt eerst van het netwerk, en de noodpagina reset.html meldt
// de service worker af en wist de caches zonder het logboek aan te raken.

async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
}

test('herladen met verbinding geeft de nieuwste app-pagina, niet die uit de precache', async ({ page, context }) => {
  await mockGithub(page)
  await page.goto('./')
  await waitForServiceWorker(page)
  // Een "nieuwe versie" van de pagina op de server: met de oude precache-route zou herladen die nooit tonen.
  await context.route(/\/logboek\/(\?.*)?$/, async (route) => {
    const response = await route.fetch()
    const html = (await response.text()).replace('<title>Logboek</title>', '<title>Logboek nieuw</title>')
    await route.fulfill({ response, body: html })
  })
  await page.reload()
  await expect(page).toHaveTitle('Logboek nieuw')
  // Offline: de index.html uit de precache (hoort bij de actieve versie), de app start gewoon.
  await context.unroute(/\/logboek\/(\?.*)?$/)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Nieuw logboek' })).toBeVisible()
  await context.setOffline(false)
})

test('reset.html: service worker afgemeld en caches gewist, het logboek blijft staan', async ({ page }) => {
  await mockGithub(page)
  await createNewLogbook(page)
  await waitForServiceWorker(page)
  await page.evaluate(async () => {
    const cache = await caches.open('nep-oude-versie')
    await cache.put('/logboek/nep', new Response('oud'))
  })
  await page.goto('./reset.html')
  await page.waitForURL(/\/logboek\/$/)
  expect(await page.evaluate(() => caches.has('nep-oude-versie'))).toBe(false)
  // Gegevens staan er nog: geen "Eerste keer", maar het logboek (binnen 5 minuten hervat).
  await expect(page.getByRole('heading', { name: 'Vandaag' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nieuw logboek' })).toHaveCount(0)
})

test('reset.html staat niet in de precache en komt nooit uit de navigatie-fallback', async ({ page }) => {
  await mockGithub(page)
  await page.goto('./')
  await waitForServiceWorker(page)
  const precached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    return urls
  })
  expect(precached.some((u) => u.includes('index.html'))).toBe(true)
  expect(precached.some((u) => u.includes('reset'))).toBe(false)
})
