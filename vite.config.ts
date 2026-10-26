import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/logboek/',
  plugins: [
    react(),
    VitePWA({
      // Nieuwe versie pas na "Herladen" (src/updates.ts); registratie in main.tsx, geen inline script (CSP).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Logboek',
        short_name: 'Logboek',
        description: 'Zeillogboek, zeilgeld en documenten, versleuteld.',
        lang: 'nl',
        start_url: '/logboek/',
        scope: '/logboek/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f7fa',
        theme_color: '#1d4e89',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,txt,webmanifest}'],
        navigateFallback: '/logboek/index.html',
      },
    }),
  ],
})
