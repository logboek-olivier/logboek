// Kleine lijngrafiek in eigen SVG, zonder bibliotheek: gemeten tot en met nu doorgetrokken, daarna gestippeld (een
// verwachting). Kleuren komen uit app.css (.line-past, .line-future), zodat licht en donker vanzelf kloppen.

export interface LinePoint {
  key: string
  /** Korte as-tekst, bijvoorbeeld "okt". */
  label: string
  /** Null: geen waarde (geen lijn door dit punt). */
  value: number | null
  future: boolean
}

const WIDTH = 320

export function LineChart({ points, label, format, height = 150, labelEvery = 1 }: { points: LinePoint[]; label: string; format: (n: number) => string; height?: number; labelEvery?: number }) {
  const TOP = 16
  const BOTTOM = 18
  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (values.length === 0) return null
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const plot = height - TOP - BOTTOM
  const step = points.length > 1 ? WIDTH / (points.length - 1) : 0
  const x = (i: number) => (points.length > 1 ? i * step : WIDTH / 2)
  const y = (v: number) => TOP + ((max - v) / span) * plot
  const path = (from: number, to: number) => {
    let d = ''
    for (let i = from; i <= to; i++) {
      const v = points[i]?.value
      if (v === null || v === undefined) continue
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    }
    return d
  }
  const lastPast = points.reduce((n, p, i) => (!p.future ? i : n), -1)
  return (
    <svg className="chart line-chart" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <line className="grid-line" x1={0} x2={WIDTH} y1={TOP} y2={TOP} />
      <text x={0} y={TOP - 5}>
        {format(max)}
      </text>
      {min < 0 && max > 0 && <line className="axis" x1={0} x2={WIDTH} y1={y(0)} y2={y(0)} />}
      {min < 0 && (
        <text x={0} y={height - BOTTOM - 4}>
          {format(min)}
        </text>
      )}
      <path className="line-past" d={path(0, Math.max(0, lastPast))} />
      {lastPast < points.length - 1 && <path className="line-future" d={path(Math.max(0, lastPast), points.length - 1)} />}
      {points.map((p, i) =>
        p.value === null ? null : <circle key={p.key} className={p.future ? 'dot-future' : 'dot-past'} cx={x(i)} cy={y(p.value)} r={i === lastPast ? 3.5 : 2.5} />,
      )}
      {points.map((p, i) =>
        (points.length - 1 - i) % labelEvery === 0 ? (
          <text key={`l-${p.key}`} x={Math.min(WIDTH - 10, Math.max(10, x(i)))} y={height - 4} textAnchor="middle">
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  )
}
