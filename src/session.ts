import { createContext, useContext } from 'react'
import { fromBase64, randomBytes, toBase64 } from './crypto/encrypt'
import {
  META_PATH,
  changePassphrase,
  createVault,
  parseMeta,
  revealRecoveryWords,
  rewrapMasterKey,
  serializeMeta,
  unlock,
  unwrapMasterKey,
  verifyMetaCheck,
  type Meta,
  type Secret,
} from './crypto/keys'
import { loadWordlist } from './crypto/recovery'
import { deriveKekFromPrf, evaluateFingerprint, fingerprintAvailable, registerFingerprint } from './crypto/webauthn'
import { deleteFingerprint, FINGERPRINT_AAD, loadFingerprint, saveFingerprint } from './storage/fingerprint'
import { recordError } from './errors'
import { t, type MessageKey } from './i18n'
import { ConflictError, GithubClient, GithubError } from './storage/github'
import { clearAll, deleteSessionKey, getObject, getSessionKey, openLogboekDb, putSessionKey, type Db } from './storage/idb'
import { Store } from './storage/store'
import { loadToken, storeToken, type StoredToken } from './storage/token'

// Levenscyclus van een sessie: eerste keer (nieuw of koppelen), ontgrendelen, vergrendelen.
// Beveiligingsregel 10: vergrendelen na 5 minuten zonder gebruik. Binnen die 5 minuten staat de niet-exporteerbare
// hoofdsleutel (CryptoKey) met het tijdstip van laatste gebruik in IndexedDB, zodat verversen of wisselen van app
// niet vergrendelt. Bij openen: jonger dan 5 minuten → gebruiken, anders direct wissen. Vergrendelen wist geheugen
// en de opgeslagen sleutel.

export const LOCK_AFTER_MS = 5 * 60 * 1000
/** Laatste gebruik hoogstens zo vaak naar IndexedDB schrijven; bij verbergen altijd direct. */
const ACTIVITY_WRITE_MS = 15 * 1000
export const MIN_PASSPHRASE_LENGTH = 12

export type SessionState =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'locked'; meta: Meta; fingerprint: boolean }
  | { phase: 'unlocked'; store: Store }

/** Fout bij eerste keer of ontgrendelen; `key` is de vertaalsleutel van de melding. */
export class SetupError extends Error {
  constructor(readonly key: MessageKey) {
    super(key)
    this.name = 'SetupError'
  }
}

export interface PreparedVault {
  meta: Meta
  masterKey: CryptoKey
  recoveryWords: string[]
}

export class Session {
  private db: Db | null = null
  private state: SessionState = { phase: 'loading' }
  private readonly listeners = new Set<() => void>()
  private lockTimer: ReturnType<typeof setTimeout> | null = null

  getState(): SessionState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Andere tabbladen van de app: vergrendelen in één tabblad vergrendelt ze allemaal. Blijft in de browser. */
  private readonly channel: BroadcastChannel | null
  /** Monotone klok voor een draaiende pagina; verzetten van de systeemklok verlengt de 5 minuten daar niet. */
  private readonly monotonic: () => number

  /** `dbName` en `clock` alleen voor tests; de app gebruikt de standaardnaam en de systeemklok. */
  private readonly clock: () => number

  constructor(
    private readonly dbName?: string,
    clock?: () => number,
  ) {
    // Met een testklok zijn systeemklok en monotone klok dezelfde.
    this.clock = clock ?? (() => Date.now())
    this.monotonic = clock ?? (() => performance.now())
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`logboek-session:${dbName ?? 'logboek'}`)
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        if (event.data === 'lock') this.lock(false)
      }
      // Node (tests): het kanaal mag het proces niet openhouden.
      ;(this.channel as unknown as { unref?: () => void }).unref?.()
    }
  }

  async init(): Promise<void> {
    this.db = await openLogboekDb(this.dbName)
    if (await this.resume()) return
    await this.toLocked()
  }

  /** Verder met de opgeslagen hoofdsleutel als die jonger is dan 5 minuten; anders wissen. */
  private async resume(): Promise<boolean> {
    const db = this.requireDb()
    let record: Awaited<ReturnType<typeof getSessionKey>>
    try {
      record = await getSessionKey(db)
    } catch {
      return false
    }
    if (!record) return false
    const age = this.clock() - record.lastUsed
    // Ook een klok die achteruit staat (negatieve leeftijd) telt als verlopen. Een sleutel die niet jonger is dan het
    // laatste vergrendelen telt ook niet: het wissen in IndexedDB is asynchroon en kan bij direct sluiten wegvallen.
    const lockedAt = readLockedAt(this.dbName)
    if (
      !(record.key instanceof CryptoKey) ||
      record.key.extractable ||
      age < 0 ||
      age >= LOCK_AFTER_MS ||
      (lockedAt !== null && record.lastUsed <= lockedAt)
    ) {
      await deleteSessionKey(db).catch(() => undefined)
      return false
    }
    try {
      await this.openWithStoredToken(record.key, record.lastUsed)
      return true
    } catch {
      await deleteSessionKey(db).catch(() => undefined)
      return false
    }
  }

  private async toLocked(): Promise<void> {
    const db = this.requireDb()
    const meta = await Store.loadMeta(db).catch(() => null)
    if (!meta) {
      this.lastMeta = null
      this.setState({ phase: 'setup' })
      return
    }
    const fingerprint = (await loadFingerprint(db)) !== null
    this.lastMeta = meta
    this.lastFingerprint = fingerprint
    this.setState({ phase: 'locked', meta, fingerprint })
  }

  /** Laatst bekende meta en vingerafdrukvlag, zodat lock() direct en synchroon naar 'locked' kan. */
  private lastMeta: Meta | null = null
  private lastFingerprint = false
  /** Telt op bij elke lock() en open(); lopende bewerkingen controleren hiermee dat de sessie nog dezelfde is. */
  private generation = 0

  private assertSameSession(generation: number): void {
    if (generation !== this.generation) throw new Error('Vergrendeld')
  }

  /**
   * Haalt meta.json.enc op en neemt een nieuwere versie (wachtzin gewijzigd op een ander apparaat) lokaal over,
   * maar alleen als de meta aan deze hoofdsleutel gebonden is. Zo kan iemand met alleen schrijfrechten op
   * logboek-data de wachtzin niet op afstand ongeldig maken.
   */
  private async refreshMeta(client: GithubClient, db: Db, masterKey: CryptoKey, generation: number): Promise<void> {
    try {
      const stored = await getObject(db, META_PATH)
      const remote = await client.getFile(META_PATH)
      if (!remote || remote.sha === stored?.sha || generation !== this.generation) return
      const meta = parseMeta(new TextDecoder().decode(remote.content))
      if (!(await verifyMetaCheck(meta, masterKey))) return
      if (generation !== this.generation) return
      await Store.storeMeta(db, meta, remote.sha)
      this.lastMeta = meta
    } catch {
      // Geen verbinding of ongeldige meta: de lokale meta blijft gelden.
    }
  }

  /** Alleen zinvol als de huidige wachtzin klopt; de nieuwe meta gaat naar GitHub en naar IndexedDB. */
  async changePassphrase(current: string, next: string): Promise<void> {
    const db = this.requireDb()
    const { client } = this.requireUnlocked()
    const generation = this.generation
    for (let attempt = 0; attempt < 2; attempt++) {
      const stored = await getObject(db, META_PATH)
      const meta = await Store.loadMeta(db)
      if (!meta) throw new SetupError('error.metaMissing')
      const changed = await changePassphrase(meta, { passphrase: current }, next)
      this.assertSameSession(generation)
      try {
        const sha = await client.putFile(META_PATH, new TextEncoder().encode(serializeMeta(changed)), stored?.sha ?? null)
        this.assertSameSession(generation)
        await Store.storeMeta(db, changed, sha)
        this.lastMeta = changed
        // De vingerafdruk-verpakking blijft geldig: de hoofdsleutel is niet veranderd.
        return
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 1) throw error
        const remote = await client.getFile(META_PATH)
        if (!remote) throw error
        await Store.storeMeta(db, parseMeta(new TextDecoder().decode(remote.content)), remote.sha)
      }
    }
  }

  async revealRecovery(passphrase: string): Promise<string[]> {
    const meta = await Store.loadMeta(this.requireDb())
    if (!meta) throw new SetupError('error.metaMissing')
    return revealRecoveryWords(meta, passphrase, await loadWordlist())
  }

  /** Vervaldatum (jjjj-mm-dd) van de token op dit apparaat, of null als onbekend. Alleen zinvol na ontgrendelen. */
  tokenExpiresAt: string | null = null

  /**
   * Controleert een nieuwe token (toegang tot logboek-data) en geeft de vervaldatum uit de header
   * `github-authentication-token-expiration` als de browser die mag lezen; anders null.
   */
  async checkToken(token: string): Promise<{ expiresAt: string | null }> {
    return new GithubClient(token.trim()).checkAccess()
  }

  /** Lopende vervanging; een tweede aanroep krijgt dezelfde promise, zodat er nooit twee Stores ontstaan. */
  private replacing: Promise<void> | null = null

  replaceToken(token: string, expiresAt: string | null): Promise<void> {
    if (this.replacing) return this.replacing
    this.replacing = this.doReplaceToken(token, expiresAt).finally(() => {
      this.replacing = null
    })
    return this.replacing
  }

  /** `expiresAt` komt uit het formulier en is leidend, ook als het leeg is; de header is alleen voorvulling. */
  private async doReplaceToken(token: string, expiresAt: string | null): Promise<void> {
    const db = this.requireDb()
    const { masterKey, store: previous } = this.requireUnlocked()
    const generation = this.generation
    const client = new GithubClient(token.trim())
    await client.checkAccess()
    this.assertSameSession(generation)
    await storeToken(db, masterKey, token.trim(), expiresAt)
    this.tokenExpiresAt = expiresAt
    this.assertSameSession(generation)
    // De Store houdt de oude client; een nieuwe Store openen zorgt dat sync de nieuwe token gebruikt.
    const store = await Store.open(db, masterKey, client)
    if (generation !== this.generation) {
      store.lock()
      throw new Error('Vergrendeld')
    }
    this.unlockedClient = client
    this.setState({ phase: 'unlocked', store })
    previous.lock()
    this.touch()
    void store.sync()
  }

  fingerprintPossible(): Promise<boolean> {
    return fingerprintAvailable()
  }

  async enableFingerprint(passphrase: string): Promise<void> {
    const db = this.requireDb()
    const meta = await Store.loadMeta(db)
    if (!meta) throw new SetupError('error.metaMissing')
    // Eerst de wachtzin controleren, dan pas om de vingerafdruk vragen.
    await unlock(meta, { passphrase })
    const registration = await registerFingerprint()
    const hkdfSalt = randomBytes(16)
    let kek: CryptoKey
    try {
      kek = await deriveKekFromPrf(registration.prfOutput, hkdfSalt)
    } finally {
      registration.prfOutput.fill(0)
    }
    const wrappedKey = await rewrapMasterKey(meta, passphrase, kek, FINGERPRINT_AAD)
    await saveFingerprint(db, {
      credentialId: toBase64(registration.credentialId),
      prfSalt: toBase64(registration.prfSalt),
      hkdfSalt: toBase64(hkdfSalt),
      wrappedKey,
    })
    this.lastFingerprint = true
  }

  async disableFingerprint(): Promise<void> {
    await deleteFingerprint(this.requireDb())
    this.lastFingerprint = false
    if (this.state.phase === 'locked') this.setState({ ...this.state, fingerprint: false })
  }

  async hasFingerprint(): Promise<boolean> {
    return (await loadFingerprint(this.requireDb())) !== null
  }

  async unlockWithFingerprint(signal?: AbortSignal): Promise<void> {
    const db = this.requireDb()
    const record = await loadFingerprint(db)
    if (!record) throw new SetupError('error.fingerprintNotSet')
    const prf = await evaluateFingerprint(fromBase64(record.credentialId), fromBase64(record.prfSalt), signal)
    let kek: CryptoKey
    try {
      kek = await deriveKekFromPrf(prf, fromBase64(record.hkdfSalt))
    } finally {
      prf.fill(0)
    }
    const masterKey = await unwrapMasterKey(record.wrappedKey, kek, FINGERPRINT_AAD)
    await this.openWithStoredToken(masterKey)
  }

  /**
   * Nieuw logboek, stap 1: token controleren en nagaan dat logboek-data geen logboek bevat.
   * Een repo zonder commits (404/409) of met alleen een README is leeg genoeg.
   */
  async checkEmptyRepo(token: string): Promise<{ expiresAt: string | null }> {
    const client = new GithubClient(token.trim())
    const access = await client.checkAccess()
    if ((await client.getFile(META_PATH)) !== null) {
      throw new SetupError('error.repoHasLogbook')
    }
    return access
  }

  /** Nieuw logboek, stap 2: sleutels maken. Nog niets opgeslagen; eerst de herstelcode bevestigen. */
  async prepareVault(passphrase: string): Promise<PreparedVault> {
    return createVault(passphrase, await loadWordlist())
  }

  /** Nieuw logboek, stap 3: meta.json.enc aanmaken, token opslaan, ontgrendeld verder. */
  async finishNewVault(token: string, expiresAt: string | null, vault: PreparedVault): Promise<void> {
    const db = this.requireDb()
    const client = new GithubClient(token.trim())
    const bytes = new TextEncoder().encode(JSON.stringify(vault.meta))
    const sha = await client.putFile(META_PATH, bytes, null)
    await clearAll(db)
    await Store.storeMeta(db, vault.meta, sha)
    await this.open(client, { token: token.trim(), expiresAt }, vault.masterKey)
  }

  /** Bestaand logboek koppelen: meta ophalen, ontgrendelen met wachtzin of herstelcode, alles ophalen. */
  async link(
    token: string,
    expiresAt: string | null,
    secret: { passphrase: string } | { recoveryCode: string },
  ): Promise<void> {
    const db = this.requireDb()
    const client = new GithubClient(token.trim())
    const file = await client.getFile(META_PATH)
    if (!file) throw new SetupError('error.repoEmpty')
    const meta = parseMeta(new TextDecoder().decode(file.content))
    const masterKey = await unlock(meta, await withWordlist(secret))
    await clearAll(db)
    await Store.storeMeta(db, meta, file.sha)
    await this.open(client, { token: token.trim(), expiresAt }, masterKey)
  }

  /** Ontgrendelen op een apparaat dat al gekoppeld is. */
  async unlockLocal(secret: { passphrase: string } | { recoveryCode: string }): Promise<void> {
    if (this.state.phase !== 'locked') throw new Error('Niet vergrendeld')
    const masterKey = await unlock(this.state.meta, await withWordlist(secret))
    await this.openWithStoredToken(masterKey)
  }

  /** `resumedLastUsed`: hervat met de opgeslagen sleutel; openen telt dan niet als gebruik. */
  private async openWithStoredToken(masterKey: CryptoKey, resumedLastUsed?: number): Promise<void> {
    const db = this.requireDb()
    const stored = await loadToken(db, masterKey)
    if (stored === null) {
      // Kan alleen na een onvolledige koppeling; opnieuw koppelen is de veilige weg.
      await clearAll(db)
      this.setState({ phase: 'setup' })
      throw new SetupError('error.tokenMissing')
    }
    this.tokenExpiresAt = stored.expiresAt
    await this.open(new GithubClient(stored.token), null, masterKey, resumedLastUsed)
  }

  /** `broadcast`: ook de andere tabbladen vergrendelen (niet als dit tabblad zelf door een ander werd vergrendeld). */
  lock(broadcast = true): void {
    this.clearLockTimer()
    // Altijd de opgeslagen sleutel wissen, ook als het geheugen al leeg is. Het tijdstip gaat eerst synchroon naar
    // localStorage, zodat een sleutel waarvan het wissen nog niet klaar was, toch nooit meer gebruikt wordt.
    writeLockedAt(this.dbName, this.clock())
    if (this.db) void deleteSessionKey(this.db).catch(() => undefined)
    if (broadcast) this.channel?.postMessage('lock')
    if (this.state.phase !== 'unlocked') return
    const store = this.state.store
    this.generation++
    this.unlockedClient = null
    this.unlockedKey = null
    this.tokenExpiresAt = null
    // Eerst synchroon weg van het ontgrendelde scherm, dan pas het geheugen wissen: geen render met een gewiste Store.
    if (this.lastMeta) this.setState({ phase: 'locked', meta: this.lastMeta, fingerprint: this.lastFingerprint })
    else this.setState({ phase: 'loading' })
    store.lock()
    void this.toLocked().catch(() => this.setState({ phase: 'setup' }))
  }

  private unlockedClient: GithubClient | null = null
  private unlockedKey: CryptoKey | null = null

  private requireUnlocked(): { client: GithubClient; masterKey: CryptoKey; store: Store } {
    if (this.state.phase !== 'unlocked' || !this.unlockedClient || !this.unlockedKey) throw new Error('Vergrendeld')
    return { client: this.unlockedClient, masterKey: this.unlockedKey, store: this.state.store }
  }

  /** Laatste gebruik (systeemklok, voor IndexedDB) en wanneer dat het laatst naar IndexedDB ging. */
  private lastUsed = 0
  private lastWritten = 0
  /** Moment (monotone klok) waarop vergrendeld moet worden. */
  private deadline = 0

  /** Gebruik = tikken, typen of scrollen in de app. Reset de vergrendeltimer. */
  touch(): void {
    if (this.state.phase !== 'unlocked') return
    // Een timer die op de achtergrond niet liep: eerst controleren of de 5 minuten al om zijn.
    if (this.checkExpiry()) return
    this.lastUsed = this.clock()
    this.scheduleLock(LOCK_AFTER_MS)
    if (this.lastUsed - this.lastWritten >= ACTIVITY_WRITE_MS) this.saveActivity()
  }

  private scheduleLock(remaining: number): void {
    this.deadline = this.monotonic() + remaining
    this.clearLockTimer()
    this.lockTimer = setTimeout(() => this.lock(), remaining)
  }

  /** Vergrendelt als het laatste gebruik 5 minuten of langer geleden is. Geeft true als er vergrendeld werd. */
  checkExpiry(): boolean {
    if (this.state.phase !== 'unlocked') return false
    const age = this.clock() - this.lastUsed
    if (age >= LOCK_AFTER_MS || age < 0 || this.monotonic() >= this.deadline) {
      this.lock()
      return true
    }
    return false
  }

  /** Bij verbergen van de app: laatste gebruik direct opslaan, zodat terugkomen binnen 5 minuten niet vergrendelt. */
  flushActivity(): void {
    if (this.state.phase !== 'unlocked') return
    if (this.checkExpiry()) return
    this.saveActivity()
  }

  private saveActivity(): void {
    const db = this.db
    const key = this.unlockedKey
    if (!db || !key) return
    const generation = this.generation
    const lastUsed = this.lastUsed
    this.lastWritten = lastUsed
    void (async () => {
      // Na vergrendelen niets meer terugschrijven.
      if (generation !== this.generation) return
      await putSessionKey(db, { name: 'masterKey', key, lastUsed })
      if (generation !== this.generation) await deleteSessionKey(db)
    })().catch(() => undefined)
  }

  private async open(
    client: GithubClient,
    tokenToStore: StoredToken | null,
    masterKey: CryptoKey,
    resumedLastUsed?: number,
  ): Promise<void> {
    const db = this.requireDb()
    if (tokenToStore !== null) {
      await storeToken(db, masterKey, tokenToStore.token, tokenToStore.expiresAt)
      this.tokenExpiresAt = tokenToStore.expiresAt
    }
    // Blijvende opslag aanvragen, zodat de browser de versleutelde kopie en de outbox niet opruimt.
    void requestPersistentStorage()
    const store = await Store.open(db, masterKey, client)
    this.generation++
    this.unlockedClient = client
    this.unlockedKey = masterKey
    if (!this.lastMeta) this.lastMeta = await Store.loadMeta(db).catch(() => null)
    this.lastFingerprint = (await loadFingerprint(db)) !== null
    this.setState({ phase: 'unlocked', store })
    if (resumedLastUsed === undefined) {
      this.lastUsed = this.clock()
      this.lastWritten = 0
      this.scheduleLock(LOCK_AFTER_MS)
      this.saveActivity()
    } else {
      // Hervat: alleen de resterende tijd, en niets opnieuw opslaan tot er echt gebruik is.
      this.lastUsed = resumedLastUsed
      this.lastWritten = resumedLastUsed
      this.scheduleLock(Math.max(0, LOCK_AFTER_MS - (this.clock() - resumedLastUsed)))
    }
    void store.sync()
    void this.refreshMeta(client, db, masterKey, this.generation)
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('Opslag niet geopend')
    return this.db
  }

  private clearLockTimer(): void {
    if (this.lockTimer !== null) clearTimeout(this.lockTimer)
    this.lockTimer = null
  }

  private setState(state: SessionState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

/** Tijdstip van het laatste vergrendelen (geen geheim). localStorage is synchroon en blijft staan na sluiten. */
function lockedAtKey(dbName: string | undefined): string {
  return `logboek-vergrendeld:${dbName ?? 'logboek'}`
}

function readLockedAt(dbName: string | undefined): number | null {
  try {
    const value = Number(globalThis.localStorage?.getItem(lockedAtKey(dbName)))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeLockedAt(dbName: string | undefined, at: number): void {
  try {
    globalThis.localStorage?.setItem(lockedAtKey(dbName), String(at))
  } catch {
    // Geen localStorage: het wissen in IndexedDB blijft de gewone weg.
  }
}

async function withWordlist(secret: { passphrase: string } | { recoveryCode: string }): Promise<Secret> {
  if ('passphrase' in secret) return secret
  return { recoveryCode: secret.recoveryCode, wordlist: await loadWordlist() }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) await navigator.storage.persist()
  } catch {
    // Niet beschikbaar of geweigerd: de app werkt gewoon, alleen zonder garantie tegen opruimen.
  }
}

/** Aantal dagen tot de vervaldatum (jjjj-mm-dd), negatief als al verlopen; null als onbekend. */
export function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  const now = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  return Math.round((ms - now) / 86_400_000)
}

/** Nederlandse melding voor fouten uit opslag en sleutels; nooit inhoud of sleutels. Legt de fout vast voor de foutdetails. */
export function describeError(error: unknown): string {
  recordError(error)
  if (error instanceof SetupError) return t(error.key)
  // Bij invoeren of vervangen is een 401/403 een token die nooit werkte: eigen melding, niet "verlopen".
  if (error instanceof GithubError) return t(`github.${error.code}`)
  if (error instanceof Error) {
    switch (error.name) {
      case 'NewerSchemaError':
        return t('sync.updateApp')
      case 'NetworkError':
        return t('sync.offline')
      case 'WrongSecretError':
        return t('error.wrongSecret')
      case 'RecoveryCodeError':
        return describeRecoveryError(error.message)
      case 'InvalidMetaError':
        return t('error.invalidMeta')
      case 'DecryptError':
        return t('error.decrypt')
      case 'WebAuthnError':
        return describeWebAuthnError(error.message)
    }
  }
  return t('error.generic')
}

// De crypto-modules (onafhankelijk gereviewd) houden hun Nederlandse meldingen; hier volgt de vertaling.
function describeRecoveryError(message: string): string {
  const word = /^Woord (\d+)/.exec(message)
  if (word) return t('error.recoveryWord', { n: Number(word[1]) })
  if (message.startsWith('Herstelcode moet')) return t('error.recoveryCount')
  return t('error.recoveryWrong')
}

function describeWebAuthnError(message: string): string {
  if (message.includes('afgebroken')) return t('error.fingerprintCancelled')
  if (message.includes('ondersteunt geen')) return t('error.fingerprintNoPrf')
  if (message.includes('geen sleutel')) return t('error.fingerprintNoKey')
  return t('error.fingerprintFailed')
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('SessionContext ontbreekt')
  return session
}
