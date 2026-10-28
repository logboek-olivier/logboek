// Noodpagina (reset.html): service worker afmelden en de app-caches (Cache Storage) wissen, daarna naar de app.
// Raakt nooit IndexedDB, localStorage of andere gegevens: het logboek, de outbox en de token blijven staan.
;(async () => {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    }
  } catch {
    // Doorgaan: de caches wissen helpt ook al.
  }
  try {
    if ('caches' in self) {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    }
  } catch {
    // Doorgaan naar de app.
  }
  location.replace('./')
})()
