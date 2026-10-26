import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DecryptError, decryptObject, encryptObject, fromBase64, toBase64, utf8, type Bytes } from '../src/crypto/encrypt'
import {
  changePassphrase,
  createVault,
  InvalidMetaError,
  parseMeta,
  revealRecoveryWords,
  serializeMeta,
  unlock,
  verifyMetaCheck,
  WrongSecretError,
  type Meta,
} from '../src/crypto/keys'
import { entropyToWords, parseWordlist, RecoveryCodeError, wordsToEntropy } from '../src/crypto/recovery'

// Vectoren berekend met node:crypto (pbkdf2Sync, hkdfSync, createCipheriv), los van de WebCrypto-code.
// MK = bytes 00..1f, herstelcode-entropie = 32 x 7f. Alle waarden zijn verzonnen testdata.

const wordlist = parseWordlist(readFileSync(new URL('../public/bip39-en.txt', import.meta.url), 'utf8'))
const decoder = new TextDecoder()

const seq = (start: number, length: number): Bytes => Uint8Array.from({ length }, (_, i) => (start + i) & 0xff)
const hex = (text: string): Bytes => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16))

function importKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const OBJECT_VECTOR = fromBase64('ARAREhMUFRYXGBkaGwbc7GQguUmR8C5VYB2TKa2ypoXwX9c0Wv5C1Ns=')
const OBJECT_PATH = 'trips.json.enc'
const OBJECT_PLAINTEXT = '{"trips":[]}'

const PASSPHRASE = 'test wachtzin met é'
const RECOVERY_7F =
  'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title'

const FIXED_META: Meta = {
  format: 'logboek-meta',
  version: 1,
  passphrase: {
    kdf: 'PBKDF2-SHA256',
    iterations: 600_000,
    salt: 'AQIDBAUGBwgJCgsMDQ4PEA==',
    wrappedKey: 'ASAhIiMkJSYnKCkqK4JijGG8c9T80Mbq5XoUPpkJE2Z1gHjlS+8LRe2+VS1rwbh9BhB8ujLSjfV3J+AFng==',
  },
  recovery: {
    kdf: 'HKDF-SHA256',
    salt: 'MTIzNDU2Nzg5Ojs8PT4/QA==',
    wrappedKey: 'AUBBQkNERUZHSElKS7vlr46TGTl7TdLRSElaRVYhlrli0beOWUTdtMK615wzQ2dKqe9kOq1MagwoEoe6ag==',
  },
  recoveryCode: 'AVBRUlNUVVZXWFlaW+jPHPRgujDCPonijlApkyrq83fGFnleuXz6kQOG7+9VVsuyMi63iizo536qSrLUPg==',
}

async function decryptsObjectVector(key: CryptoKey): Promise<boolean> {
  const plain = await decryptObject(key, OBJECT_PATH, OBJECT_VECTOR)
  return decoder.decode(plain) === OBJECT_PLAINTEXT
}

describe('objectversleuteling', () => {
  it('ontsleutelt AES-GCM test case 14 (McGrew-Viega)', async () => {
    const key = await importKey(new Uint8Array(32))
    const blob = new Uint8Array([1, ...new Uint8Array(12), ...hex('cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919')])
    expect(await decryptObject(key, '', blob)).toEqual(new Uint8Array(16))
  })

  it('ontsleutelt de vaste vector met pad als AAD', async () => {
    expect(await decryptsObjectVector(await importKey(seq(0, 32)))).toBe(true)
  })

  it('weigert als één willekeurige byte is gewijzigd', async () => {
    const key = await importKey(seq(0, 32))
    for (let i = 0; i < OBJECT_VECTOR.length; i++) {
      const tampered = OBJECT_VECTOR.slice()
      tampered[i] = (tampered[i] ?? 0) ^ 0x01
      await expect(decryptObject(key, OBJECT_PATH, tampered)).rejects.toBeInstanceOf(DecryptError)
    }
  })

  it('weigert een object onder een ander pad (verkeerde AAD)', async () => {
    const key = await importKey(seq(0, 32))
    await expect(decryptObject(key, 'legs.json.enc', OBJECT_VECTOR)).rejects.toBeInstanceOf(DecryptError)
  })

  it('weigert een afgekapt object', async () => {
    const key = await importKey(seq(0, 32))
    await expect(decryptObject(key, OBJECT_PATH, OBJECT_VECTOR.slice(0, 28))).rejects.toBeInstanceOf(DecryptError)
  })

  it('versleutelt in het juiste formaat met steeds een nieuwe IV', async () => {
    const key = await importKey(seq(0, 32))
    const plaintext = utf8('nepdata')
    const a = await encryptObject(key, OBJECT_PATH, plaintext)
    const b = await encryptObject(key, OBJECT_PATH, plaintext)
    expect(a.length).toBe(1 + 12 + plaintext.length + 16)
    expect(a[0]).toBe(1)
    expect(a.slice(1, 13)).not.toEqual(b.slice(1, 13))
    expect(decoder.decode(await decryptObject(key, OBJECT_PATH, a))).toBe('nepdata')
  })
})

describe('herstelcode (BIP39)', () => {
  const vectors: [number, string][] = [
    [0x00, `${'abandon '.repeat(23)}art`],
    [0x7f, RECOVERY_7F],
    [
      0x80,
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless',
    ],
    [0xff, `${'zoo '.repeat(23)}vote`],
  ]

  it.each(vectors)('entropie %i geeft de officiële BIP39-woorden en terug', async (byte, words) => {
    const entropy = new Uint8Array(32).fill(byte)
    expect((await entropyToWords(entropy, wordlist)).join(' ')).toBe(words)
    expect(await wordsToEntropy(words.split(' '), wordlist)).toEqual(entropy)
  })

  it('weigert een verkeerd controlegetal, onbekend woord of verkeerd aantal', async () => {
    const words = RECOVERY_7F.split(' ')
    await expect(wordsToEntropy([...words.slice(0, 23), 'zoo'], wordlist)).rejects.toThrow('controleer de woorden')
    await expect(wordsToEntropy([...words.slice(0, 4), 'xyz', ...words.slice(5)], wordlist)).rejects.toThrow(
      'Woord 5 staat niet in de woordenlijst',
    )
    await expect(wordsToEntropy(words.slice(0, 12), wordlist)).rejects.toBeInstanceOf(RecoveryCodeError)
  })

  it('leest een woordenlijst met Windows-regeleinden', () => {
    expect(parseWordlist(wordlist.join('\r\n') + '\r\n')).toEqual(wordlist)
  })
})

describe('hoofdsleutel en meta.json.enc', () => {
  it('ontgrendelt de vaste meta met de wachtzin tot de bekende hoofdsleutel', async () => {
    expect(await decryptsObjectVector(await unlock(FIXED_META, { passphrase: PASSPHRASE }))).toBe(true)
  })

  it('accepteert dezelfde wachtzin in een andere Unicode-vorm (NFD)', async () => {
    const nfd = PASSPHRASE.normalize('NFD')
    expect(nfd).not.toBe(PASSPHRASE)
    expect(await decryptsObjectVector(await unlock(FIXED_META, { passphrase: nfd }))).toBe(true)
  })

  it('ontgrendelt de vaste meta met de herstelcode, ongeacht hoofdletters en spaties', async () => {
    const typed = `  ${RECOVERY_7F.toUpperCase().replace(/ /g, '   ')}\n`
    expect(await decryptsObjectVector(await unlock(FIXED_META, { recoveryCode: typed, wordlist }))).toBe(true)
  })

  it('weigert een verkeerde wachtzin', async () => {
    await expect(unlock(FIXED_META, { passphrase: 'verkeerde wachtzin' })).rejects.toBeInstanceOf(WrongSecretError)
  })

  // MK en herstelcode staan onder dezelfde wachtzin-KEK; alleen de AAD houdt ze uit elkaar.
  it('weigert verwisselde velden onder dezelfde KEK (AAD per veld)', async () => {
    const mkAsCode: Meta = { ...FIXED_META, recoveryCode: FIXED_META.passphrase.wrappedKey }
    const codeAsMk: Meta = {
      ...FIXED_META,
      passphrase: { ...FIXED_META.passphrase, wrappedKey: FIXED_META.recoveryCode },
    }
    await expect(unlock(codeAsMk, { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(WrongSecretError)
    await expect(revealRecoveryWords(mkAsCode, PASSPHRASE, wordlist)).rejects.toBeInstanceOf(InvalidMetaError)
  })

  it('toont de herstelcode alleen na de juiste wachtzin', async () => {
    expect((await revealRecoveryWords(FIXED_META, PASSPHRASE, wordlist)).join(' ')).toBe(RECOVERY_7F)
    await expect(revealRecoveryWords(FIXED_META, 'fout', wordlist)).rejects.toBeInstanceOf(WrongSecretError)
  })

  it('laat de herstelcode niet ontsleutelen met alleen de hoofdsleutel', async () => {
    const mk = await unlock(FIXED_META, { passphrase: PASSPHRASE })
    const code = fromBase64(FIXED_META.recoveryCode)
    await expect(decryptObject(mk, 'meta.json.enc#recoveryCode', code)).rejects.toBeInstanceOf(DecryptError)
  })

  it('meldt een beschadigde herstelcode in meta als ongeldige meta', async () => {
    const blob = fromBase64(FIXED_META.recoveryCode)
    blob[20] = (blob[20] ?? 0) ^ 0x01
    const damaged: Meta = { ...FIXED_META, recoveryCode: toBase64(blob) }
    await expect(revealRecoveryWords(damaged, PASSPHRASE, wordlist)).rejects.toBeInstanceOf(InvalidMetaError)
    await expect(changePassphrase(damaged, { passphrase: PASSPHRASE }, 'x')).rejects.toBeInstanceOf(InvalidMetaError)
  })

  it('maakt een nieuw logboek dat met wachtzin en herstelcode opent', async () => {
    const vault = await createVault('nieuwe testwachtzin', wordlist)
    expect(vault.masterKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', vault.masterKey)).rejects.toThrow()
    expect(vault.recoveryWords).toHaveLength(24)
    expect(vault.meta.passphrase.iterations).toBe(600_000)
    expect(fromBase64(vault.meta.passphrase.salt)).toHaveLength(16)
    expect(fromBase64(vault.meta.recovery.salt)).toHaveLength(16)

    const meta = parseMeta(serializeMeta(vault.meta))
    const blob = await encryptObject(vault.masterKey, OBJECT_PATH, utf8('nepdata'))
    for (const key of [
      await unlock(meta, { passphrase: 'nieuwe testwachtzin' }),
      await unlock(meta, { recoveryCode: vault.recoveryWords.join(' '), wordlist }),
    ]) {
      expect(key.extractable).toBe(false)
      expect(decoder.decode(await decryptObject(key, OBJECT_PATH, blob))).toBe('nepdata')
    }
    expect(await revealRecoveryWords(meta, 'nieuwe testwachtzin', wordlist)).toEqual(vault.recoveryWords)
  })

  // Een ontgrendeld apparaat neemt een gewijzigde meta van GitHub alleen over als ze aan de hoofdsleutel gebonden is.
  it('bindt de meta aan de hoofdsleutel en herkent een vervangen of vreemde meta', async () => {
    const vault = await createVault('nieuwe testwachtzin', wordlist)
    expect(vault.meta.check).toBeDefined()
    const meta = parseMeta(serializeMeta(vault.meta))
    expect(meta.check).toBe(vault.meta.check)
    expect(await verifyMetaCheck(meta, vault.masterKey)).toBe(true)

    const changed = await changePassphrase(meta, { passphrase: 'nieuwe testwachtzin' }, 'tweede wachtzin')
    expect(changed.check).not.toBe(meta.check)
    expect(await verifyMetaCheck(changed, vault.masterKey)).toBe(true)

    // Aanvaller met schrijfrechten: eigen meta (andere sleutel), of Oliviers meta met een vervangen wachtzinblok.
    const foreign = await createVault('aanvaller', wordlist)
    expect(await verifyMetaCheck(foreign.meta, vault.masterKey)).toBe(false)
    const spliced: Meta = { ...meta, passphrase: foreign.meta.passphrase }
    expect(await verifyMetaCheck(spliced, vault.masterKey)).toBe(false)
    expect(await verifyMetaCheck(FIXED_META, vault.masterKey)).toBe(false)
    expect(await verifyMetaCheck({ ...meta, check: undefined }, vault.masterKey)).toBe(false)
    expect(() => parseMeta(JSON.stringify({ ...meta, check: 'geen base64!' }))).toThrow(InvalidMetaError)
  })

  it('wijzigt de wachtzin zonder data opnieuw te versleutelen', async () => {
    const changed = await changePassphrase(FIXED_META, { passphrase: PASSPHRASE }, 'tweede wachtzin')
    expect(changed.recovery).toEqual(FIXED_META.recovery)
    expect(changed.passphrase.iterations).toBe(600_000)
    expect(fromBase64(changed.passphrase.salt)).toHaveLength(16)
    expect(changed.passphrase.salt).not.toBe(FIXED_META.passphrase.salt)
    expect(await decryptsObjectVector(await unlock(changed, { passphrase: 'tweede wachtzin' }))).toBe(true)
    expect((await revealRecoveryWords(changed, 'tweede wachtzin', wordlist)).join(' ')).toBe(RECOVERY_7F)
    await expect(unlock(changed, { passphrase: PASSPHRASE })).rejects.toBeInstanceOf(WrongSecretError)

    const reset = await changePassphrase(changed, { recoveryCode: RECOVERY_7F, wordlist }, 'derde wachtzin')
    expect(await decryptsObjectVector(await unlock(reset, { passphrase: 'derde wachtzin' }))).toBe(true)
    expect((await revealRecoveryWords(reset, 'derde wachtzin', wordlist)).join(' ')).toBe(RECOVERY_7F)
    expect(await decryptsObjectVector(await unlock(reset, { recoveryCode: RECOVERY_7F, wordlist }))).toBe(true)
  })

  it('weigert ongeldige meta', () => {
    const json = serializeMeta(FIXED_META)
    expect(parseMeta(json)).toEqual(FIXED_META)
    const variants: unknown[] = [
      null,
      [],
      { ...FIXED_META, version: 2 },
      { ...FIXED_META, format: 'iets' },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, iterations: 599_999 } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, iterations: 600_000.5 } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, iterations: 1e12 } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, salt: 'geen base64!' } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, salt: 'AAAAA' } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, salt: toBase64(seq(0, 15)) } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, salt: `${FIXED_META.passphrase.salt}\n` } },
      { ...FIXED_META, passphrase: { ...FIXED_META.passphrase, wrappedKey: 'AQID' } },
      { ...FIXED_META, recovery: { ...FIXED_META.recovery, kdf: 'PBKDF2-SHA256' } },
      { ...FIXED_META, recovery: undefined },
      { ...FIXED_META, recoveryCode: 42 },
    ]
    expect(() => parseMeta('{niet json')).toThrow(InvalidMetaError)
    for (const variant of variants) expect(() => parseMeta(JSON.stringify(variant))).toThrow(InvalidMetaError)
  })
})
