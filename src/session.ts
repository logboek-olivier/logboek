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
import { UPDATE_APP_MESSAGE } from './model/schema'
import { ConflictError, GithubClient, GithubError } from './storage/github'
import { clearAll, getObject, openLogboekDb, type Db } from './storage/idb'
import { Store } from './storage/store'
import { loadToken, storeToken, type StoredToken } from './storage/token'

// Levenscyclus van een sessie: eerste keer (nieuw of koppelen), ontgrendelen, vergrendelen.
// De hoofdsleutel leeft alleen in de Store; vergrendelen laat die vallen (beveiligingsregel 10).

export const LOCK_AFTER_MS = 5 * 60 * 1000
export const MIN_PASSPHRASE_LENGTH = 12

export type SessionState =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'locked'; meta: Meta; fingerprint: boolean }
  | { phase: 'unlocked'; store: Store }

export class SetupError extends Error {
  constructor(message: string) {
    super(message)
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

  /** `dbName` alleen voor tests; de app gebruikt de standaardnaam. */
  constructor(private readonly dbName?: string) {}

  async init(): Promise<void> {
    this.db = await openLogboekDb(this.dbName)
    await this.toLocked()
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
      if (!meta) throw new SetupError('meta.json.enc ontbreekt op dit apparaat')
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
    if (!meta) throw new SetupError('meta.json.enc ontbreekt op dit apparaat')
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
    if (!meta) throw new SetupError('meta.json.enc ontbreekt op dit apparaat')
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
    if (!record) throw new SetupError('Vingerafdruk is niet ingesteld op dit apparaat')
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
      throw new SetupError('Deze repo bevat al een logboek. Kies "Bestaand logboek koppelen".')
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
    if (!file) throw new SetupError('Geen logboek gevonden in logboek-data. Kies "Nieuw logboek".')
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

  private async openWithStoredToken(masterKey: CryptoKey): Promise<void> {
    const db = this.requireDb()
    const stored = await loadToken(db, masterKey)
    if (stored === null) {
      // Kan alleen na een onvolledige koppeling; opnieuw koppelen is de veilige weg.
      await clearAll(db)
      this.setState({ phase: 'setup' })
      throw new SetupError('Token ontbreekt op dit apparaat. Koppel het logboek opnieuw.')
    }
    this.tokenExpiresAt = stored.expiresAt
    await this.open(new GithubClient(stored.token), null, masterKey)
  }

  lock(): void {
    this.clearLockTimer()
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

  /** Reset de vergrendeltimer; aanroepen bij elke interactie. */
  touch(): void {
    if (this.state.phase !== 'unlocked') return
    this.clearLockTimer()
    this.lockTimer = setTimeout(() => this.lock(), LOCK_AFTER_MS)
  }

  private async open(client: GithubClient, tokenToStore: StoredToken | null, masterKey: CryptoKey): Promise<void> {
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
    this.touch()
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

/** Nederlandse melding voor fouten uit opslag en sleutels; nooit inhoud of sleutels. */
export function describeError(error: unknown): string {
  if (error instanceof SetupError) return error.message
  // Bij invoeren of vervangen is een 401/403 een token die nooit werkte: eigen melding, niet "verlopen".
  if (error instanceof GithubError) return error.message
  if (error instanceof Error) {
    switch (error.name) {
      case 'NewerSchemaError':
        return UPDATE_APP_MESSAGE
      case 'NetworkError':
        return 'Geen verbinding'
      case 'WrongSecretError':
        return 'Wachtzin of herstelcode klopt niet'
      case 'RecoveryCodeError':
        return error.message
      case 'InvalidMetaError':
        return 'meta.json.enc is ongeldig'
      case 'DecryptError':
        return 'Ontsleutelen mislukt'
      case 'WebAuthnError':
        return error.message
    }
  }
  return 'Er ging iets mis'
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('SessionContext ontbreekt')
  return session
}
