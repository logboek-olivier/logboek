import { useSyncExternalStore } from 'react'

// Nieuwe versie van de app. Normaal neemt de nieuwe service worker direct over en herlaadt hij de vensters
// (public/sw-vensters.js); de outbox staat in IndexedDB en overleeft herladen. Wacht er toch een service worker, dan
// toont de balk "Herladen".

type Listener = () => void

class Updates {
  private available = false
  private apply: (() => void) | null = null
  private readonly listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isAvailable(): boolean {
    return this.available
  }

  /** Door de service-worker-registratie aangeroepen zodra een nieuwe versie klaarstaat. */
  announce(apply: () => void): void {
    this.available = true
    this.apply = apply
    for (const l of this.listeners) l()
  }

  /** Activeert de nieuwe service worker; die herlaadt daarna de pagina. */
  reload(): void {
    this.apply?.()
  }
}

export const updates = new Updates()

/** Wordt door de app gezet: true zolang herladen een stap halverwege zou afbreken. */
let busy: () => boolean = () => false

export function setBusyCheck(check: () => boolean): void {
  busy = check
}

/**
 * Een nieuwe service worker heeft overgenomen (public/sw-vensters.js). Dit venster herlaadt zelf, maar pas als er
 * niets halverwege is (eerste keer, wachtzin wijzigen, herstellen). De outbox staat in IndexedDB en blijft.
 */
export function listenForNewVersion(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type !== 'logboek-nieuwe-versie') return
    event.ports[0]?.postMessage('zelf')
    const reloadWhenIdle = () => {
      if (busy()) setTimeout(reloadWhenIdle, 2000)
      else window.location.reload()
    }
    reloadWhenIdle()
  })
  navigator.serviceWorker.startMessages()
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => updates.subscribe(l),
    () => updates.isAvailable(),
  )
}
