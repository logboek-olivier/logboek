// Kleine XML-lezer voor de onderdelen van een .xlsx (workbook, sharedStrings, styles, werkbladen).
// Geen DTD's, geen externe entiteiten: alleen elementen, attributen, tekst, CDATA en de vijf standaardentiteiten.

export interface XmlElement {
  /** Naam zonder voorvoegsel: `x:row` wordt `row`. */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export type XmlNode = XmlElement | string

export class XmlError extends Error {
  constructor() {
    super('XML niet leesbaar')
    this.name = 'XmlError'
  }
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] }
  const stack: XmlElement[] = [root]
  let i = 0
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt < 0) {
      pushText(stack, text.slice(i))
      break
    }
    if (lt > i) pushText(stack, text.slice(i, lt))
    if (text.startsWith('<?', lt)) {
      i = after(text, '?>', lt)
    } else if (text.startsWith('<!--', lt)) {
      i = after(text, '-->', lt)
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt)
      if (end < 0) throw new XmlError()
      top(stack).children.push(text.slice(lt + 9, end))
      i = end + 3
    } else if (text.startsWith('<!', lt)) {
      // DOCTYPE met interne definities hoort niet in een xlsx; weigeren in plaats van half lezen.
      const end = text.indexOf('>', lt)
      if (end < 0 || text.slice(lt, end).includes('[')) throw new XmlError()
      i = end + 1
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt)
      if (end < 0) throw new XmlError()
      const name = localName(text.slice(lt + 2, end).trim())
      const open = stack.pop()
      if (!open || open === root || open.name !== name) throw new XmlError()
      i = end + 1
    } else {
      const end = tagEnd(text, lt)
      let inner = text.slice(lt + 1, end)
      const selfClosing = inner.endsWith('/')
      if (selfClosing) inner = inner.slice(0, -1)
      const space = inner.search(/\s/)
      const rawName = space < 0 ? inner : inner.slice(0, space)
      if (rawName === '') throw new XmlError()
      const attrs: Record<string, string> = {}
      if (space >= 0) {
        for (const m of inner.slice(space).matchAll(ATTR)) attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '')
      }
      const element: XmlElement = { name: localName(rawName), attrs, children: [] }
      top(stack).children.push(element)
      if (!selfClosing) stack.push(element)
      i = end + 1
    }
  }
  if (stack.length !== 1) throw new XmlError()
  const first = root.children.find((c): c is XmlElement => typeof c !== 'string')
  if (!first) throw new XmlError()
  return first
}

/** Direct onderliggende elementen met deze naam. */
export function childElements(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== 'string' && c.name === name)
}

export function child(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0]
}

/** Attribuut op naam zonder voorvoegsel: `attr(el, 'id')` vindt ook `r:id`. */
export function attr(el: XmlElement, name: string): string | undefined {
  if (name in el.attrs) return el.attrs[name]
  const key = Object.keys(el.attrs).find((k) => k.endsWith(`:${name}`))
  return key === undefined ? undefined : el.attrs[key]
}

/** Alle tekst onder een element; `skip` slaat elementen met die namen over (bijvoorbeeld fonetische hulptekst). */
export function textContent(el: XmlElement, skip: readonly string[] = []): string {
  let out = ''
  for (const c of el.children) {
    if (typeof c === 'string') out += c
    else if (!skip.includes(c.name)) out += textContent(c, skip)
  }
  return out
}

function top(stack: XmlElement[]): XmlElement {
  return stack[stack.length - 1]!
}

function pushText(stack: XmlElement[], raw: string): void {
  top(stack).children.push(decodeEntities(raw))
}

function after(text: string, token: string, from: number): number {
  const end = text.indexOf(token, from)
  if (end < 0) throw new XmlError()
  return end + token.length
}

/** Einde van een openingstag; een '>' binnen een attribuutwaarde telt niet. */
function tagEnd(text: string, from: number): number {
  let quote: string | null = null
  for (let j = from + 1; j < text.length; j++) {
    const ch = text[j]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return j
  }
  throw new XmlError()
}

function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(parseInt(body.slice(2), 16)) ?? whole
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10)) ?? whole
    return ENTITIES[body] ?? whole
  })
}

function safeCodePoint(n: number): string | null {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null
}
