import { readFileSync } from 'node:fs'
import { parseWordlist } from '../../src/crypto/recovery'

export { createVault } from '../../src/crypto/keys'

export function parseWordlistForTests(): string[] {
  return parseWordlist(readFileSync(new URL('../../public/bip39-en.txt', import.meta.url), 'utf8'))
}
