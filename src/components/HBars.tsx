// Liggende staven in eigen SVG voor een verdeling (per rol, per boot, per gast): naam en waarde op één regel, de staaf
// eronder, de grootste over de volle breedte. Kleuren uit app.css (.hbar-track, .hbar-fill), zodat licht en donker
// vanzelf kloppen; geen inline styles (CSP).

export interface HBarRow {
  key: string
  label: string
  value: number
}

export function HBars({ rows, format, label }: { rows: HBarRow[]; format: (n: number) => string; label: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-value">{format(r.value)}</span>
          <svg className="hbar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
            <rect className="hbar-track" x={0} y={0} width={100} height={4} rx={2} />
            <rect className="hbar-fill" x={0} y={0} width={max > 0 ? Math.max(1, (r.value / max) * 100) : 0} height={4} rx={2} />
          </svg>
        </li>
      ))}
    </ul>
  )
}
