import type { Page } from '@playwright/test'

// Nagebootste public/rates.json (in CI en lokaal bestaat het bestand niet: deploy.yml bouwt het uit de ECB-bron).
// Verzonnen, ronde koersen, zodat de verwachte eurobedragen in de tests met de hand te volgen zijn.

function iso(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Koersen van 400 dagen geleden tot `untilDaysAgo` (0 = vandaag): USD 1,25 en GBP 0,80 per euro. */
export function fakeRates(untilDaysAgo = 0) {
  const dates: string[] = []
  for (let i = 400; i >= untilDaysAgo; i--) dates.push(iso(i))
  return {
    format: 'logboek-rates',
    source: 'nep',
    dates,
    rates: { USD: dates.map(() => 1.25), GBP: dates.map(() => 0.8), XCD: dates.map(() => 3.375) },
  }
}

export async function mockRates(page: Page, untilDaysAgo = 0): Promise<void> {
  const body = JSON.stringify(fakeRates(untilDaysAgo))
  await page.route('**/logboek/rates.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }))
}
