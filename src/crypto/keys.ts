import { fromBase64, IV_LENGTH, pack, randomBytes, TAG_LENGTH, toBase64, unpack, utf8, type Bytes } from './encrypt'
import { deriveKekFromPassphrase, PBKDF2_ITERATIONS, SALT_LENGTH } from './passphrase'
import {
  deriveKekFromRecovery,
  entropyToWords,
  RECOVERY_ENTROPY_LENGTH,
  splitRecoveryCode,
  wordsToEntropy,
} from './recovery'

// meta.json.enc bevat de hoofdsleutel (MK), versleuteld onder elke KEK, plus salts en versie.
// Salts en rondes moeten vóór ontgrendelen leesbaar zijn; al het geheime staat er als AES-GCM-ciphertext in.

export const META_PATH = 'meta.json.enc'
const AAD_PASSPHRASE = `${META_PATH}#passphrase`
const AAD_RECOVERY = `${META_PATH}#recovery`
const AAD_RECOVERY_CODE = `${META_PATH}#recoveryCode`
const MAX_PBKDF2_ITERATIONS = 10_000_000
const KEY_LENGTH = 32
const WRAPPED_LENGTH = 1 + IV_LENGTH + KEY_LENGTH + TAG_LENGTH

const AES_256 = { name: 'AES-GCM', length: 256 } as const
const MK_USAGES: KeyUsage[] = ['encrypt', 'decrypt']

export interface Meta {
  format: 'logboek-meta'
  version: 1
  passphrase: { kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; wrappedKey: string }
  recovery: { kdf: 'HKDF-SHA256'; salt: string; wrappedKey: string }
  /** Herstelcode-entropie onder de wachtzin-KEK, voor "herstelcode tonen". */
  recoveryCode: string
}

export type Secret = { passphrase: string } | { recoveryCode: string; wordlist: readonly string[] }

export class WrongSecretError extends Error {
  constructor() {
    super('Wachtzin of herstelcode klopt niet')
    this.name = 'WrongSecretError'
  }
}

export class InvalidMetaError extends Error {
  constructor() {
    super('meta.json.enc is ongeldig')
    this.name = 'InvalidMetaError'
  }
}

async function wrap(key: CryptoKey, kek: CryptoKey, aad: string): Promise<string> {
  const iv = randomBytes(IV_LENGTH)
  const sealed = await crypto.subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv, additionalData: utf8(aad) })
  return toBase64(pack(iv, sealed))
}

async function unwrap(wrapped: string, kek: CryptoKey, aad: string, extractable: boolean): Promise<CryptoKey> {
  try {
    const { iv, sealed } = unpack(fromBase64(wrapped))
    return await crypto.subtle.unwrapKey(
      'raw',
      sealed,
      kek,
      { name: 'AES-GCM', iv, additionalData: utf8(aad) },
      AES_256,
      extractable,
      MK_USAGES,
    )
  } catch {
    throw new WrongSecretError()
  }
}

// De herstelcode-entropie (32 bytes) wordt als AES-sleutel ingepakt onder de wachtzin-KEK, niet onder MK.
// Anders kan code in een ontgrendelde sessie met alleen de MK-handle de ruwe MK terugkrijgen.
function entropyAsKey(entropy: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', entropy, AES_256, true, MK_USAGES)
}

async function unwrapRecoveryCode(meta: Meta, passphraseKek: CryptoKey): Promise<CryptoKey> {
  try {
    return await unwrap(meta.recoveryCode, passphraseKek, AAD_RECOVERY_CODE, true)
  } catch {
    // De wachtzin is op dit punt al gecontroleerd via de MK.
    throw new InvalidMetaError()
  }
}

function passphraseKek(meta: Meta, passphrase: string): Promise<CryptoKey> {
  return deriveKekFromPassphrase(passphrase, fromBase64(meta.passphrase.salt), meta.passphrase.iterations)
}

export interface NewVault {
  meta: Meta
  masterKey: CryptoKey
  recoveryWords: string[]
}

export async function createVault(passphrase: string, wordlist: readonly string[]): Promise<NewVault> {
  const mkBytes = randomBytes(KEY_LENGTH)
  const exportable = await crypto.subtle.importKey('raw', mkBytes, AES_256, true, MK_USAGES)
  mkBytes.fill(0)
  const entropy = randomBytes(RECOVERY_ENTROPY_LENGTH)
  try {
    const passphraseSalt = randomBytes(SALT_LENGTH)
    const recoverySalt = randomBytes(SALT_LENGTH)
    const pKek = await deriveKekFromPassphrase(passphrase, passphraseSalt)
    const rKek = await deriveKekFromRecovery(entropy, recoverySalt)
    const meta: Meta = {
      format: 'logboek-meta',
      version: 1,
      passphrase: {
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(passphraseSalt),
        wrappedKey: await wrap(exportable, pKek, AAD_PASSPHRASE),
      },
      recovery: {
        kdf: 'HKDF-SHA256',
        salt: toBase64(recoverySalt),
        wrappedKey: await wrap(exportable, rKek, AAD_RECOVERY),
      },
      recoveryCode: await wrap(await entropyAsKey(entropy), pKek, AAD_RECOVERY_CODE),
    }
    const recoveryWords = await entropyToWords(entropy, wordlist)
    const masterKey = await unwrap(meta.passphrase.wrappedKey, pKek, AAD_PASSPHRASE, false)
    return { meta, masterKey, recoveryWords }
  } finally {
    entropy.fill(0)
  }
}

export async function unlock(meta: Meta, secret: Secret): Promise<CryptoKey> {
  if ('passphrase' in secret) {
    return unwrap(meta.passphrase.wrappedKey, await passphraseKek(meta, secret.passphrase), AAD_PASSPHRASE, false)
  }
  const entropy = await wordsToEntropy(splitRecoveryCode(secret.recoveryCode), secret.wordlist)
  try {
    const kek = await deriveKekFromRecovery(entropy, fromBase64(meta.recovery.salt))
    return await unwrap(meta.recovery.wrappedKey, kek, AAD_RECOVERY, false)
  } finally {
    entropy.fill(0)
  }
}

/** Nieuwe wachtzin met de huidige wachtzin of de herstelcode. Data wordt niet opnieuw versleuteld. */
export async function changePassphrase(meta: Meta, current: Secret, newPassphrase: string): Promise<Meta> {
  // Alleen hier zijn MK en entropie tijdelijk exporteerbaar, om ze onder de nieuwe KEK in te pakken.
  let mk: CryptoKey
  let entropyKey: CryptoKey
  if ('passphrase' in current) {
    const kek = await passphraseKek(meta, current.passphrase)
    mk = await unwrap(meta.passphrase.wrappedKey, kek, AAD_PASSPHRASE, true)
    entropyKey = await unwrapRecoveryCode(meta, kek)
  } else {
    const entropy = await wordsToEntropy(splitRecoveryCode(current.recoveryCode), current.wordlist)
    try {
      const kek = await deriveKekFromRecovery(entropy, fromBase64(meta.recovery.salt))
      mk = await unwrap(meta.recovery.wrappedKey, kek, AAD_RECOVERY, true)
      entropyKey = await entropyAsKey(entropy)
    } finally {
      entropy.fill(0)
    }
  }
  const salt = randomBytes(SALT_LENGTH)
  const kek = await deriveKekFromPassphrase(newPassphrase, salt)
  return {
    ...meta,
    passphrase: {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      wrappedKey: await wrap(mk, kek, AAD_PASSPHRASE),
    },
    recoveryCode: await wrap(entropyKey, kek, AAD_RECOVERY_CODE),
  }
}

export async function revealRecoveryWords(
  meta: Meta,
  passphrase: string,
  wordlist: readonly string[],
): Promise<string[]> {
  const kek = await passphraseKek(meta, passphrase)
  await unwrap(meta.passphrase.wrappedKey, kek, AAD_PASSPHRASE, false)
  const entropy = new Uint8Array(await crypto.subtle.exportKey('raw', await unwrapRecoveryCode(meta, kek)))
  try {
    return await entropyToWords(entropy, wordlist)
  } finally {
    entropy.fill(0)
  }
}

export function serializeMeta(meta: Meta): string {
  return JSON.stringify(meta)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Canonieke base64 die precies `length` bytes oplevert. */
function isBase64Of(value: unknown, length: number): value is string {
  if (typeof value !== 'string') return false
  try {
    const bytes = fromBase64(value)
    return bytes.length === length && toBase64(bytes) === value
  } catch {
    return false
  }
}

/** meta.json.enc komt van het netwerk en wordt volledig gecontroleerd voordat iets het gebruikt. */
export function parseMeta(json: string): Meta {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new InvalidMetaError()
  }
  if (!isRecord(raw) || raw.format !== 'logboek-meta' || raw.version !== 1) throw new InvalidMetaError()
  const { passphrase: p, recovery: r, recoveryCode } = raw
  if (
    !isRecord(p) ||
    p.kdf !== 'PBKDF2-SHA256' ||
    typeof p.iterations !== 'number' ||
    !Number.isInteger(p.iterations) ||
    p.iterations < PBKDF2_ITERATIONS ||
    p.iterations > MAX_PBKDF2_ITERATIONS ||
    !isBase64Of(p.salt, SALT_LENGTH) ||
    !isBase64Of(p.wrappedKey, WRAPPED_LENGTH) ||
    !isRecord(r) ||
    r.kdf !== 'HKDF-SHA256' ||
    !isBase64Of(r.salt, SALT_LENGTH) ||
    !isBase64Of(r.wrappedKey, WRAPPED_LENGTH) ||
    !isBase64Of(recoveryCode, WRAPPED_LENGTH)
  ) {
    throw new InvalidMetaError()
  }
  return {
    format: 'logboek-meta',
    version: 1,
    passphrase: { kdf: 'PBKDF2-SHA256', iterations: p.iterations, salt: p.salt, wrappedKey: p.wrappedKey },
    recovery: { kdf: 'HKDF-SHA256', salt: r.salt, wrappedKey: r.wrappedKey },
    recoveryCode,
  }
}
