import { decryptObject, encryptObject, utf8 } from '../crypto/encrypt'
import { DATA_REPO, isRepoName } from './github'
import { deleteLocal, getLocal, putLocal, type Db } from './idb'

// De GitHub-token staat na ontgrendelen versleuteld onder de hoofdsleutel in IndexedDB (beveiligingsregel 5),
// samen met de vervaldatum (jjjj-mm-dd of null). Vóór ontgrendelen bestaat hij alleen in het geheugen.

const TOKEN_NAME = 'token'
const TOKEN_AAD = 'local/token'
const decoder = new TextDecoder()

export interface StoredToken {
  token: string
  expiresAt: string | null
  /** De data-repo ("eigenaar/naam"); ontbreekt = de standaard (DATA_REPO), zoals bij elke oudere opslag. */
  repo?: string
}

export async function storeToken(db: Db, masterKey: CryptoKey, token: string, expiresAt: string | null, repo?: string): Promise<void> {
  const payload: StoredToken = { token, expiresAt, ...(repo && repo !== DATA_REPO ? { repo } : {}) }
  await putLocal(db, TOKEN_NAME, await encryptObject(masterKey, TOKEN_AAD, utf8(JSON.stringify(payload))))
}

export async function loadToken(db: Db, masterKey: CryptoKey): Promise<StoredToken | null> {
  const blob = await getLocal(db, TOKEN_NAME)
  if (!blob) return null
  const text = decoder.decode(await decryptObject(masterKey, TOKEN_AAD, blob))
  // Oudere opslag: alleen de token als tekst.
  if (!text.startsWith('{')) return { token: text, expiresAt: null }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Wel ontsleuteld maar ongeldig: alsof er geen token is (het herstelscherm vraagt er dan één, met de wachtzin).
    return null
  }
  if (typeof raw !== 'object' || raw === null || typeof (raw as StoredToken).token !== 'string') return null
  const expiresAt = (raw as StoredToken).expiresAt
  const repo = (raw as StoredToken).repo
  return { token: (raw as StoredToken).token, expiresAt: typeof expiresAt === 'string' ? expiresAt : null, ...(typeof repo === 'string' && isRepoName(repo) ? { repo } : {}) }
}

/** De data-repo bij een opgeslagen token; zonder (oudere opslag) de standaard. */
export function repoOf(token: Pick<StoredToken, 'repo'> | null | undefined): string {
  return token?.repo && isRepoName(token.repo) ? token.repo : DATA_REPO
}

export async function forgetToken(db: Db): Promise<void> {
  await deleteLocal(db, TOKEN_NAME)
}
