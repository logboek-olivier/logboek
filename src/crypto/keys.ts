import { NewerSchemaError } from '../model/schema'
import {
  decryptObject,
  encryptObject,
  fromBase64,
  IV_LENGTH,
  pack,
  randomBytes,
  TAG_LENGTH,
  toBase64,
  unpack,
  utf8,
  type Bytes,
} from './encrypt'
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
const AAD_CHECK = `${META_PATH}#check`
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
  /**
   * Binding aan de hoofdsleutel: de drie verpakkingen, versleuteld onder MK. Een apparaat dat al ontgrendeld is
   * neemt een gewijzigde meta van GitHub alleen over als deze controle slaagt, zodat iemand met alleen
   * schrijfrechten op logboek-data de wachtzin niet op afstand ongeldig kan maken. Ontbreekt bij oudere meta.
   */
  check?: string
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

function checkPayload(meta: Meta): Bytes {
  return utf8(`${meta.passphrase.wrappedKey}|${meta.recovery.wrappedKey}|${meta.recoveryCode}`)
}

async function sealCheck(masterKey: CryptoKey, meta: Meta): Promise<string> {
  return toBase64(await encryptObject(masterKey, AAD_CHECK, checkPayload(meta)))
}

/**
 * Mag dit apparaat een andere meta (van GitHub) overnemen? Het check-veld dekt de verpakte sleutels, niet de salts en
 * rondes. Een echte wachtzinwijziging verpakt de sleutel opnieuw (nieuwe wrappedKey); iemand met alleen schrijfrechten
 * op de data-repo kan dat niet, maar wel de salts of rondes veranderen, en zo de wachtzin of herstelcode onbruikbaar
 * maken. Daarom: per verpakking moeten salt, rondes en kdf gelijk zijn, tenzij de verpakte sleutel zelf veranderde.
 */
export function safeToAdopt(local: Meta, remote: Meta): boolean {
  const p = local.passphrase
  const q = remote.passphrase
  const passphraseOk = q.wrappedKey !== p.wrappedKey || (q.salt === p.salt && q.iterations === p.iterations && q.kdf === p.kdf)
  const recoveryOk = remote.recovery.wrappedKey !== local.recovery.wrappedKey || (remote.recovery.salt === local.recovery.salt && remote.recovery.kdf === local.recovery.kdf)
  return passphraseOk && recoveryOk
}

/** Klopt de binding van deze meta aan de hoofdsleutel? Zonder `check`-veld: nee. */
export async function verifyMetaCheck(meta: Meta, masterKey: CryptoKey): Promise<boolean> {
  if (!meta.check) return false
  try {
    const plain = await decryptObject(masterKey, AAD_CHECK, fromBase64(meta.check))
    const expected = checkPayload(meta)
    return plain.length === expected.length && plain.every((b, i) => b === expected[i])
  } catch {
    return false
  }
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
    meta.check = await sealCheck(exportable, meta)
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
  const changed: Meta = {
    ...meta,
    passphrase: {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      wrappedKey: await wrap(mk, kek, AAD_PASSPHRASE),
    },
    recoveryCode: await wrap(entropyKey, kek, AAD_RECOVERY_CODE),
  }
  changed.check = await sealCheck(mk, changed)
  return changed
}

/**
 * Pakt de hoofdsleutel na controle van de wachtzin opnieuw in onder een andere KEK (bijvoorbeeld de vingerafdruk-KEK).
 * De sleutel is alleen binnen deze aanroep tijdelijk exporteerbaar.
 */
export async function rewrapMasterKey(meta: Meta, passphrase: string, kek: CryptoKey, aad: string): Promise<string> {
  const mk = await unwrap(meta.passphrase.wrappedKey, await passphraseKek(meta, passphrase), AAD_PASSPHRASE, true)
  return wrap(mk, kek, aad)
}

/** Haalt de hoofdsleutel (niet exporteerbaar) uit een met rewrapMasterKey gemaakte verpakking. */
export function unwrapMasterKey(wrapped: string, kek: CryptoKey, aad: string): Promise<CryptoKey> {
  return unwrap(wrapped, kek, aad, false)
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
/**
 * Lijkt deze tekst op een meta.json.enc (JSON met format logboek-meta)? Zo niet, dan is hij kapot en hoort hij bij geen
 * enkel logboek. Wel een meta die deze app niet kan lezen (nieuwer, of zonder geldige velden): mogelijk een ander logboek.
 */
export function looksLikeMeta(json: string): boolean {
  try {
    const raw: unknown = JSON.parse(json)
    return isRecord(raw) && raw.format === 'logboek-meta'
  } catch {
    return false
  }
}

export function parseMeta(json: string): Meta {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new InvalidMetaError()
  }
  if (!isRecord(raw) || raw.format !== 'logboek-meta') throw new InvalidMetaError()
  // Een nieuwere meta (geschreven door een nieuwere app) is geen fout in de data: de app moet bijgewerkt worden.
  if (typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 1) throw new NewerSchemaError(raw.version)
  if (raw.version !== 1) throw new InvalidMetaError()
  const { passphrase: p, recovery: r, recoveryCode, check } = raw
  if (check !== undefined && !isBase64Blob(check)) throw new InvalidMetaError()
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
  const meta: Meta = {
    format: 'logboek-meta',
    version: 1,
    passphrase: { kdf: 'PBKDF2-SHA256', iterations: p.iterations, salt: p.salt, wrappedKey: p.wrappedKey },
    recovery: { kdf: 'HKDF-SHA256', salt: r.salt, wrappedKey: r.wrappedKey },
    recoveryCode,
  }
  if (typeof check === 'string') meta.check = check
  return meta
}

/** Canonieke base64 van een AES-GCM-object (minimaal versie, IV en tag). */
function isBase64Blob(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const bytes = fromBase64(value)
    return bytes.length >= 1 + IV_LENGTH + TAG_LENGTH && toBase64(bytes) === value
  } catch {
    return false
  }
}
