import { defineConfig, devices } from '@playwright/test'

// Een telefoon van 360 px breed met touch (CLAUDE.md: alles werkt op 360 px, bedienbaar met één duim). De bredere Pixel 7
// (412 px) blijft alleen voor de schermafbeeldingen (die maken zelf 360 en 412) en de kaartgebaren.
const PHONE_360 = { ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: 'nl-NL' }
const WIDE = ['**/screenshots.spec.ts', '**/kaart-gebaren.spec.ts']

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI ook een JSON-verslag: scripts/playwright-retries.mjs print welke tests een tweede poging nodig hadden.
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'playwright-report/results.json' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/logboek/',
    // De tests lezen Nederlandse teksten; language.spec.ts test Engels apart.
    locale: 'nl-NL',
  },
  projects: [
    { name: 'mobiel', use: PHONE_360, testIgnore: WIDE },
    { name: 'pixel7', use: { ...devices['Pixel 7'], locale: 'nl-NL' }, testMatch: WIDE },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/logboek/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
