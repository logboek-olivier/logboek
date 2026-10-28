import { describe, expect, it } from 'vitest'
import { COLLECTION_PATHS } from '../src/model/types'
import { SCREEN_FILES } from '../src/screen-files'

// Een onleesbaar bestand toont zijn herstelknop op de schermen van zijn onderdeel: elk databestand moet er één hebben.
describe('schermen per databestand', () => {
  it('elk databestand hoort bij minstens één scherm', () => {
    const shown = new Set(Object.values(SCREEN_FILES).flat())
    for (const path of COLLECTION_PATHS) expect(shown.has(path), path).toBe(true)
  })
})
