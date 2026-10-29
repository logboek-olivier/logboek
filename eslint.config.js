import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', '.vorige', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Node-scripts (bijvoorbeeld iconen genereren).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', Buffer: 'readonly', console: 'readonly', process: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', URLSearchParams: 'readonly' },
    },
  },
  {
    // Aanvulling op de service worker (workbox importScripts).
    files: ['public/sw-vensters.js', 'public/reset.js'],
    languageOptions: { globals: { self: 'readonly', caches: 'readonly', navigator: 'readonly', location: 'readonly', Response: 'readonly', MessageChannel: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
)
