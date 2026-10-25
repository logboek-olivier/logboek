import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Bytes } from '../crypto/encrypt'

// Lokale kopie op het apparaat. Alles wat hier staat is versleuteld of al versleuteld van GitHub gekomen:
// - objects: bestanden uit logboek-data (ciphertext) met de laatst bekende SHA
// - local: lokale versleutelde items (token, outbox) onder de hoofdsleutel

export const DB_NAME = 'logboek'
const DB_VERSION = 1

export interface StoredObject {
  path: string
  blob: Bytes
  sha: string | null
}

interface Schema extends DBSchema {
  objects: { key: string; value: StoredObject }
  local: { key: string; value: { name: string; blob: Bytes } }
}

export type Db = IDBPDatabase<Schema>

export function openLogboekDb(name: string = DB_NAME): Promise<Db> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('objects', { keyPath: 'path' })
      db.createObjectStore('local', { keyPath: 'name' })
    },
  })
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

/** Wist alle lokale data (bijvoorbeeld bij een ander logboek koppelen). */
export async function clearAll(db: Db): Promise<void> {
  const tx = db.transaction(['objects', 'local'], 'readwrite')
  await Promise.all([tx.objectStore('objects').clear(), tx.objectStore('local').clear(), tx.done])
}
