import { useSyncExternalStore } from 'react'

// Nieuwe versie van de app. Normaal neemt de nieuwe service worker direct over en herlaadt hij de vensters
// (public/sw-vensters.js); de outbox staat in IndexedDB en overleeft herladen. Kan dit venster nog niet herladen, of
// wacht er toch een service worker, dan toont de balk "Herladen" op elk scherm. Updates zijn in elke toestand mogelijk.

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
    if (crashed || urgent()) apply()
  }

  /** Activeert de nieuwe service worker; die herlaadt daarna de pagina. */
  reload(): void {
    this.apply?.()
  }
}

export const updates = new Updates()

/** Wordt door de app gezet: true zolang herladen een stap halverwege zou afbreken. */
let busy: () => boolean = () => false
/** Wordt door de app gezet: true op een fout-, herstel- of sleutelscherm; daar wordt een nieuwe versie direct actief. */
let urgent: () => boolean = () => false
let crashed = false

export function setBusyCheck(check: () => boolean): void {
  busy = check
}

export function setUrgentCheck(check: () => boolean): void {
  urgent = check
}

/** Het foutscherm (ErrorBoundary) staat open: een nieuwe versie direct laden, ook als die er al klaarstaat. */
export function markCrashed(): void {
  crashed = true
  if (updates.isAvailable()) updates.reload()
}

/**
 * Een nieuwe service worker heeft overgenomen (public/sw-vensters.js). De balk "Nieuwe versie beschikbaar · Herladen"
 * staat direct op elk scherm. Op een fout-, herstel- of sleutelscherm herlaadt dit venster meteen; elders zodra er
 * niets halverwege is (eerste keer, wachtzin wijzigen, herstellen). De outbox staat in IndexedDB en blijft.
 */
export function listenForNewVersion(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type !== 'logboek-nieuwe-versie') return
    event.ports[0]?.postMessage('zelf')
    updates.announce(() => window.location.reload())
    const reloadWhenIdle = () => {
      if (crashed || urgent() || !busy()) window.location.reload()
      else setTimeout(reloadWhenIdle, 2000)
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
