import { daysUntil } from '../session'

// Volgende vervaldatum uit alles wat een vervaldatum heeft (nu: de GitHub-token; later documenten in de kluis).

export interface Expiring {
  label: string
  /** jjjj-mm-dd of null als onbekend. */
  date: string | null
}

export function nextExpiry(items: readonly Expiring[], today: string): { label: string; date: string; days: number } | null {
  let best: { label: string; date: string; days: number } | null = null
  for (const item of items) {
    const days = daysUntil(item.date, today)
    if (days === null || !item.date) continue
    if (!best || days < best.days) best = { label: item.label, date: item.date, days }
  }
  return best
}
