import { describe, expect, it } from 'vitest'
import { COLLECTION_PATHS } from '../src/model/types'
import { decodeRecords, encodeRecords } from '../src/storage/sync'
import { UPGRADE_SAMPLES } from './upgrade/upgrade-samples'

// Harde regel: elke PR die een databestand toevoegt of wijzigt, heeft een upgradetest. Daarvoor moet elk databestand
// een voorbeeld hebben dat de vorige release kan maken en deze release kan lezen (tests/e2e/upgrade.spec.ts).

describe('upgradevoorbeelden', () => {
  it('elk databestand heeft een voorbeeld, en deze release leest het', () => {
    for (const path of COLLECTION_PATHS) {
      const records = UPGRADE_SAMPLES[path]
      expect(records?.length, path).toBeGreaterThan(0)
      expect(decodeRecords(path, encodeRecords(records as never))).toEqual(records)
    }
  })
})
