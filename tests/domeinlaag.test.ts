import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// De domeinlaag (docs/FUNDERING.md) als regel in de code: alleen een opdracht schrijft. TypeScript dwingt het meeste
// al af (de Store heeft geen put of putMany meer, modelfuncties die schrijven willen een Tx); deze test bewaakt de
// rest: wie een schrijfhandvat of een transactie mag maken, en wie `commit` mag aanroepen.

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) ? [relative(ROOT, path)] : []
  })
}

const files = sources(join(ROOT, 'src')).map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

function using(pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(f.text)).map((f) => f.path).sort()
}

describe('domeinlaag', () => {
  it('alleen commit vraagt een schrijfhandvat aan de Store', () => {
    expect(using(/\.beginWrite\(/)).toEqual(['src/domain/commit.ts'])
  })

  it('alleen commit maakt een transactie', () => {
    expect(using(/new Tx\(/)).toEqual(['src/domain/commit.ts'])
  })

  it('alleen de domeinlaag (en het vullen van de demo) roept commit aan; schermen gebruiken opdrachten', () => {
    const callers = using(/import \{[^}]*\b(commit|run)\b[^}]*\} from '[./]*domain\/commit'/)
    expect(callers.every((path) => path.startsWith('src/domain/') || path === 'src/demo.ts')).toBe(true)
  })

  it('schermen en onderdelen schrijven nooit zelf: geen Tx, geen modelfunctie die schrijft', () => {
    const writers = new Set<string>()
    for (const f of files) {
      if (!/^src\/(model|import|storage)\//.test(f.path)) continue
      for (const m of f.text.matchAll(/export (?:async )?function (\w+)(?:<[^>]*>)?\(\w+: Tx\b/g)) writers.add(m[1]!)
    }
    expect(writers.size).toBeGreaterThan(50)
    const ui = files.filter((f) => /^src\/(screens|components)\//.test(f.path) || /^src\/[^/]+\.tsx?$/.test(f.path))
    const offenders = ui.flatMap((f) => {
      const imported = [...f.text.matchAll(/import \{([^}]*)\} from '[./]*(model|import|storage)\/[^']+'/g)].flatMap((m) => m[1]!.split(',').map((x) => x.trim()))
      return imported.filter((name) => writers.has(name)).map((name) => `${f.path}: ${name}`)
    })
    expect(offenders).toEqual([])
    expect(using(/from '[./]*domain\/tx'/).filter((path) => /^src\/(screens|components)\//.test(path))).toEqual([])
  })

  it('dubbele hulpfuncties voor datums staan alleen in src/basis', () => {
    const defs = using(/function (shiftMonth|addDays|mondayOf|weekStart|lastDay|todayIso|daysBetween|monthEnd|daysInMonth)\b/)
    expect(defs).toEqual(['src/basis/datum.ts'])
  })
})
