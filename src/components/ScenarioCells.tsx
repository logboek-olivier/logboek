import { useState } from 'react'
import { getLang } from '../i18n'
import { amountInput, parseStand } from '../basis/bedrag'

// Velden om in te typen, zoals in een spreadsheet (Geld → Verwacht → Scenario): opslaan bij het verlaten van het veld of
// Enter, alleen als de waarde echt veranderde. Een ongeldige waarde wordt niet opgeslagen en staat rood.

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Een getal: een bedrag (met decimalen, ook negatief als `allowNegative`) of een geheel aantal (`integer`). Leeg = null. */
export function NumberCell({
  label,
  value,
  placeholder,
  integer = false,
  allowNegative = false,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number | null
  placeholder?: string
  integer?: boolean
  allowNegative?: boolean
  min?: number
  max?: number
  onCommit: (value: number | null) => void
}) {
  const shown = (n: number | null) => (n === null ? '' : integer ? String(n) : amountInput(n))
  const [text, setText] = useState(shown(value))
  const [base, setBase] = useState(value)
  // Een nieuwe waarde van buiten (ongedaan maken, een ander apparaat) komt in het veld zolang er niet getypt wordt.
  if (base !== value) {
    setBase(value)
    setText(shown(value))
  }
  const parse = (raw: string): number | null | undefined => {
    if (raw.trim() === '') return null
    const n = integer ? (/^\s*\d+\s*$/.test(raw) ? Number(raw) : undefined) : (parseStand(raw, getLang()) ?? undefined)
    if (n === undefined) return undefined
    if (!allowNegative && n < 0) return undefined
    if (min !== undefined && n < min) return undefined
    if (max !== undefined && n > max) return undefined
    return n
  }
  const parsed = parse(text)
  function commit() {
    if (parsed === undefined || parsed === value) return
    onCommit(parsed)
  }
  return (
    <input
      className="amount cell"
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      aria-label={label}
      aria-invalid={parsed === undefined || undefined}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** Een datum: opslaan zodra er een geldige datum staat (of leeg, als dat mag). */
export function DateCell({ label, value, min, allowEmpty = false, onCommit }: { label: string; value: string; min?: string; allowEmpty?: boolean; onCommit: (value: string) => void }) {
  return (
    <input
      className="cell"
      type="date"
      aria-label={label}
      value={value}
      min={min}
      onChange={(e) => {
        const v = e.target.value
        if (v === value) return
        if ((v === '' && allowEmpty) || (ISO.test(v) && (!min || v >= min))) onCommit(v)
      }}
    />
  )
}
