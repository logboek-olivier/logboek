import { fromBase64, toBase64, utf8 } from '../crypto/encrypt'
import { deleteLocal, getLocal, putLocal, type Db } from './idb'

// Vingerafdruk is per apparaat (niet gesynct). Lokaal staan: credential-id, PRF-salt, HKDF-salt en de hoofdsleutel
// ingepakt onder de vingerafdruk-KEK. Dat laatste is AES-GCM-ciphertext; de salts en het id zijn niet geheim.

const NAME = 'fingerprint'
export const FINGERPRINT_AAD = 'local/fingerprint#masterKey'
const decoder = new TextDecoder()

export interface FingerprintRecord {
  credentialId: string
  prfSalt: string
  hkdfSalt: string
  wrappedKey: string
}

export async function loadFingerprint(db: Db): Promise<FingerprintRecord | null> {
  const blob = await getLocal(db, NAME)
  if (!blob) return null
  try {
    const raw: unknown = JSON.parse(decoder.decode(blob))
    if (!isFingerprintRecord(raw)) return null
    // Beschadigd record → null, zodat de app terugvalt op alleen de wachtzin in plaats van een verwarrende fout.
    const ok =
      fromBase64(raw.credentialId).length >= 16 &&
      fromBase64(raw.prfSalt).length === 32 &&
      fromBase64(raw.hkdfSalt).length === 16 &&
      fromBase64(raw.wrappedKey).length === WRAPPED_KEY_LENGTH
    return ok ? raw : null
  } catch {
    return null
  }
}

/** versie(1) | iv(12) | sleutel(32) | tag(16) */
const WRAPPED_KEY_LENGTH = 1 + 12 + 32 + 16

export async function saveFingerprint(db: Db, record: FingerprintRecord): Promise<void> {
  await putLocal(db, NAME, utf8(JSON.stringify(record)))
}

export async function deleteFingerprint(db: Db): Promise<void> {
  await deleteLocal(db, NAME)
}

function isFingerprintRecord(value: unknown): value is FingerprintRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return ['credentialId', 'prfSalt', 'hkdfSalt', 'wrappedKey'].every((k) => typeof r[k] === 'string')
}

export { toBase64, fromBase64 }
