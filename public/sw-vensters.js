// Wordt door de service worker geladen (workbox importScripts). Een nieuwe versie neemt direct over (skipWaiting,
// clientsClaim) en zorgt dat geen enkel venster van Logboek op een oudere versie blijft draaien:
// - een venster van deze of een nieuwere versie antwoordt op het bericht en herlaadt zelf zodra het niets halverwege
//   afbreekt (eerste keer, wachtzin wijzigen, herstellen; zie src/updates.ts);
// - een venster van een oudere versie antwoordt niet en wordt herladen.
// Alleen bij een update (niet bij de allereerste installatie) en hoogstens één keer per minuut (geen herlaadlus).
const STATE = 'logboek-sw-vensters'

self.addEventListener('install', (event) => {
  const isUpdate = self.registration.active !== null
  event.waitUntil(caches.open(STATE).then((cache) => cache.put('update', new Response(isUpdate ? '1' : '0'))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(reloadWindows())
})

async function reloadWindows() {
  const cache = await caches.open(STATE)
  const flag = await cache.match('update')
  const isUpdate = flag ? (await flag.text()) === '1' : false
  await cache.delete('update')
  if (!isUpdate) return
  const last = await cache.match('herladen')
  const lastAt = last ? Number(await last.text()) : 0
  if (Date.now() - lastAt < 60 * 1000) return
  await cache.put('herladen', new Response(String(Date.now())))
  await self.clients.claim()
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  await Promise.all(
    windows.map(async (client) => {
      if (await reloadsItself(client)) return
      await client.navigate(client.url).catch(() => undefined)
    }),
  )
}

/** Antwoordt het venster binnen een seconde, dan herlaadt het zelf op een veilig moment. */
function reloadsItself(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 1000)
    channel.port1.onmessage = () => {
      clearTimeout(timer)
      resolve(true)
    }
    client.postMessage({ type: 'logboek-nieuwe-versie' }, [channel.port2])
  })
}
