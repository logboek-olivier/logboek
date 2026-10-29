import { useEffect, useRef } from 'react'

// Notitieveld dat meegroeit met de tekst en prettig is voor inspreken via het toetsenbord (de microfoon van Gboard): een
// tekstvak van drie regels dat meegroeit tot ongeveer tien regels (CSS `field-sizing: content`), met een hoofdletter aan
// het begin van een zin, spellingcontrole en Enter voor een nieuwe regel. Het toetsenbord drukt het veld niet weg: de
// pagina krimpt mee met het toetsenbord (`interactive-widget=resizes-content` in index.html), en bij focus en zolang
// het toetsenbord in- of uitschuift blijft het veld in beeld (visualViewport). Geen inline stijl: alleen klassen uit
// app.css.

export function NoteField({
  label,
  value,
  onChange,
  maxLength = 500,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!el || !viewport) return
    const keepInView = () => {
      if (document.activeElement === el) el.scrollIntoView({ block: 'nearest' })
    }
    viewport.addEventListener('resize', keepInView)
    return () => viewport.removeEventListener('resize', keepInView)
  }, [])

  // Het tellertje pas tegen de grens aan.
  const nearLimit = value.length > maxLength * 0.8

  return (
    <label className="note-field">
      {label}
      <textarea
        ref={ref}
        className="note"
        rows={3}
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck
        enterKeyHint="enter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Na het openen van het toetsenbord (ongeveer 300 ms) het veld nog eens in beeld schuiven.
        onFocus={(e) => {
          const el = e.currentTarget
          window.setTimeout(() => {
            if (document.activeElement === el) el.scrollIntoView({ block: 'nearest' })
          }, 350)
        }}
      />
      {nearLimit && <span className="muted small note-count">{`${value.length}/${maxLength}`}</span>}
    </label>
  )
}
