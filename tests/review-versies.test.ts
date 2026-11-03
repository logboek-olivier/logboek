import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, WRITER_VERSION } from '../src/model/schema'

// Review C-2: documentatie en code liepen uiteen op de dataversies. docs/app-kaart.md noemt de huidige schema- en
// schrijfversie; verandert src/model/schema.ts, dan moet de kaart mee (en CLAUDE.md, zie de schrijfversies onder Prullenbak).

const kaart = readFileSync(new URL('../docs/app-kaart.md', import.meta.url), 'utf8')

describe('docs/app-kaart.md noemt dezelfde dataversies als src/model/schema.ts', () => {
  it('de regel met de huidige versies', () => {
    const m = /\*\*Huidige dataversies: schemaversie (\d+), schrijfversie (\d+)\*\*/.exec(kaart)
    expect(m, 'de regel "Huidige dataversies" ontbreekt in docs/app-kaart.md').not.toBeNull()
    expect(Number(m![1])).toBe(SCHEMA_VERSION)
    expect(Number(m![2])).toBe(WRITER_VERSION)
  })

  it('de "(nu N)" bij minWriterVersion en schemaVersion in sectie 5', () => {
    const writer = /`minWriterVersion` \(nu (\d+)\)/.exec(kaart)
    const schema = /`schemaVersion` \(nu (\d+)\)/.exec(kaart)
    expect(writer).not.toBeNull()
    expect(schema).not.toBeNull()
    expect(Number(writer![1])).toBe(WRITER_VERSION)
    expect(Number(schema![1])).toBe(SCHEMA_VERSION)
  })

  it('de tabel met dataversies in sectie 7 loopt tot de huidige schrijfversie', () => {
    const m = /`minWriterVersion` 2 … (\d+)/.exec(kaart)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(WRITER_VERSION)
  })

  it('ARCHITECTUUR.md is alleen nog een verwijzing naar de kaart', () => {
    const arch = readFileSync(new URL('../docs/ARCHITECTUUR.md', import.meta.url), 'utf8')
    expect(arch).toContain('app-kaart.md')
    expect(arch.split('\n').length).toBeLessThan(20)
  })
})
