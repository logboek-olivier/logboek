import { useRef, useState } from 'react'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateRange, formatHours, formatNm, formatNumber } from '../format'
import { applyImport } from '../import/apply'
import { ImportError, parseMileageCsv, type ImportResult } from '../import/mileage-csv'
import { summarize, summarizeTrips, totalNm, type SailingSummary, type TripSummary } from '../model/derive'
import { ROLE_LABELS, ROLES, type Leg } from '../model/types'
import type { Store } from '../storage/store'

// Zeilen: totalen bovenaan, tochten nieuwste eerst (uitklapbaar naar dagen), knop Importeren.

export function Sailing({ store }: { store: Store }) {
  const legs = useCollection(store, 'legs.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const summary = summarize(legs)
  const tripSummaries = summarizeTrips(trips, legs)

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setPending(parseMileageCsv(await file.text()))
    } catch (e) {
      setError(e instanceof ImportError ? e.message : 'Bestand niet leesbaar')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  async function confirmImport() {
    if (!pending) return
    setBusy(true)
    try {
      await applyImport(store, pending)
      setPending(null)
      void store.sync()
    } finally {
      setBusy(false)
    }
  }

  if (pending) {
    return (
      <section className="stack">
        <h1>Controle import</h1>
        <p className="muted">Vergelijk met de samenvatting in Excel. Opslaan vervangt alle eerder geïmporteerde dagen.</p>
        <SummaryGrid summary={pending.summary} />
        {pending.warnings.length > 0 && (
          <ul className="warnings" role="alert">
            {pending.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className="stack">
          <button className="btn primary" onClick={() => void confirmImport()} disabled={busy}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
          <button className="btn" onClick={() => setPending(null)} disabled={busy}>
            Annuleren
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="stack">
      <h1>Zeilen</h1>
      {summary.days > 0 && <SummaryGrid summary={summary} />}
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="CSV-bestand"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button className="btn" onClick={() => fileInput.current?.click()}>
        Importeren
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tripSummaries.length === 0 && summary.days === 0 && (
        <p className="muted">Nog geen dagen. Importeer de mijlenregistratie of voeg een dag toe.</p>
      )}
      <ul className="list">
        {tripSummaries.map((t) => (
          <TripRow key={t.trip.id} summary={t} />
        ))}
      </ul>
    </section>
  )
}

export function SummaryGrid({ summary }: { summary: SailingSummary }) {
  const water = summary.nmByWater
  return (
    <dl className="grid">
      <Stat label="Totaal" value={formatNm(summary.nm)} />
      <Stat label="Dagen" value={formatNumber(summary.days)} />
      <Stat label="Tochten" value={formatNumber(summary.trips)} />
      <Stat label="Nachturen" value={formatHours(summary.nightHours)} />
      {ROLES.filter((r) => summary.nmByRole[r] > 0).map((r) => (
        <Stat key={r} label={ROLE_LABELS[r]} value={formatNm(summary.nmByRole[r])} />
      ))}
      <Stat label="Binnenwater" value={formatNm(water.inland)} />
      <Stat label="Zee" value={formatNm(water.sea)} />
      <Stat label="Getijdenwater" value={formatNm(water.tidal)} />
    </dl>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function TripRow({ summary }: { summary: TripSummary }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="card">
      <button className="row-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="row-main">
          <span className="row-title">{summary.trip.name}</span>
          <span className="muted">
            {formatDateRange(summary.startDate, summary.endDate)} · {summary.boat}
          </span>
        </span>
        <span className="row-value">
          {formatNm(summary.nm)}
          <span className="muted"> · {summary.days} {summary.days === 1 ? 'dag' : 'dagen'}</span>
        </span>
      </button>
      {open && (
        <ul className="legs">
          {summary.legs.map((leg) => (
            <LegRow key={leg.id} leg={leg} />
          ))}
        </ul>
      )}
    </li>
  )
}

function LegRow({ leg }: { leg: Leg }) {
  const water = [leg.nmInland > 0 && 'binnen', leg.nmSea > 0 && 'zee', leg.nmTidal > 0 && 'getij'].filter(Boolean).join(', ')
  return (
    <li className="leg">
      <div className="row-main">
        <span>
          {leg.fromPlace} → {leg.toPlace}
        </span>
        <span className="muted">
          {formatDate(leg.date)}
          {leg.dateEstimated ? ' (geschat)' : ''} · {ROLE_LABELS[leg.role]}
          {leg.windBft ? ` · ${leg.windBft} bft` : ''}
          {leg.nightHours > 0 ? ` · ${formatHours(leg.nightHours)} nacht` : ''}
        </span>
        {leg.notes && <span className="muted">{leg.notes}</span>}
      </div>
      <span className="row-value">
        {formatNm(totalNm(leg))}
        {water && <span className="muted"> · {water}</span>}
      </span>
    </li>
  )
}
