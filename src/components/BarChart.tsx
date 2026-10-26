// Kleine staafgrafiek in eigen SVG, zonder bibliotheek. Eén of twee reeksen per groep (bijvoorbeeld inkomsten en
// kosten). Kleuren komen uit app.css (.bar-1, .bar-2), zodat licht en donker vanzelf kloppen.

export interface ChartGroup {
  key: string
  /** Korte as-tekst, bijvoorbeeld "okt" of "12 mei". */
  label: string
  values: number[]
}

const WIDTH = 320

export function BarChart({
  groups,
  label,
  format,
  height = 132,
  labelEvery = 1,
  compact = false,
}: {
  groups: ChartGroup[]
  /** Beschrijving voor schermlezers. */
  label: string
  /** Notatie van de hoogste waarde (as-tekst linksboven). */
  format: (n: number) => string
  height?: number
  /** Toon elke n-de as-tekst, zodat smalle groepen niet overlappen. De laatste staat er altijd. */
  labelEvery?: number
  /** Klein grafiekje op een kaart: geen as-teksten, alleen de staven. */
  compact?: boolean
}) {
  const TOP = compact ? 2 : 16
  const BOTTOM = compact ? 2 : 18
  const series = Math.max(1, ...groups.map((g) => g.values.length))
  const max = Math.max(0, ...groups.flatMap((g) => g.values))
  const plot = height - TOP - BOTTOM
  const groupWidth = WIDTH / Math.max(1, groups.length)
  const gap = Math.min(6, groupWidth * 0.25)
  const barWidth = Math.max(2, (groupWidth - gap * 2) / series)
  const scale = max > 0 ? plot / max : 0
  const baseline = TOP + plot

  return (
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      {max > 0 && !compact && (
        <>
          <line className="grid-line" x1={0} x2={WIDTH} y1={TOP} y2={TOP} />
          <text x={0} y={TOP - 5}>
            {format(max)}
          </text>
        </>
      )}
      {!compact && <line className="axis" x1={0} x2={WIDTH} y1={baseline} y2={baseline} />}
      {groups.map((g, i) => {
        const x0 = i * groupWidth + gap
        const showLabel = (groups.length - 1 - i) % labelEvery === 0
        return (
          <g key={g.key}>
            {g.values.map((v, s) => {
              const h = v > 0 ? Math.max(2, v * scale) : 2
              return (
                <rect
                  key={s}
                  className={v > 0 ? `bar-${s + 1}` : 'bar-empty'}
                  x={x0 + s * barWidth + (series > 1 ? 0.5 : 0)}
                  y={baseline - h}
                  width={Math.max(1, barWidth - (series > 1 ? 1 : 0))}
                  height={h}
                  rx={Math.min(3, barWidth / 2)}
                />
              )
            })}
            {showLabel && !compact && (
              <text x={i * groupWidth + groupWidth / 2} y={height - 4} textAnchor="middle">
                {g.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
