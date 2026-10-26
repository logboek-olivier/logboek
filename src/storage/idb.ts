import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Bytes } from '../crypto/encrypt'

// Lokale kopie op het apparaat. Alles wat hier staat is versleuteld of al versleuteld van GitHub gekomen:
// - objects: bestanden uit logboek-data (ciphertext) met de laatst bekende SHA
// - local: lokale versleutelde items (token, outbox) onder de hoofdsleutel
// - session: de niet-exporteerbare hoofdsleutel (CryptoKey) met het tijdstip van laatste gebruik, hoogstens
//   5 minuten na dat tijdstip bruikbaar (beveiligingsregel 10, zie src/session.ts)

export const DB_NAME = 'logboek'
const DB_VERSION = 2

export interface StoredObject {
  path: string
  blob: Bytes
  sha: string | null
}

export interface SessionKeyRecord {
  name: 'masterKey'
  /** extractable: false; de browser bewaart hem, JavaScript kan de bytes niet uitlezen. */
  key: CryptoKey
  /** Laatste gebruik, ms sinds 1970. */
  lastUsed: number
}

interface Schema extends DBSchema {
  objects: { key: string; value: StoredObject }
  local: { key: string; value: { name: string; blob: Bytes } }
  session: { key: string; value: SessionKeyRecord }
}

export type Db = IDBPDatabase<Schema>

export async function openLogboekDb(name: string = DB_NAME): Promise<Db> {
  const db: Db = await openDB<Schema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Versie 1 → 2 voegt alleen 'session' toe; bestaande data blijft staan.
      if (oldVersion < 1) {
        db.createObjectStore('objects', { keyPath: 'path' })
        db.createObjectStore('local', { keyPath: 'name' })
      }
      if (oldVersion < 2) db.createObjectStore('session', { keyPath: 'name' })
    },
    // Een nieuwere versie van de app in een ander tabblad wil upgraden: deze verbinding loslaten.
    blocking() {
      db.close()
    },
  })
  return db
}

export async function getObject(db: Db, path: string): Promise<StoredObject | undefined> {
  return db.get('objects', path)
}

export async function putObject(db: Db, object: StoredObject): Promise<void> {
  await db.put('objects', object)
}

export async function getLocal(db: Db, name: string): Promise<Bytes | undefined> {
  return (await db.get('local', name))?.blob
}

export async function putLocal(db: Db, name: string, blob: Bytes): Promise<void> {
  await db.put('local', { name, blob })
}

export async function deleteLocal(db: Db, name: string): Promise<void> {
  await db.delete('local', name)
}

export async function getSessionKey(db: Db): Promise<SessionKeyRecord | undefined> {
  return db.get('session', 'masterKey')
}

export async function putSessionKey(db: Db, record: SessionKeyRecord): Promise<void> {
  await db.put('session', record)
}

export async function deleteSessionKey(db: Db): Promise<void> {
  await db.delete('session', 'masterKey')
}

/** Wist alle lokale data (bijvoorbeeld bij een ander logboek koppelen). */
export async function clearAll(db: Db): Promise<void> {
  const tx = db.transaction(['objects', 'local', 'session'], 'readwrite')
  await Promise.all([tx.objectStore('objects').clear(), tx.objectStore('local').clear(), tx.objectStore('session').clear(), tx.done])
}
