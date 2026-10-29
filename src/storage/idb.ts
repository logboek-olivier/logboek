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

/**
 * `onBlocked`: een andere pagina van de app (bijvoorbeeld een oudere versie die nog open staat) houdt de database
 * vast en laat de upgrade niet toe. Zonder melding zou de app stil blijven hangen.
 */
export async function openLogboekDb(name: string = DB_NAME, onBlocked?: () => void): Promise<Db> {
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
    blocked() {
      onBlocked?.()
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

export async function deleteObject(db: Db, path: string): Promise<void> {
  await db.delete('objects', path)
}

/** Het check-veld van de lokale meta.json.enc in de opgeslagen (onversleutelde) meta-tekst, of null. */
function storedCheck(meta: StoredObject | undefined): string | null {
  if (!meta) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(meta.blob))
    const check = typeof parsed === 'object' && parsed !== null ? (parsed as { check?: unknown }).check : undefined
    return typeof check === 'string' ? check : null
  } catch {
    return null
  }
}

/**
 * Schrijft een object alleen als de lokale meta (pad `metaPath`) nog het check-veld `expectedCheck` heeft, in één
 * transactie: een ander tabblad kan niet tussen controle en schrijven een ander logboek neerzetten. Geeft false
 * (en schrijft niets) als het check-veld anders is.
 */
export async function putObjectIfVault(db: Db, metaPath: string, expectedCheck: string, object: StoredObject): Promise<boolean> {
  const tx = db.transaction('objects', 'readwrite')
  const store = tx.objectStore('objects')
  const ok = storedCheck(await store.get(metaPath)) === expectedCheck
  if (ok) await store.put(object)
  await tx.done
  return ok
}

/**
 * Een bestand en de outbox samen schrijven, in één transactie: sluit de app midden in het opslaan, dan staat óf allebei
 * óf geen van beide op het apparaat. Met `expectedCheck` (de sleutel-invariant) alleen als de lokale meta nog dat
 * check-veld heeft; null: geen controle (alleen tests van de opslaglaag). Geeft false als er niets geschreven is.
 */
export async function putObjectAndLocal(
  db: Db,
  metaPath: string,
  expectedCheck: string | null,
  object: StoredObject,
  local: { name: string; blob: Bytes },
): Promise<boolean> {
  const tx = db.transaction(['objects', 'local'], 'readwrite')
  const objects = tx.objectStore('objects')
  const ok = expectedCheck === null || storedCheck(await objects.get(metaPath)) === expectedCheck
  if (ok) {
    await objects.put(object)
    await tx.objectStore('local').put(local)
  }
  await tx.done
  return ok
}

/**
 * Een lokaal bestand apart zetten onder `toKey` (nooit weggooien), in één transactie: alleen als de lokale meta nog bij
 * `expectedCheck` hoort (null: geen controle, alleen tests van de opslaglaag) en het bestand intussen niet veranderd is.
 */
export async function setAsideIfVault(db: Db, metaPath: string, expectedCheck: string | null, path: string, blob: Bytes, toKey: string): Promise<boolean> {
  const tx = db.transaction('objects', 'readwrite')
  const store = tx.objectStore('objects')
  const current = await store.get(path)
  const ok = (expectedCheck === null || storedCheck(await store.get(metaPath)) === expectedCheck) && sameBytes(current?.blob, blob)
  if (ok && current) {
    await store.put({ ...current, path: toKey })
    await store.delete(path)
  }
  await tx.done
  return ok
}

function sameBytes(a: Bytes | undefined, b: Bytes): boolean {
  return a !== undefined && a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Wist objecten (store 'objects') en lokale items (store 'local') in één transactie, alleen als de lokale meta nog het
 * check-veld `expectedCheck` heeft en elk item nog precies de verwachte inhoud heeft. Anders wordt niets gewist en
 * geeft de functie false: een ander tabblad heeft intussen iets geschreven.
 */
export async function deleteIfUnchanged(
  db: Db,
  metaPath: string,
  expectedCheck: string,
  items: { store: 'objects' | 'local'; key: string; blob: Bytes }[],
): Promise<boolean> {
  const tx = db.transaction(['objects', 'local'], 'readwrite')
  const objects = tx.objectStore('objects')
  const local = tx.objectStore('local')
  let ok = storedCheck(await objects.get(metaPath)) === expectedCheck
  for (const item of items) {
    if (!ok) break
    const current = item.store === 'objects' ? (await objects.get(item.key))?.blob : (await local.get(item.key))?.blob
    ok = sameBytes(current, item.blob)
  }
  if (ok) for (const item of items) await (item.store === 'objects' ? objects.delete(item.key) : local.delete(item.key))
  await tx.done
  return ok
}

/** Zoals putObjectIfVault, voor de sessiesleutel. */
export async function putSessionKeyIfVault(db: Db, metaPath: string, expectedCheck: string, record: SessionKeyRecord): Promise<boolean> {
  const tx = db.transaction(['objects', 'session'], 'readwrite')
  const ok = storedCheck(await tx.objectStore('objects').get(metaPath)) === expectedCheck
  if (ok) await tx.objectStore('session').put(record)
  await tx.done
  return ok
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
