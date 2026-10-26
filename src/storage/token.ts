import { decryptObject, encryptObject, utf8 } from '../crypto/encrypt'
import { deleteLocal, getLocal, putLocal, type Db } from './idb'

// De GitHub-token staat na ontgrendelen versleuteld onder de hoofdsleutel in IndexedDB (beveiligingsregel 5),
// samen met de vervaldatum (jjjj-mm-dd of null). Vóór ontgrendelen bestaat hij alleen in het geheugen.

const TOKEN_NAME = 'token'
const TOKEN_AAD = 'local/token'
const decoder = new TextDecoder()

export interface StoredToken {
  token: string
  expiresAt: string | null
}

export async function storeToken(db: Db, masterKey: CryptoKey, token: string, expiresAt: string | null): Promise<void> {
  const payload: StoredToken = { token, expiresAt }
  await putLocal(db, TOKEN_NAME, await encryptObject(masterKey, TOKEN_AAD, utf8(JSON.stringify(payload))))
}

export async function loadToken(db: Db, masterKey: CryptoKey): Promise<StoredToken | null> {
  const blob = await getLocal(db, TOKEN_NAME)
  if (!blob) return null
  const text = decoder.decode(await decryptObject(masterKey, TOKEN_AAD, blob))
  // Oudere opslag: alleen de token als tekst.
  if (!text.startsWith('{')) return { token: text, expiresAt: null }
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== 'object' || raw === null || typeof (raw as StoredToken).token !== 'string') return null
  const expiresAt = (raw as StoredToken).expiresAt
  return { token: (raw as StoredToken).token, expiresAt: typeof expiresAt === 'string' ? expiresAt : null }
}

export async function forgetToken(db: Db): Promise<void> {
  await deleteLocal(db, TOKEN_NAME)
}
