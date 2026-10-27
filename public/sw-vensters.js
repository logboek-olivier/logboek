// Wordt door de service worker geladen (workbox importScripts). Een nieuwe versie neemt direct over (skipWaiting,
// clientsClaim) en herlaadt daarna elk open venster van Logboek, ook vensters van een oudere versie. Zo blijft er nooit
// een oud venster met een andere versie of sleutel naast de nieuwe draaien. Bij de allereerste installatie niet.
let isUpdate = false

self.addEventListener('install', () => {
  isUpdate = self.registration.active !== null
})

self.addEventListener('activate', (event) => {
  if (!isUpdate) return
  event.waitUntil(
    self.clients
      .claim()
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((windows) => Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)))),
  )
})
