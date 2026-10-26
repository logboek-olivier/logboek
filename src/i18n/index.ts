import { useSyncExternalStore } from 'react'
import { en } from './en'
import { nl, type Messages } from './nl'

// Eigen klein vertaalsysteem, zonder afhankelijkheid. nl.ts is de bron; en.ts moet hetzelfde type hebben, dus een
// ontbrekende of verkeerd gevormde vertaling is een typefout. Teksten met getallen of namen zijn functies.
// De taal is een voorkeur van dit apparaat (localStorage, geen geheim), zodat ook Ontgrendelen en Eerste keer
// in de goede taal staan. Standaard: de taal van de telefoon.

export type Lang = 'nl' | 'en'
export type MessageKey = keyof Messages
export const LANGS: readonly Lang[] = ['nl', 'en']

const CATALOGS: Record<Lang, Messages> = { nl, en }
const STORAGE_KEY = 'logboek-taal'

type Args<K extends MessageKey> = Messages[K] extends (params: infer P) => string ? [params: P] : []

let current: Lang = detect()
const listeners = new Set<() => void>()

function detect(): Lang {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (stored === 'nl' || stored === 'en') return stored
  } catch {
    // Geen localStorage: taal van het apparaat.
  }
  const preferred = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? 'nl'
  return preferred.toLowerCase().startsWith('nl') ? 'nl' : 'en'
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang, remember = true): void {
  current = lang
  if (remember) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, lang)
    } catch {
      // Niet bewaard; geldt dan alleen voor deze sessie.
    }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const l of listeners) l()
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Huidige taal als React-hook; de app tekent opnieuw als de taal wisselt. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang)
}

/** Vertaling in de huidige taal, of in `lang` (bijvoorbeeld een export in een andere taal dan de app). */
export function t<K extends MessageKey>(key: K, ...args: Args<K>): string {
  return translate(current, key, ...args)
}

export function translate<K extends MessageKey>(lang: Lang, key: K, ...args: Args<K>): string {
  const value = CATALOGS[lang][key] as string | ((params: unknown) => string)
  return typeof value === 'function' ? value(args[0]) : value
}

/** Locale voor Intl (getallen en datums). Engels in Britse notatie: dag-maand-jaar en euro's. */
export function locale(lang: Lang = current): string {
  return lang === 'nl' ? 'nl-NL' : 'en-GB'
}

/** Alle sleutels per taal, voor de test dat beide talen compleet zijn. */
export function catalogs(): Record<Lang, Messages> {
  return CATALOGS
}
