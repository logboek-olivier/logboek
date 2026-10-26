import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/logboek/',
    // De tests lezen Nederlandse teksten; language.spec.ts test Engels apart.
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
