import type { Tx } from '../domain/tx'
import { deviceId } from '../storage/device'
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

export const DEFAULT_YEAR_GOAL_NM = 2500

export function yearGoal(settings: Settings): number {
  const goal = settings.yearGoalNm
  return typeof goal === 'number' && Number.isFinite(goal) && goal > 0 ? goal : DEFAULT_YEAR_GOAL_NM
}

/**
 * Wat bij invoer het laatst gekozen is (boot, rol, valuta, bron, trip, soort, watertype, contant of bank, soort uitgave):
 * per apparaat, in een eigen record (`laatst:<apparaat-id>`) naast de instellingen in settings.json.enc. Zo overschrijft
 * een dag of uitgave loggen op een telefoon zonder verbinding nooit een instelling die intussen op een ander apparaat
 * veranderde (het samenvoegen gaat per record: de laatste wijziging wint). Oudere versies lezen alleen 'settings'.
 */
export const LAST_USED_KEYS = ['lastBoat', 'lastRole', 'lastCurrency', 'lastSource', 'lastTripId', 'lastIncomeKind', 'lastCostKind', 'lastWater', 'lastTipVia', 'lastCostCategory'] as const

export function lastUsedId(device: string = deviceId()): `laatst:${string}` {
  return `laatst:${device}`
}

function mainSettings(records: readonly Settings[]): Settings {
  return records.find((s) => s.id === 'settings' && s.deletedAt === null) ?? DEFAULT_SETTINGS
}

/** De instellingen, met wat dit apparaat het laatst koos. */
export function currentSettings(records: readonly Settings[]): Settings {
  const main = mainSettings(records)
  const mine = records.find((s) => s.id === lastUsedId() && s.deletedAt === null)
  if (!mine) return main
  const overlay: Record<string, unknown> = {}
  for (const key of LAST_USED_KEYS) if (mine[key] !== undefined) overlay[key] = mine[key]
  return { ...main, ...overlay }
}

/** Instellingen opslaan; "laatst gebruikt" gaat naar het record van dit apparaat, de rest naar de instellingen. */
export async function saveSettings(store: Tx, patch: Partial<Omit<Settings, 'id' | 'updatedAt' | 'deletedAt'>>): Promise<void> {
  const records = store.get('settings.json.enc')
  const lastPatch: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) ((LAST_USED_KEYS as readonly string[]).includes(key) ? lastPatch : rest)[key] = value
  const now = new Date().toISOString()
  if (Object.keys(rest).length > 0) {
    const main = mainSettings(records)
    const next: Settings = { ...main, ...rest, id: 'settings', updatedAt: now, deletedAt: null }
    if (!same(main, next)) await store.put('settings.json.enc', next)
  }
  if (Object.keys(lastPatch).length > 0) {
    const current = currentSettings(records)
    const id = lastUsedId()
    const previous = records.find((s) => s.id === id && s.deletedAt === null)
    const remembered: Record<string, unknown> = {}
    for (const key of LAST_USED_KEYS) if (current[key] !== undefined) remembered[key] = current[key]
    const next = { ...remembered, ...lastPatch, id, updatedAt: now, deletedAt: null } as Settings
    if (!previous || !same(previous, next)) await store.put('settings.json.enc', next)
  }
}

function same(a: Settings, b: Settings): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })
}
