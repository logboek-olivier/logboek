import { randomBytes, utf8, type Bytes } from './encrypt'

// Vingerafdruk via WebAuthn met de prf-extensie. De PRF-uitkomst (32 bytes, alleen na gebruikersverificatie)
// leidt via HKDF een KEK af waaronder de hoofdsleutel lokaal is ingepakt. Geen prf? Dan geen vingerafdruk.

const HKDF_INFO = 'logboek/webauthn-kek/v1'
const RP_NAME = 'Logboek'

export class WebAuthnError extends Error {
  /** Naam van de onderliggende DOMException (bijvoorbeeld NotAllowedError, AbortError); nooit inhoud. */
  readonly reason: string

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'WebAuthnError'
    this.reason = cause instanceof Error ? cause.name : 'unknown'
  }
}

interface PrfInputs {
  prf?: { eval?: { first: BufferSource } }
}

interface PrfOutputs {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
}

/** Alleen de vorm: is er een platform-authenticator met gebruikersverificatie? Of prf werkt blijkt pas bij registreren. */
export async function fingerprintAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined') return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export interface Registration {
  credentialId: Bytes
  prfSalt: Bytes
  prfOutput: Bytes
}

/** Registreert een credential met prf en levert direct de PRF-uitkomst voor de meegegeven salt. */
export async function registerFingerprint(): Promise<Registration> {
  const prfSalt = randomBytes(32)
  const extensions: AuthenticationExtensionsClientInputs & PrfInputs = { prf: { eval: { first: prfSalt } } }
  let credential: Credential | null
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: location.hostname },
        user: { id: randomBytes(16), name: 'logboek', displayName: RP_NAME },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60_000,
        extensions,
      },
    })
  } catch (error) {
    throw new WebAuthnError('Vingerafdruk registreren is afgebroken', error)
  }
  if (!(credential instanceof PublicKeyCredential)) throw new WebAuthnError('Vingerafdruk registreren mislukt')
  const results = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfOutputs
  if (!results.prf?.enabled) throw new WebAuthnError('Dit apparaat ondersteunt geen vingerafdruk-sleutel (prf)')
  const credentialId = new Uint8Array(credential.rawId)
  const first = results.prf.results?.first
  // Sommige authenticators geven de PRF pas bij een assertion; dan meteen één keer ophalen.
  const prfOutput = first ? new Uint8Array(first) : await evaluateFingerprint(credentialId, prfSalt)
  return { credentialId, prfSalt, prfOutput }
}

/** Vraagt de vingerafdruk en geeft de PRF-uitkomst voor deze credential en salt. */
export async function evaluateFingerprint(credentialId: Bytes, prfSalt: Bytes, signal?: AbortSignal): Promise<Bytes> {
  const extensions: AuthenticationExtensionsClientInputs & PrfInputs = { prf: { eval: { first: prfSalt } } }
  let assertion: Credential | null
  try {
    assertion = await navigator.credentials.get({
      signal,
      publicKey: {
        challenge: randomBytes(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        timeout: 60_000,
        extensions,
      },
    })
  } catch (error) {
    throw new WebAuthnError('Vingerafdruk is afgebroken', error)
  }
  if (!(assertion instanceof PublicKeyCredential)) throw new WebAuthnError('Vingerafdruk mislukt')
  const results = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfOutputs
  const first = results.prf?.results?.first
  if (!first || first.byteLength < 32) throw new WebAuthnError('Vingerafdruk gaf geen sleutel (prf)')
  return new Uint8Array(first)
}

export async function deriveKekFromPrf(prfOutput: Bytes, hkdfSalt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info: utf8(HKDF_INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}
