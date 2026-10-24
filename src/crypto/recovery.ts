import { utf8, type Bytes } from './encrypt'

// Herstelcode: 256 bits entropie als 24 BIP39-woorden (met controlegetal), Engelse woordenlijst.
// Er bestaat geen officiële Nederlandse BIP39-lijst.

export const RECOVERY_ENTROPY_LENGTH = 32
export const RECOVERY_WORD_COUNT = 24
const WORDLIST_SIZE = 2048
const HKDF_INFO = 'logboek/recovery-kek/v1'

export class RecoveryCodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecoveryCodeError'
  }
}

export async function loadWordlist(): Promise<string[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}bip39-en.txt`)
  if (!response.ok) throw new Error('Woordenlijst niet geladen')
  return parseWordlist(await response.text())
}

export function parseWordlist(text: string): string[] {
  const words = text.split(/\r?\n/).filter((w) => w.length > 0)
  if (words.length !== WORDLIST_SIZE) throw new Error('Woordenlijst is ongeldig')
  return words
}

async function checksumByte(entropy: Bytes): Promise<number> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy))
  return hash[0] ?? 0
}

export async function entropyToWords(entropy: Bytes, wordlist: readonly string[]): Promise<string[]> {
  if (entropy.length !== RECOVERY_ENTROPY_LENGTH) throw new Error('Entropie heeft een verkeerde lengte')
  const data = new Uint8Array(RECOVERY_ENTROPY_LENGTH + 1)
  data.set(entropy)
  data[RECOVERY_ENTROPY_LENGTH] = await checksumByte(entropy)
  const words: string[] = []
  for (let w = 0; w < RECOVERY_WORD_COUNT; w++) {
    let index = 0
    for (let b = 0; b < 11; b++) {
      const bit = w * 11 + b
      index = (index << 1) | (((data[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1)
    }
    const word = wordlist[index]
    if (word === undefined) throw new Error('Woordenlijst is ongeldig')
    words.push(word)
  }
  data.fill(0)
  return words
}

export function splitRecoveryCode(text: string): string[] {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
}

export async function wordsToEntropy(words: readonly string[], wordlist: readonly string[]): Promise<Bytes> {
  if (words.length !== RECOVERY_WORD_COUNT) {
    throw new RecoveryCodeError(`Herstelcode moet ${RECOVERY_WORD_COUNT} woorden hebben`)
  }
  const data = new Uint8Array(RECOVERY_ENTROPY_LENGTH + 1)
  words.forEach((word, w) => {
    const index = wordlist.indexOf(word)
    if (index < 0) throw new RecoveryCodeError(`Woord ${w + 1} staat niet in de woordenlijst`)
    for (let b = 0; b < 11; b++) {
      if ((index >> (10 - b)) & 1) {
        const bit = w * 11 + b
        data[bit >> 3] = (data[bit >> 3] ?? 0) | (1 << (7 - (bit & 7)))
      }
    }
  })
  const entropy = data.slice(0, RECOVERY_ENTROPY_LENGTH)
  const valid = data[RECOVERY_ENTROPY_LENGTH] === (await checksumByte(entropy))
  data.fill(0)
  if (!valid) {
    entropy.fill(0)
    throw new RecoveryCodeError('Herstelcode klopt niet; controleer de woorden')
  }
  return entropy
}

// De entropie is al 256 bits sterk; HKDF volstaat, rekenwerk tegen raden is niet nodig.
export async function deriveKekFromRecovery(entropy: Bytes, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', entropy, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(HKDF_INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}
