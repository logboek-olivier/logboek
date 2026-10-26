import type { LucideIcon } from 'lucide-react'

// Eén lijndikte en maat voor alle iconen; de maat komt uit --icon in app.css, zodat iconen met hun tekst uitlijnen.

export function Icon({ icon: Glyph, label, className = '' }: { icon: LucideIcon; label?: string; className?: string }) {
  return (
    <Glyph
      className={`icon ${className}`.trim()}
      strokeWidth={1.75}
      absoluteStrokeWidth={false}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  )
}
