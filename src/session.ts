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
  type Meta,
  type Secret,
} from './crypto/keys'
import { loadWordlist } from './crypto/recovery'
import { deriveKekFromPrf, evaluateFingerprint, fingerprintAvailable, registerFingerprint } from './crypto/webauthn'
import { deleteFingerprint, FINGERPRINT_AAD, loadFingerprint, saveFingerprint } from './storage/fingerprint'
import { ConflictError, GithubClient, GithubError } from './storage/github'
import { clearAll, getObject, openLogboekDb, type Db } from './storage/idb'
import { Store } from './storage/store'
import { loadToken, storeToken } from './storage/token'

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

  async init(): Promise<void> {
    this.db = await openLogboekDb()
    await this.toLocked()
  }

  private async toLocked(): Promise<void> {
    const db = this.requireDb()
    const meta = await Store.loadMeta(db).catch(() => null)
    if (!meta) {
      this.setState({ phase: 'setup' })
      return
    }
    const fingerprint = (await loadFingerprint(db)) !== null
    this.setState({ phase: 'locked', meta, fingerprint })
  }

  /** Alleen zinvol als de huidige wachtzin klopt; de nieuwe meta gaat naar GitHub en naar IndexedDB. */
  async changePassphrase(current: string, next: string): Promise<void> {
    const db = this.requireDb()
    const { client, masterKey } = this.requireUnlocked()
    for (let attempt = 0; attempt < 2; attempt++) {
      const stored = await getObject(db, META_PATH)
      const meta = await Store.loadMeta(db)
      if (!meta) throw new SetupError('meta.json.enc ontbreekt op dit apparaat')
      const changed = await changePassphrase(meta, { passphrase: current }, next)
      try {
        const sha = await client.putFile(META_PATH, new TextEncoder().encode(serializeMeta(changed)), stored?.sha ?? null)
        await Store.storeMeta(db, changed, sha)
        // De vingerafdruk-verpakking blijft geldig: de hoofdsleutel is niet veranderd.
        void masterKey
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

  async replaceToken(token: string): Promise<void> {
    const db = this.requireDb()
    const { masterKey } = this.requireUnlocked()
    const client = new GithubClient(token.trim())
    await client.checkAccess()
    await storeToken(db, masterKey, token.trim())
    this.unlockedClient = client
    // De Store houdt de oude client; herladen zorgt dat sync de nieuwe token gebruikt.
    const store = await Store.open(db, masterKey, client)
    this.setState({ phase: 'unlocked', store })
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
    const kek = await deriveKekFromPrf(registration.prfOutput, hkdfSalt)
    registration.prfOutput.fill(0)
    const wrappedKey = await rewrapMasterKey(meta, passphrase, kek, FINGERPRINT_AAD)
    await saveFingerprint(db, {
      credentialId: toBase64(registration.credentialId),
      prfSalt: toBase64(registration.prfSalt),
      hkdfSalt: toBase64(hkdfSalt),
      wrappedKey,
    })
  }

  async disableFingerprint(): Promise<void> {
    await deleteFingerprint(this.requireDb())
  }

  async hasFingerprint(): Promise<boolean> {
    return (await loadFingerprint(this.requireDb())) !== null
  }

  async unlockWithFingerprint(): Promise<void> {
    const db = this.requireDb()
    const record = await loadFingerprint(db)
    if (!record) throw new SetupError('Vingerafdruk is niet ingesteld op dit apparaat')
    const prf = await evaluateFingerprint(fromBase64(record.credentialId), fromBase64(record.prfSalt))
    const kek = await deriveKekFromPrf(prf, fromBase64(record.hkdfSalt))
    prf.fill(0)
    const masterKey = await unwrapMasterKey(record.wrappedKey, kek, FINGERPRINT_AAD)
    await this.openWithStoredToken(masterKey)
  }

  /** Nieuw logboek, stap 1: token controleren en nagaan dat logboek-data leeg is. */
  async checkEmptyRepo(token: string): Promise<void> {
    const client = new GithubClient(token.trim())
    await client.checkAccess()
    if ((await client.getFile(META_PATH)) !== null) {
      throw new SetupError('Deze repo bevat al een logboek. Kies "Bestaand logboek koppelen".')
    }
  }

  /** Nieuw logboek, stap 2: sleutels maken. Nog niets opgeslagen; eerst de herstelcode bevestigen. */
  async prepareVault(passphrase: string): Promise<PreparedVault> {
    return createVault(passphrase, await loadWordlist())
  }

  /** Nieuw logboek, stap 3: meta.json.enc aanmaken, token opslaan, ontgrendeld verder. */
  async finishNewVault(token: string, vault: PreparedVault): Promise<void> {
    const db = this.requireDb()
    const client = new GithubClient(token.trim())
    const bytes = new TextEncoder().encode(JSON.stringify(vault.meta))
    const sha = await client.putFile(META_PATH, bytes, null)
    await clearAll(db)
    await Store.storeMeta(db, vault.meta, sha)
    await this.open(client, token.trim(), vault.masterKey)
  }

  /** Bestaand logboek koppelen: meta ophalen, ontgrendelen met wachtzin of herstelcode, alles ophalen. */
  async link(token: string, secret: { passphrase: string } | { recoveryCode: string }): Promise<void> {
    const db = this.requireDb()
    const client = new GithubClient(token.trim())
    const file = await client.getFile(META_PATH)
    if (!file) throw new SetupError('Geen logboek gevonden in logboek-data. Kies "Nieuw logboek".')
    const meta = parseMeta(new TextDecoder().decode(file.content))
    const masterKey = await unlock(meta, await withWordlist(secret))
    await clearAll(db)
    await Store.storeMeta(db, meta, file.sha)
    await this.open(client, token.trim(), masterKey)
  }

  /** Ontgrendelen op een apparaat dat al gekoppeld is. */
  async unlockLocal(secret: { passphrase: string } | { recoveryCode: string }): Promise<void> {
    if (this.state.phase !== 'locked') throw new Error('Niet vergrendeld')
    const masterKey = await unlock(this.state.meta, await withWordlist(secret))
    await this.openWithStoredToken(masterKey)
  }

  private async openWithStoredToken(masterKey: CryptoKey): Promise<void> {
    const db = this.requireDb()
    const token = await loadToken(db, masterKey)
    if (token === null) {
      // Kan alleen na een onvolledige koppeling; opnieuw koppelen is de veilige weg.
      await clearAll(db)
      this.setState({ phase: 'setup' })
      throw new SetupError('Token ontbreekt op dit apparaat. Koppel het logboek opnieuw.')
    }
    await this.open(new GithubClient(token), null, masterKey)
  }

  lock(): void {
    this.clearLockTimer()
    if (this.state.phase === 'unlocked') {
      this.state.store.lock()
      this.unlockedClient = null
      this.unlockedKey = null
      void this.toLocked().catch(() => this.setState({ phase: 'setup' }))
    }
  }

  private unlockedClient: GithubClient | null = null
  private unlockedKey: CryptoKey | null = null

  private requireUnlocked(): { client: GithubClient; masterKey: CryptoKey } {
    if (this.state.phase !== 'unlocked' || !this.unlockedClient || !this.unlockedKey) throw new Error('Vergrendeld')
    return { client: this.unlockedClient, masterKey: this.unlockedKey }
  }

  /** Reset de vergrendeltimer; aanroepen bij elke interactie. */
  touch(): void {
    if (this.state.phase !== 'unlocked') return
    this.clearLockTimer()
    this.lockTimer = setTimeout(() => this.lock(), LOCK_AFTER_MS)
  }

  private async open(client: GithubClient, tokenToStore: string | null, masterKey: CryptoKey): Promise<void> {
    const db = this.requireDb()
    if (tokenToStore !== null) await storeToken(db, masterKey, tokenToStore)
    const store = await Store.open(db, masterKey, client)
    this.unlockedClient = client
    this.unlockedKey = masterKey
    this.setState({ phase: 'unlocked', store })
    this.touch()
    void store.sync()
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

/** Nederlandse melding voor fouten uit opslag en sleutels; nooit inhoud of sleutels. */
export function describeError(error: unknown): string {
  if (error instanceof SetupError) return error.message
  if (error instanceof GithubError) return error.message
  if (error instanceof Error) {
    switch (error.name) {
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
