import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // PBKDF2 met 600.000 rondes duurt per afleiding een paar honderd ms.
    testTimeout: 30_000,
  },
})
