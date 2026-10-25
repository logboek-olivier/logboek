import { decryptObject, encryptObject, utf8 } from '../crypto/encrypt'
import { deleteLocal, getLocal, putLocal, type Db } from './idb'

// De GitHub-token staat na ontgrendelen versleuteld onder de hoofdsleutel in IndexedDB (beveiligingsregel 5).
// Vóór ontgrendelen bestaat hij alleen in het geheugen van het scherm Eerste keer.

const TOKEN_NAME = 'token'
const TOKEN_AAD = 'local/token'
const decoder = new TextDecoder()

export async function storeToken(db: Db, masterKey: CryptoKey, token: string): Promise<void> {
  await putLocal(db, TOKEN_NAME, await encryptObject(masterKey, TOKEN_AAD, utf8(token)))
}

export async function loadToken(db: Db, masterKey: CryptoKey): Promise<string | null> {
  const blob = await getLocal(db, TOKEN_NAME)
  if (!blob) return null
  return decoder.decode(await decryptObject(masterKey, TOKEN_AAD, blob))
}

export async function forgetToken(db: Db): Promise<void> {
  await deleteLocal(db, TOKEN_NAME)
}
