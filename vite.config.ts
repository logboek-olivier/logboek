import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Bouwgegevens voor Instellingen → Over: versie uit package.json, bouwdatum en korte commit-hash.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

/** Bouwdatum = datum van de commit, zodat de dagelijkse build (nieuwe koersen) dezelfde app oplevert en geen update meldt. */
function commitDate(): string {
  try {
    return execSync('git log -1 --format=%cI', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function commitHash(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'onbekend'
  }
}

export default defineConfig({
  base: '/logboek/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(commitDate()),
    __COMMIT__: JSON.stringify(commitHash()),
  },
  plugins: [
    react(),
    VitePWA({
      // Registratie in main.tsx, geen inline script (CSP). Nieuwe versies nemen zelf over (zie workbox hieronder).
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
        background_color: '#f6f3ec',
        theme_color: '#12263f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // Lang indrukken op het app-icoon: direct naar Toevoegen (na ontgrendelen of binnen de 5 minuten van de sessie).
        shortcuts: [
          { name: 'Trip toevoegen', short_name: 'Trip', url: '/logboek/?toevoegen=trip', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Dag loggen', short_name: 'Dag', url: '/logboek/?toevoegen=dag', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Inkomsten', short_name: 'Inkomsten', url: '/logboek/?toevoegen=inkomsten', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Uitgave', short_name: 'Uitgave', url: '/logboek/?toevoegen=uitgave', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      workbox: {
        // Een nieuwe versie neemt direct over, ruimt oude caches op en herlaadt open vensters (public/sw-vensters.js),
        // zodat er nooit twee versies tegelijk draaien. Olivier hoeft niets te doen.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        importScripts: ['sw-vensters.js'],
        // De offline kaart (public/coast/, ca. 3,5 MB) hoort in de precache: op zee moet de kaart werken.
        globPatterns: ['**/*.{js,css,html,svg,png,txt,webmanifest}', 'coast/*.json'],
        // De noodpagina (public/reset.html) staat nooit in de precache en komt altijd van het netwerk.
        globIgnores: ['**/reset.html', '**/reset.js'],
        // De app-pagina zelf: altijd van het netwerk (herladen met verbinding geeft de nieuwste versie), offline de
        // index.html uit de precache, die altijd bij de scripts van de actieve versie hoort. Niet apart cachen: een
        // los bewaarde pagina kan naar scripts verwijzen die niet (meer) in de precache staan. Daarom geen
        // navigateFallback en geen directoryIndex: anders komt /logboek/ altijd uit de precache.
        navigateFallback: null,
        directoryIndex: 'geen-mapindex',
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.endsWith('/reset.html'),
            handler: 'NetworkOnly',
            options: {
              fetchOptions: { cache: 'no-cache' },
              precacheFallback: { fallbackURL: '/logboek/index.html' },
            },
          },
          // Koersen niet in de precache (die verandert dagelijks): eerst het netwerk, offline de laatst opgehaalde.
          { urlPattern: /\/logboek\/rates\.json$/, handler: 'NetworkFirst', options: { cacheName: 'koersen', networkTimeoutSeconds: 5 } },
          // Gedetailleerde kaartdata (public/osm/, tientallen MB): niet in de precache, maar per vak bij het eerste gebruik
          // opgehaald en daarna offline uit de cache (op de achtergrond bijgewerkt als er verbinding is).
          { urlPattern: /\/logboek\/osm\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'kaart-osm' } },
        ],
      },
    }),
  ],
})
