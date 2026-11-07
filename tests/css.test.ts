import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// De stylesheets zijn één plat bestand: elke regel staat op het hoogste niveau of in een at-regel (@media, @supports,
// @keyframes). Een vergeten `}` maakt van de regels erna stil geneste regels (CSS nesting), die dan nergens meer gelden:
// zo stonden de bedragen in de agenda in november 2026 groot en op de verkeerde plek.

function problems(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
  const stack: string[] = []
  const out: string[] = []
  let buffer = ''
  for (const ch of text) {
    if (ch === '{') {
      const selector = buffer.trim()
      const parent = stack.at(-1)
      if (parent !== undefined && !parent.startsWith('@') && !selector.startsWith('@')) out.push(`genest: ${selector} in ${parent}`)
      stack.push(selector)
      buffer = ''
    } else if (ch === '}') {
      if (stack.pop() === undefined) out.push('een } te veel')
      buffer = ''
    } else if (ch === ';') buffer = ''
    else buffer += ch
  }
  if (stack.length > 0) out.push(`niet gesloten: ${stack.join(' > ')}`)
  return out
}

describe('stylesheets', () => {
  it.each(['src/app.css', 'src/splash.css'])('%s: accolades kloppen, geen per ongeluk geneste regels', (path) => {
    expect(problems(readFileSync(path, 'utf8'))).toEqual([])
  })

  it('vindt een vergeten }', () => {
    expect(problems('.a { color: red;\n.b { color: blue; }')).toEqual(['genest: .b in .a', 'niet gesloten: .a'])
  })
})
