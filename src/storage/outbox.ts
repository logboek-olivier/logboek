import { decryptObject, encryptObject, utf8, type Bytes } from '../crypto/encrypt'
import { deleteLocal, getLocal, putLocal, type Db } from './idb'

// Outbox: welke records sinds de laatste geslaagde sync lokaal zijn gewijzigd, per bestand.
// { [pad]: { [recordId]: updatedAt } }. Versleuteld onder de hoofdsleutel in IndexedDB.

export type Outbox = Record<string, Record<string, string>>

export const OUTBOX_NAME = 'outbox'
const OUTBOX_AAD = 'local/outbox'
const decoder = new TextDecoder()

export function markPending(outbox: Outbox, path: string, id: string, updatedAt: string): Outbox {
  return { ...outbox, [path]: { ...outbox[path], [id]: updatedAt } }
}

/** Haalt de records weg die bij de sync zijn meegegaan; later gewijzigde records blijven staan. */
export function clearSynced(outbox: Outbox, path: string, synced: Record<string, string>): Outbox {
  const rest: Record<string, string> = {}
  for (const [id, updatedAt] of Object.entries(outbox[path] ?? {})) {
    const syncedAt = synced[id]
    if (syncedAt === undefined || updatedAt > syncedAt) rest[id] = updatedAt
  }
  const next = { ...outbox }
  if (Object.keys(rest).length > 0) next[path] = rest
  else delete next[path]
  return next
}

export function pendingCount(outbox: Outbox): number {
  return Object.values(outbox).reduce((n, ids) => n + Object.keys(ids).length, 0)
}

export async function loadOutbox(db: Db, masterKey: CryptoKey): Promise<Outbox> {
  const blob = await getLocal(db, OUTBOX_NAME)
  if (!blob) return {}
  const plain = await decryptObject(masterKey, OUTBOX_AAD, blob)
  // Wel ontsleuteld maar geen geldige outbox: leeg beginnen (de gegevens zelf staan in de bestanden en blijven).
  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(plain))
  } catch {
    return {}
  }
  return isOutbox(raw) ? raw : {}
}

export async function saveOutbox(db: Db, masterKey: CryptoKey, outbox: Outbox): Promise<void> {
  const blob: Bytes = await encryptObject(masterKey, OUTBOX_AAD, utf8(JSON.stringify(outbox)))
  await putLocal(db, OUTBOX_NAME, blob)
}

export async function deleteOutbox(db: Db): Promise<void> {
  await deleteLocal(db, OUTBOX_NAME)
}

function isOutbox(value: unknown): value is Outbox {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(
    (ids) =>
      typeof ids === 'object' &&
      ids !== null &&
      !Array.isArray(ids) &&
      Object.values(ids).every((t) => typeof t === 'string'),
  )
}
