// Objectformaat: versie(1) | iv(12) | ciphertext | tag(16), AES-GCM-256.
// Associated data is het objectpad, zodat een object niet onder een ander pad terug te zetten is.

export const FORMAT_VERSION = 1
export const IV_LENGTH = 12
export const TAG_LENGTH = 16
const HEADER_LENGTH = 1 + IV_LENGTH

export type Bytes = Uint8Array<ArrayBuffer>

export class DecryptError extends Error {
  constructor() {
    super('Ontsleutelen mislukt')
    this.name = 'DecryptError'
  }
}

const encoder = new TextEncoder()

export function utf8(text: string): Bytes {
  return encoder.encode(text)
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function pack(iv: Bytes, sealed: ArrayBuffer): Bytes {
  const out = new Uint8Array(HEADER_LENGTH + sealed.byteLength)
  out[0] = FORMAT_VERSION
  out.set(iv, 1)
  out.set(new Uint8Array(sealed), HEADER_LENGTH)
  return out
}

export function unpack(blob: Bytes): { iv: Bytes; sealed: Bytes } {
  if (blob.length < HEADER_LENGTH + TAG_LENGTH || blob[0] !== FORMAT_VERSION) throw new DecryptError()
  return { iv: blob.slice(1, HEADER_LENGTH), sealed: blob.slice(HEADER_LENGTH) }
}

export async function encryptObject(key: CryptoKey, path: string, plaintext: Bytes): Promise<Bytes> {
  const iv = randomBytes(IV_LENGTH)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(path) }, key, plaintext)
  return pack(iv, sealed)
}

export async function decryptObject(key: CryptoKey, path: string, blob: Bytes): Promise<Bytes> {
  const { iv, sealed } = unpack(blob)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(path) }, key, sealed)
    return new Uint8Array(plain)
  } catch {
    throw new DecryptError()
  }
}

export function toBase64(bytes: Bytes): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
