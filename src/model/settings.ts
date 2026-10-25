import type { Store } from '../storage/store'
import type { Settings } from './types'

// Laatst gebruikte waarden, zodat elke invoer maximaal drie velden kost.

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  updatedAt: '1970-01-01T00:00:00.000Z',
  deletedAt: null,
  lastBoat: '',
  lastRole: 'schipper',
  lastCurrency: 'EUR',
  lastSource: 'yacht-week',
}

export function currentSettings(records: readonly Settings[]): Settings {
  return records.find((s) => s.id === 'settings' && s.deletedAt === null) ?? DEFAULT_SETTINGS
}

export async function saveSettings(store: Store, patch: Partial<Omit<Settings, 'id' | 'updatedAt' | 'deletedAt'>>): Promise<void> {
  const current = currentSettings(store.get('settings.json.enc'))
  const next: Settings = { ...current, ...patch, id: 'settings', updatedAt: new Date().toISOString(), deletedAt: null }
  if (JSON.stringify({ ...current, updatedAt: '' }) === JSON.stringify({ ...next, updatedAt: '' })) return
  await store.put('settings.json.enc', next)
}
