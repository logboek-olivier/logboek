import { createContext, useContext } from 'react'
import { DecryptError, fromBase64, randomBytes, toBase64 } from './crypto/encrypt'
import {
  META_PATH,
  looksLikeMeta,
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
import { AuthError, ConflictError, GithubClient, GithubError, NetworkError } from './storage/github'
import { clearAll, deleteSessionKey, getObject, getSessionKey, openLogboekDb, putObjectIfVault, putSessionKeyIfVault, type Db } from './storage/idb'
import { clearMarker, covers, diagnose, diagnoseLocal, executeRepair, localReport, readMarker, writeMarker, type RepairReport } from './repair'
import { NewerSchemaError } from './model/schema'
import { KeyMismatchError, Store } from './storage/store'
import { loadToken, storeToken, type StoredToken } from './storage/token'
import { decryptRecords } from './storage/sync'
import { COLLECTION_PATHS, type CollectionPath } from './model/types'

// Levenscyclus van een sessie: eerste keer (nieuw of koppelen), ontgrendelen, vergrendelen.
// Beveiligingsregel 10: vergrendelen na 5 minuten zonder gebruik. Binnen die 5 minuten staat de niet-exporteerbare
// hoofdsleutel (CryptoKey) met het tijdstip van laatste gebruik in IndexedDB, zodat verversen of wisselen van app
// niet vergrendelt. Bij openen: jonger dan 5 minuten → gebruiken, anders direct wissen. Vergrendelen wist geheugen
// en de opgeslagen sleutel.
//
// Sleutel-invariant: een hoofdsleutel (uit wachtzin, herstelcode, vingerafdruk of de opgeslagen sessiesleutel) wordt
// alleen gebruikt als hij via het check-veld bij de lokale meta.json.enc hoort. Vóór elke schrijfactie naar IndexedDB
// moet die meta nog dezelfde zijn en vóór elke schrijfactie naar GitHub moet meta.json.enc daar bij de sleutel horen
// (zie Store). Klopt dat niet, dan schrijft de sessie niets meer, wist de sessiesleutel en toont 'mismatch'.

export const LOCK_AFTER_MS = 5 * 60 * 1000
/** Laatste gebruik hoogstens zo vaak naar IndexedDB schrijven; bij verbergen altijd direct. */
const ACTIVITY_WRITE_MS = 15 * 1000
export const MIN_PASSPHRASE_LENGTH = 12

export type SessionState =
  /** `blocked`: een andere pagina van de app (oudere versie) houdt de opslag vast. */
  | { phase: 'loading'; blocked?: boolean }
  | { phase: 'setup' }
  | { phase: 'locked'; meta: Meta; fingerprint: boolean }
  | { phase: 'unlocked'; store: Store }
  /**
   * De sleutel hoort niet bij meta.json.enc: niets geschreven, sessiesleutel gewist. Nooit stil verder.
   * `metaRestorable`: meta.json.enc op GitHub ontbreekt of is kapot (geen ander logboek); met de wachtzin kan dit
   * apparaat zijn eigen meta terugzetten (restoreRemoteMeta).
   */
  | { phase: 'mismatch'; where: 'local' | 'remote'; metaRestorable?: true }
  /**
   * Logboek herstellen: gegevens die niet met de sleutel uit meta.json.enc te lezen zijn (src/repair.ts). `report`: wat
   * er verloren gaat (null = nog onbekend, eerst de wachtzin). `needsSecret`: herstellen vraagt de wachtzin.
   */
  | { phase: 'repair'; report: RepairReport | null; needsSecret: boolean }

/** Sleutel (uit wachtzin of herstelcode) die wacht op de tik op "Herstellen", met de grens van 5 minuten. */
interface PendingRepair {
  masterKey: CryptoKey
  client: GithubClient | null
  token: StoredToken | null
  /** Monotone klok: hierna niet meer bruikbaar. */
  deadline: number
  /** Systeemklok bij het bewaren. */
  heldAt: number
}

/** Waar de hoofdsleutel vandaan komt. */
type KeySource = 'secret' | 'resume' | 'fingerprint' | 'new' | 'link'

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
    this.db = await openLogboekDb(this.dbName, () => this.setState({ phase: 'loading', blocked: true }))
    if (await this.resume()) return
    await this.toLocked()
    // Eerder een herstel nodig gebleken en nog niet gedaan: direct "Logboek herstellen", met wat er verloren gaat.
    const marker = readMarker(this.dbName)
    if (marker && this.state.phase === 'locked') this.setState({ phase: 'repair', report: marker, needsSecret: true })
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
      await this.openWithStoredToken(record.key, 'resume', record.lastUsed)
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
      if (meta.check) this.vaultCheck = meta.check
    } catch {
      // Geen verbinding of ongeldige meta: de lokale meta blijft gelden.
    }
  }

  /** Alleen zinvol als de huidige wachtzin klopt; de nieuwe meta gaat naar GitHub en naar IndexedDB. */
  changePassphrase(current: string, next: string): Promise<void> {
    return this.busy(() => this.doChangePassphrase(current, next))
  }

  private async doChangePassphrase(current: string, next: string): Promise<void> {
    const db = this.requireDb()
    const { client, masterKey } = this.requireUnlocked()
    const generation = this.generation
    await this.assertLocalVault(generation, masterKey)
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
        // Zelfde sleutel, nieuw check-veld (de Store controleert dat zelf met de sleutel).
        if (changed.check) this.vaultCheck = changed.check
        // De vingerafdruk-verpakking blijft geldig: de hoofdsleutel is niet veranderd.
        return
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 1) throw error
        const remote = await client.getFile(META_PATH)
        if (!remote) throw error
        // Alleen een meta overnemen die aan deze hoofdsleutel gebonden is (zie refreshMeta).
        const theirs = parseMeta(new TextDecoder().decode(remote.content))
        if (!(await verifyMetaCheck(theirs, masterKey))) throw error
        await Store.storeMeta(db, theirs, remote.sha)
        if (theirs.check) this.vaultCheck = theirs.check
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
    await this.assertLocalVault(generation, masterKey)
    await storeToken(db, masterKey, token.trim(), expiresAt)
    this.tokenExpiresAt = expiresAt
    this.assertSameSession(generation)
    // De Store houdt de oude client; een nieuwe Store openen zorgt dat sync de nieuwe token gebruikt.
    const store = await Store.open(db, masterKey, client, this.vaultCheck)
    if (generation !== this.generation) {
      store.lock()
      throw new Error('Vergrendeld')
    }
    this.watch(store)
    this.unlockedClient = client
    this.setState({ phase: 'unlocked', store })
    previous.lock()
    this.touch()
    store.enableAutoSync()
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
    await this.openWithStoredToken(masterKey, 'fingerprint')
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
    // Databestanden zonder meta.json.enc (bijvoorbeeld van een apparaat met een oude sleutel): niet opnieuw beginnen
    // in dezelfde repo, anders staan er bestanden onder twee sleutels door elkaar.
    for (const path of COLLECTION_PATHS) {
      if ((await client.getFile(path)) !== null) throw new SetupError('error.repoHasFiles')
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
    // Andere tabbladen (ook een oudere versie die nog open staat) houden de sleutel van het vorige logboek: vergrendelen.
    // 'lock' begrijpt ook een oudere versie (vanaf release 1 met sessiesleutel).
    this.channel?.postMessage('lock')
    this.dropKey()
    await clearAll(db)
    await Store.storeMeta(db, vault.meta, sha)
    await this.open(client, { token: token.trim(), expiresAt }, vault.masterKey, 'new')
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
    this.channel?.postMessage('lock')
    this.dropKey()
    await clearAll(db)
    await Store.storeMeta(db, meta, file.sha)
    await this.open(client, { token: token.trim(), expiresAt }, masterKey, 'link')
  }

  /** Ontgrendelen op een apparaat dat al gekoppeld is. */
  async unlockLocal(secret: { passphrase: string } | { recoveryCode: string }): Promise<void> {
    if (this.state.phase !== 'locked') throw new Error('Niet vergrendeld')
    const masterKey = await unlock(this.state.meta, await withWordlist(secret))
    await this.openWithStoredToken(masterKey, 'secret')
  }

  /**
   * `resumedLastUsed`: hervat met de opgeslagen sleutel; openen telt dan niet als gebruik.
   * Past de sessiesleutel of vingerafdruk niet bij de lokale meta, of zijn lokale gegevens niet met de sleutel te lezen:
   * "Logboek herstellen" (met wachtzin of herstelcode). Nooit stil verder, nooit iets wissen zonder tik en wachtzin.
   */
  private async openWithStoredToken(masterKey: CryptoKey, source: KeySource, resumedLastUsed?: number): Promise<void> {
    const db = this.requireDb()
    let bound = false
    let client: GithubClient | null = null
    try {
      await this.bindKey(masterKey, source)
      bound = true
      let stored: StoredToken | null
      try {
        stored = await loadToken(db, masterKey)
      } catch (error) {
        if (source === 'secret' && error instanceof DecryptError) return await this.enterRepair(masterKey, null, true, error)
        throw error
      }
      if (stored === null) {
        // Niets wissen: met de wachtzin kan Olivier in het herstelscherm een token invoeren.
        if (source === 'secret') return await this.enterRepair(masterKey, null, true, new SetupError('error.tokenMissing'))
        throw new SetupError('error.tokenMissing')
      }
      this.tokenExpiresAt = stored.expiresAt
      client = new GithubClient(stored.token)
      try {
        await this.open(client, null, masterKey, source, resumedLastUsed)
      } catch (error) {
        if (source === 'secret' && error instanceof DecryptError) return await this.enterRepair(masterKey, client, true, error)
        throw error
      }
    } catch (error) {
      // Sessiesleutel of vingerafdruk hoort niet bij de lokale meta of de lokale gegevens: herstellen met de wachtzin.
      if ((source === 'resume' || source === 'fingerprint') && (error instanceof KeyMismatchError || error instanceof DecryptError || error instanceof SetupError)) {
        if (source === 'fingerprint' && error instanceof KeyMismatchError) await deleteFingerprint(db).catch(() => undefined)
        // Sleutel hoort wel bij de meta (binnen 5 minuten, regel 10), alleen de gegevens niet: alvast bepalen wat er
        // verloren gaat, zodat het herstelscherm dat vóór de wachtzin toont. Herstellen zelf vraagt de wachtzin.
        if (bound && error instanceof DecryptError) {
          try {
            await this.enterRepair(masterKey, client, false, error)
            return
          } catch (failure) {
            recordError(failure)
          }
        }
        recordError(error)
        this.enterRepairWithoutKey()
        return
      }
      throw error
    }
  }

  /** Check-veld van de lokale meta waaraan de sleutel gebonden is (wisselt mee bij een gewijzigde wachtzin). */
  private vaultCheck = ''
  /**
   * Fase 'repair' na wachtzin of herstelcode: de sleutel (en zo nodig een client of nieuwe token) wacht op de tik op
   * "Herstellen". Hoogstens 5 minuten (regel 10).
   */
  private pendingRepair: PendingRepair | null = null
  /** Lopende bewerking die niet door een herlaad (nieuwe versie) onderbroken mag worden. */
  private busyCount = 0

  /** Eerste keer voorbij het keuzescherm (token, wachtzin of herstelcode ingevuld of getoond); gezet door Setup. */
  private setupInProgress = false

  setSetupInProgress(inProgress: boolean): void {
    this.setupInProgress = inProgress
  }

  /**
   * True zolang herladen een stap halverwege zou afbreken (eerste keer voorbij het keuzescherm, wachtzin wijzigen,
   * herstellen). Op het keuzescherm van de eerste keer is niets halverwege: daar laadt een nieuwe versie direct.
   */
  isBusy(): boolean {
    return this.busyCount > 0 || (this.state.phase === 'setup' && this.setupInProgress)
  }

  private async busy<T>(run: () => Promise<T>): Promise<T> {
    this.busyCount++
    try {
      return await run()
    } finally {
      this.busyCount--
    }
  }

  /**
   * Sleutel-invariant bij openen: de sleutel moet via het check-veld bij de lokale meta horen. Geeft het check-veld.
   * Een meta zonder check-veld (alleen van vóór 26 oktober 2026) is niet te controleren en telt als niet passend.
   */
  private async bindKey(masterKey: CryptoKey, source: KeySource): Promise<string> {
    const check = await this.boundCheck(masterKey)
    if (check !== null) return check
    // Sessiesleutel of vingerafdruk: de aanroeper gaat naar "Logboek herstellen".
    if (source === 'resume' || source === 'fingerprint') throw new KeyMismatchError('local')
    throw this.keyMismatch(new KeyMismatchError('local'), source)
  }

  /** Check-veld van de lokale meta als die aan `masterKey` gebonden is, anders null. */
  private async boundCheck(masterKey: CryptoKey): Promise<string | null> {
    const meta = await Store.loadMeta(this.requireDb()).catch(() => null)
    return meta?.check && (await verifyMetaCheck(meta, masterKey)) ? meta.check : null
  }

  /** Vóór een lokale schrijfactie buiten de Store: hoort de lokale meta nog bij de sleutel van deze sessie? */
  private async assertLocalVault(generation: number, masterKey: CryptoKey): Promise<void> {
    const check = await this.boundCheck(masterKey)
    this.assertSameSession(generation)
    if (check === null) throw this.keyMismatch(new KeyMismatchError('local'))
    this.vaultCheck = check
  }

  /** Wist een eventuele vorige sleutel en Store uit het geheugen (vóór een nieuw of gekoppeld logboek). */
  private dropKey(): void {
    const store = this.state.phase === 'unlocked' ? this.state.store : null
    this.clearLockTimer()
    this.generation++
    this.unlockedClient = null
    this.unlockedKey = null
    this.pendingRepair = null
    store?.lock()
  }

  /** Stopt de sessie zonder iets te schrijven: sessiesleutel wissen, geheugen wissen, scherm 'mismatch'. */
  private keyMismatch(error: KeyMismatchError, source?: KeySource): KeyMismatchError {
    this.clearLockTimer()
    writeLockedAt(this.dbName, this.clock())
    const db = this.db
    if (db) {
      void deleteSessionKey(db).catch(() => undefined)
      // Een vingerafdruk-verpakking van een andere sleutel is nergens meer voor te gebruiken.
      if (source === 'fingerprint') void deleteFingerprint(db).catch(() => undefined)
    }
    const store = this.state.phase === 'unlocked' ? this.state.store : null
    this.generation++
    this.unlockedClient = null
    this.unlockedKey = null
    this.tokenExpiresAt = null
    this.pendingRepair = null
    recordError(error)
    const restorable = error.where === 'remote' && (error.remote === 'missing' || error.remote === 'unreadable')
    this.setState(restorable ? { phase: 'mismatch', where: 'remote', metaRestorable: true } : { phase: 'mismatch', where: error.where })
    store?.lock()
    return error
  }

  /** "Logboek herstellen" zonder sleutel: sessiesleutel wissen, wachtzin vragen. Toont het laatst bekende verslag. */
  private enterRepairWithoutKey(): void {
    writeLockedAt(this.dbName, this.clock())
    if (this.db) void deleteSessionKey(this.db).catch(() => undefined)
    this.dropKey()
    this.tokenExpiresAt = null
    this.setState({ phase: 'repair', report: readMarker(this.dbName), needsSecret: true })
  }

  /**
   * Lokale gegevens of bestanden op GitHub zijn niet te lezen met een sleutel die wel bij meta.json.enc hoort: bepalen
   * wat er verloren gaat en "Logboek herstellen" tonen. Niets wissen. `secretGiven`: de sleutel komt net uit wachtzin
   * of herstelcode, dan volstaat de tik op "Herstellen"; anders vraagt het herstelscherm de wachtzin.
   */
  private async enterRepair(masterKey: CryptoKey, client: GithubClient | null, secretGiven: boolean, cause: Error): Promise<void> {
    const db = this.requireDb()
    const generation = this.generation
    const local = await diagnoseLocal(db, masterKey)
    let report = localReport(local)
    if (client) {
      try {
        await this.assertRemoteMeta(client, masterKey)
        report = (await diagnose(masterKey, client, local)).report
      } catch (error) {
        // Ander logboek op GitHub: het scherm 'mismatch' staat er al. Geen verbinding: het lokale verslag geldt.
        if (error instanceof KeyMismatchError) return
        // Token verlopen of ingetrokken: het herstelscherm vraagt een token (alleen Olivier kan die geven).
        if (error instanceof AuthError) {
          report = { ...report, tokenNeeded: true }
          client = null
        } else if (!(error instanceof NetworkError)) throw error
      }
    }
    if (generation !== this.generation) return
    if (report.lost.length === 0 && report.localOnly.length === 0 && !report.tokenNeeded && !local.outboxUnreadable) throw cause
    recordError(cause)
    this.dropKey()
    this.tokenExpiresAt = null
    // Geen sessiesleutel tijdens herstellen: verversen hervat niet met gegevens die niet bij de sleutel passen.
    writeLockedAt(this.dbName, this.clock())
    await deleteSessionKey(db).catch(() => undefined)
    writeMarker(this.dbName, report)
    if (secretGiven) this.holdForRepair({ masterKey, client, token: null })
    this.setState({ phase: 'repair', report, needsSecret: !secretGiven })
  }

  /** Sleutel bewaren tot de tik op "Herstellen", hoogstens 5 minuten (regel 10): timer plus harde controle bij gebruik. */
  private holdForRepair(pending: Omit<PendingRepair, 'deadline' | 'heldAt'>): void {
    this.pendingRepair = { ...pending, deadline: this.monotonic() + LOCK_AFTER_MS, heldAt: this.clock() }
    this.clearLockTimer()
    this.lockTimer = setTimeout(() => this.lock(), LOCK_AFTER_MS)
  }

  /** De bewaarde herstelsleutel, of null als die er niet is of ouder is dan 5 minuten (dan wordt hij gewist). */
  private heldRepairKey(): PendingRepair | null {
    const pending = this.pendingRepair
    if (!pending) return null
    const age = this.clock() - pending.heldAt
    if (this.monotonic() >= pending.deadline || age < 0 || age >= LOCK_AFTER_MS) {
      this.lock()
      return null
    }
    return pending
  }

  /** meta.json.enc op GitHub moet bij de sleutel horen; anders het scherm 'mismatch' (ander logboek, opnieuw koppelen). */
  private async assertRemoteMeta(client: GithubClient, masterKey: CryptoKey): Promise<void> {
    const remote = await client.getFile(META_PATH)
    if (!remote) throw this.keyMismatch(new KeyMismatchError('remote', 'missing'))
    let meta: Meta
    const text = new TextDecoder().decode(remote.content)
    try {
      meta = parseMeta(text)
    } catch (error) {
      if (error instanceof NewerSchemaError) throw error
      throw this.keyMismatch(new KeyMismatchError('remote', looksLikeMeta(text) ? 'other' : 'unreadable'))
    }
    if (!(await verifyMetaCheck(meta, masterKey))) throw this.keyMismatch(new KeyMismatchError('remote'))
  }

  /**
   * Logboek herstellen, na de tik op "Herstellen" (plus wachtzin of herstelcode als die gevraagd wordt). Wist alleen wat
   * niet met de sleutel uit meta.json.enc te lezen is en vervangt onleesbare bestanden op GitHub (zie src/repair.ts).
   * Blijkt er meer verloren te gaan dan getoond, dan eerst het nieuwe verslag tonen en opnieuw een tik vragen.
   */
  repair(input: { secret?: { passphrase: string } | { recoveryCode: string }; token?: string }): Promise<void> {
    return this.busy(() => this.doRepair(input))
  }

  private async doRepair(input: { secret?: { passphrase: string } | { recoveryCode: string }; token?: string }): Promise<void> {
    const db = this.requireDb()
    if (this.state.phase !== 'repair') throw new Error('Geen herstel')
    const pending = this.state.phase === 'repair' && !this.state.needsSecret ? this.heldRepairKey() : null
    if (this.state.phase !== 'repair') throw new Error('Geen herstel')
    const shown = this.state.report
    const generation = this.generation
    let masterKey = pending?.masterKey ?? null
    if (!masterKey) {
      if (!input.secret) throw new SetupError('error.secretRequired')
      const meta = await Store.loadMeta(db)
      if (!meta) throw new SetupError('error.metaMissing')
      masterKey = await unlock(meta, await withWordlist(input.secret))
    }
    this.assertSameSession(generation)
    const vaultCheck = await this.boundCheck(masterKey)
    if (vaultCheck === null) throw this.keyMismatch(new KeyMismatchError('local'))
    let client = pending?.client ?? null
    let token = pending?.token ?? null
    const typed = input.token?.trim() ?? ''
    if (typed) {
      const { expiresAt } = await new GithubClient(typed).checkAccess()
      token = { token: typed, expiresAt }
      client = new GithubClient(typed)
    }
    if (!client) {
      const stored = await loadToken(db, masterKey).catch((error: unknown) => {
        if (error instanceof DecryptError) return null
        throw error
      })
      if (stored) {
        client = new GithubClient(stored.token)
        this.tokenExpiresAt = stored.expiresAt
      }
    }
    this.assertSameSession(generation)
    if (!client) {
      // Alleen een token kan Olivier zelf geven (GitHub-rechten): het herstelscherm vraagt erom, de sleutel wacht.
      const report = { ...(shown ?? localReport(await diagnoseLocal(db, masterKey))), tokenNeeded: true }
      writeMarker(this.dbName, report)
      this.generation++
      this.holdForRepair({ masterKey, client: null, token: null })
      this.setState({ phase: 'repair', report, needsSecret: false })
      throw new SetupError('error.tokenRequired')
    }
    let diagnosis: Awaited<ReturnType<typeof diagnose>>
    try {
      await this.assertRemoteMeta(client, masterKey)
      diagnosis = await diagnose(masterKey, client, await diagnoseLocal(db, masterKey))
    } catch (error) {
      if (!(error instanceof AuthError) || generation !== this.generation) throw error
      // Token verlopen of ingetrokken: om een token vragen, de sleutel wacht (hoogstens 5 minuten).
      const report = { ...(shown ?? localReport(await diagnoseLocal(db, masterKey))), tokenNeeded: true }
      writeMarker(this.dbName, report)
      this.generation++
      this.holdForRepair({ masterKey, client: null, token: null })
      this.setState({ phase: 'repair', report, needsSecret: false })
      throw error
    }
    this.assertSameSession(generation)
    if (!covers(shown, diagnosis.report)) {
      writeMarker(this.dbName, diagnosis.report)
      this.generation++
      this.holdForRepair({ masterKey, client, token })
      this.setState({ phase: 'repair', report: diagnosis.report, needsSecret: false })
      return
    }
    // Andere tabbladen (ook een oudere versie) houden mogelijk de verkeerde sleutel: eerst vergrendelen.
    this.channel?.postMessage('lock')
    await executeRepair(db, masterKey, client, diagnosis, vaultCheck)
    await deleteSessionKey(db)
    // Een vingerafdruk-verpakking kan van de verkeerde sleutel zijn; opnieuw aanzetten kan in Instellingen.
    await deleteFingerprint(db).catch(() => undefined)
    clearMarker(this.dbName)
    this.assertSameSession(generation)
    this.pendingRepair = null
    if (token) this.tokenExpiresAt = token.expiresAt
    await this.open(client, token, masterKey, 'secret')
  }

  /** Bestanden waarvan dit apparaat een (versleutelde) kopie heeft; voor de lijst bij opnieuw koppelen. */
  async localCopies(): Promise<CollectionPath[]> {
    const db = this.requireDb()
    const result: CollectionPath[] = []
    for (const path of COLLECTION_PATHS) if (await getObject(db, path)) result.push(path)
    return result
  }

  /**
   * meta.json.enc op GitHub ontbreekt of is kapot (geen meta-JSON), en hoort dus niet bij een ander logboek: na een tik
   * plus wachtzin of herstelcode zet dit apparaat zijn eigen meta.json.enc terug (met de SHA als voorwaarde) en opent het
   * logboek; de sync zet daarna ontbrekende bestanden terug. Alleen als de lokale meta via het check-veld bij de sleutel
   * hoort, en alleen als elk databestand dat al op GitHub staat met deze sleutel te ontsleutelen is (anders is het een
   * ander logboek). Een meta van een ander logboek, of een meta die deze app niet kan lezen, wordt nooit overschreven.
   * `token`: alleen nodig als de token op dit apparaat ontbreekt of onleesbaar is.
   */
  restoreRemoteMeta(secret: { passphrase: string } | { recoveryCode: string }, token?: string): Promise<void> {
    return this.busy(() => this.doRestoreRemoteMeta(secret, token))
  }

  private async doRestoreRemoteMeta(secret: { passphrase: string } | { recoveryCode: string }, typedToken?: string): Promise<void> {
    if (this.state.phase !== 'mismatch' || !this.state.metaRestorable) throw new Error('Niet van toepassing')
    const db = this.requireDb()
    const generation = this.generation
    const meta = await Store.loadMeta(db)
    if (!meta) throw new SetupError('error.metaMissing')
    const masterKey = await unlock(meta, await withWordlist(secret))
    this.assertSameSession(generation)
    if ((await this.boundCheck(masterKey)) !== meta.check) throw this.keyMismatch(new KeyMismatchError('local'))
    let token: StoredToken | null
    if (typedToken?.trim()) {
      const client = new GithubClient(typedToken.trim())
      const { expiresAt } = await client.checkAccess()
      token = { token: typedToken.trim(), expiresAt }
    } else {
      token = await loadToken(db, masterKey).catch((error: unknown) => {
        if (error instanceof DecryptError) return null
        throw error
      })
    }
    // Alleen een token kan Olivier zelf geven: het scherm vraagt erom.
    if (!token) throw new SetupError('error.tokenRequired')
    this.tokenExpiresAt = token.expiresAt
    const client = new GithubClient(token.token)
    const remote = await client.getFile(META_PATH)
    if (remote) {
      const text = new TextDecoder().decode(remote.content)
      let theirs: Meta | null = null
      try {
        theirs = parseMeta(text)
      } catch (error) {
        if (error instanceof NewerSchemaError) throw error
        if (looksLikeMeta(text)) throw this.keyMismatch(new KeyMismatchError('remote'))
      }
      // Intussen weer een geldige meta: van deze sleutel dan gewoon openen, van een andere nooit overschrijven.
      if (theirs && !(await verifyMetaCheck(theirs, masterKey))) throw this.keyMismatch(new KeyMismatchError('remote'))
      if (theirs) return this.openAfterRestore(client, typedToken ? token : null, masterKey)
    }
    // Databestanden van een ander logboek op GitHub (bijvoorbeeld een opnieuw aangemaakte repo met een nieuw logboek
    // zonder meta): nooit een meta van dit apparaat ernaast zetten. Zelfde maatstaf als de sync: geen enkel bestand met
    // deze sleutel te lezen en minstens twee niet te ontsleutelen. Eén kapot bestand houdt het terugzetten niet tegen;
    // dat toont de app daarna gewoon bij zijn onderdeel.
    let readable = 0
    let undecryptable = 0
    for (const path of COLLECTION_PATHS) {
      const file = await client.getFile(path)
      if (!file) continue
      try {
        await decryptRecords(masterKey, path, file.content)
        readable++
      } catch (error) {
        if (error instanceof DecryptError) undecryptable++
        else readable++
      }
    }
    if (readable === 0 && undecryptable >= 2) throw this.keyMismatch(new KeyMismatchError('remote'))
    this.assertSameSession(generation)
    // Vlak voor het schrijven nog eens: de lokale meta moet dezelfde zijn (geen ander tabblad dat intussen koppelde).
    const vaultCheck = await this.boundCheck(masterKey)
    if (vaultCheck === null || vaultCheck !== meta.check) throw this.keyMismatch(new KeyMismatchError('local'))
    this.channel?.postMessage('lock')
    const sha = await client.putFile(META_PATH, new TextEncoder().encode(serializeMeta(meta)), remote?.sha ?? null)
    if (!(await putObjectIfVault(db, META_PATH, vaultCheck, { path: META_PATH, blob: new TextEncoder().encode(serializeMeta(meta)), sha }))) {
      throw this.keyMismatch(new KeyMismatchError('local'))
    }
    this.assertSameSession(generation)
    await this.openAfterRestore(client, typedToken ? token : null, masterKey)
  }

  /** Openen na het terugzetten; lokale gegevens die niet met de sleutel te lezen zijn: "Logboek herstellen". */
  private async openAfterRestore(client: GithubClient, token: StoredToken | null, masterKey: CryptoKey): Promise<void> {
    try {
      await this.open(client, token, masterKey, 'secret')
    } catch (error) {
      if (error instanceof DecryptError) return this.enterRepair(masterKey, client, true, error)
      throw error
    }
  }

  /**
   * meta.json.enc op GitHub hoort bij een andere sleutel (of ontbreekt): dit apparaat hoort bij een ander logboek.
   * Alleen na Olivier's tik: alles op dit apparaat wissen en naar Eerste keer (nieuw logboek of koppelen).
   */
  async relink(): Promise<void> {
    if (this.state.phase !== 'mismatch' || this.state.where !== 'remote') throw new Error('Niet van toepassing')
    const db = this.requireDb()
    this.channel?.postMessage('lock')
    writeLockedAt(this.dbName, this.clock())
    this.dropKey()
    await clearAll(db)
    clearMarker(this.dbName)
    this.lastMeta = null
    this.lastFingerprint = false
    this.setState({ phase: 'setup' })
  }

  /** Terug naar ontgrendelen (vanaf 'mismatch'); er wordt niets gewist. */
  async backToUnlock(): Promise<void> {
    this.clearLockTimer()
    this.pendingRepair = null
    this.generation++
    await this.toLocked()
  }

  /** `broadcast`: ook de andere tabbladen vergrendelen (niet als dit tabblad zelf door een ander werd vergrendeld). */
  lock(broadcast = true): void {
    this.clearLockTimer()
    // Altijd de opgeslagen sleutel wissen, ook als het geheugen al leeg is. Het tijdstip gaat eerst synchroon naar
    // localStorage, zodat een sleutel waarvan het wissen nog niet klaar was, toch nooit meer gebruikt wordt.
    writeLockedAt(this.dbName, this.clock())
    if (this.db) void deleteSessionKey(this.db).catch(() => undefined)
    if (broadcast) this.channel?.postMessage('lock')
    if (this.state.phase === 'repair') {
      // Sleutel wissen; het herstelscherm blijft staan en vraagt dan de wachtzin.
      this.pendingRepair = null
      this.generation++
      if (!this.state.needsSecret) this.setState({ ...this.state, needsSecret: true })
      return
    }
    // Ook op het scherm "Sleutel past niet": lopende stappen (terugzetten) stoppen als een ander tabblad vergrendelt.
    if (this.state.phase === 'mismatch') this.generation++
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
    if (this.state.phase === 'repair') return this.pendingRepair !== null && this.heldRepairKey() === null
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
      // Sleutel-invariant: alleen een sleutel opslaan die bij de huidige lokale meta hoort; controle en schrijven in één
      // transactie. Een nieuwere meta van dezelfde sleutel (wachtzin gewijzigd) is in orde.
      for (let attempt = 0; attempt < 2; attempt++) {
        // Na vergrendelen niets meer terugschrijven.
        if (generation !== this.generation) return
        if (await putSessionKeyIfVault(db, META_PATH, this.vaultCheck, { name: 'masterKey', key, lastUsed })) {
          if (generation !== this.generation) await deleteSessionKey(db)
          return
        }
        const check = await this.boundCheck(key)
        if (generation !== this.generation) return
        if (check === null) break
        this.vaultCheck = check
      }
      if (generation === this.generation) this.keyMismatch(new KeyMismatchError('local'))
    })().catch(() => undefined)
  }

  private async open(
    client: GithubClient,
    tokenToStore: StoredToken | null,
    masterKey: CryptoKey,
    source: KeySource,
    resumedLastUsed?: number,
  ): Promise<void> {
    const db = this.requireDb()
    const vaultCheck = await this.bindKey(masterKey, source)
    if (tokenToStore !== null) {
      await storeToken(db, masterKey, tokenToStore.token, tokenToStore.expiresAt)
      this.tokenExpiresAt = tokenToStore.expiresAt
    }
    // Blijvende opslag aanvragen, zodat de browser de versleutelde kopie en de outbox niet opruimt.
    void requestPersistentStorage()
    const store = await Store.open(db, masterKey, client, vaultCheck)
    this.generation++
    this.vaultCheck = vaultCheck
    this.pendingRepair = null
    // Geopend zonder onleesbare lokale gegevens: een oud herstelverslag geldt niet meer (een nieuwe sync meldt het
    // opnieuw als er op GitHub nog iets onleesbaar is).
    clearMarker(this.dbName)
    this.watch(store)
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
    store.enableAutoSync()
    // Eén keer per week vanzelf controleren of GitHub en dit apparaat gelijk zijn (Meer → Opslag).
    void store
      .sync()
      .then(() => store.weeklyCheck())
      .catch(recordError)
    void this.refreshMeta(client, db, masterKey, this.generation)
  }

  /** Merkt de Store dat de sleutel niet (meer) bij meta.json.enc hoort, dan stopt de sessie. */
  private watch(store: Store): void {
    store.onKeyMismatch((error) => {
      if (this.state.phase === 'unlocked' && this.state.store === store) this.keyMismatch(error)
    })
    // Bestanden op GitHub die niet met deze sleutel te lezen zijn, blokkeren de app niet: de Store herstelt
    // seedbestanden vanzelf en toont bij de andere een melding met een herstelknop (zie Store.repairOptions).
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
      case 'KeyMismatchError':
        return t('key.mismatchTitle')
      case 'InvalidBackupError':
        return t('backup.invalid')
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
