// Draait in de VORIGE release (scripts/build-previous.mjs kopieert dit als tests/upgrade/upgrade-generate.test.ts en
// start het daar met vitest): maakt met de code van die release een logboek met een voorbeeld in elk databestand,
// versleuteld zoals die release het op GitHub zet. Alles verzonnen; het resultaat staat alleen in .vorige/.
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { toBase64, utf8 } from '../../src/crypto/encrypt'
import { createVault, serializeMeta } from '../../src/crypto/keys'
import { COLLECTION_PATHS } from '../../src/model/types'
import { encryptRecords } from '../../src/storage/sync'
import { parseWordlistForTests } from '../helpers/vault'
import { UPGRADE_SAMPLES } from './upgrade-samples'

it('maakt de upgradegegevens van de vorige release', async () => {
  const out = process.env.UPGRADE_OUT
  const passphrase = process.env.UPGRADE_PASSPHRASE
  if (!out || !passphrase) throw new Error('UPGRADE_OUT en UPGRADE_PASSPHRASE ontbreken')
  const vault = await createVault(passphrase, parseWordlistForTests())
  const files: Record<string, string> = { 'meta.json.enc': toBase64(utf8(serializeMeta(vault.meta))) }
  for (const path of COLLECTION_PATHS) {
    const records = UPGRADE_SAMPLES[path]
    // Elk databestand van de vorige release moet een voorbeeld hebben.
    expect(records, path).toBeDefined()
    files[path] = toBase64(await encryptRecords(vault.masterKey, path, records as never))
  }
  writeFileSync(out, JSON.stringify({ paths: COLLECTION_PATHS, files }))
}, 60_000)
