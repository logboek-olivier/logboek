import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/logboek/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registratie via een extern script; geen inline script vanwege de CSP.
      injectRegister: 'script',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Logboek',
        short_name: 'Logboek',
        lang: 'nl',
        start_url: '/logboek/',
        scope: '/logboek/',
        display: 'standalone',
        background_color: '#f5f7fa',
        theme_color: '#1d4e89',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,txt,webmanifest}'],
        navigateFallback: '/logboek/index.html',
      },
    }),
  ],
})
