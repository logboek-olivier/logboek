import { defineConfig, devices } from '@playwright/test'

// Integratietest in de browser tegen de echte GitHub-API (tests/integratie/browser.spec.ts), alleen in CI met
// LOGBOEK_IT_TOKEN (job "integratie" in .github/workflows/test.yml).
export default defineConfig({
  testDir: 'tests/integratie',
  testMatch: '*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/logboek/',
    locale: 'nl-NL',
  },
  projects: [{ name: 'mobiel', use: { ...devices['Pixel 7'], locale: 'nl-NL' } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/logboek/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
