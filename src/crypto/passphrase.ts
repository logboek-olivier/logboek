import { utf8, type Bytes } from './encrypt'

export const PBKDF2_ITERATIONS = 600_000
export const SALT_LENGTH = 16

// KEK uit de wachtzin. De KEK kan alleen de hoofdsleutel in- en uitpakken.
// NFC-normalisatie zodat dezelfde wachtzin op elk toetsenbord dezelfde sleutel geeft.
export async function deriveKekFromPassphrase(
  passphrase: string,
  salt: Bytes,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (passphrase.length === 0) throw new Error('Wachtzin is leeg')
  const material = await crypto.subtle.importKey('raw', utf8(passphrase.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}
