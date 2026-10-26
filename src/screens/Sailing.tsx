import { ChevronDown, FileSpreadsheet, LoaderCircle, Pencil, Sailboat, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { BarChart } from '../components/BarChart'
import { LegSheet, TripSheet, type Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateRange, formatHours, formatMonth, formatMonthShort, formatNm, formatNumber } from '../format'
import { recordError } from '../errors'
import { applyImport } from '../import/apply'
import { ImportError, parseMileageFile, type ImportResult } from '../import/mileage-csv'
import { nmPerMonth, summarize, summarizeTrips, totalNm, type SailingSummary, type TripSummary } from '../model/derive'
import { ROLE_LABELS, ROLES, todayIso, type Leg, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import { ErrorLine } from './Setup'

// Zeilen: totalen bovenaan, nm per maand, tochten per maand (nieuwste eerst, uitklapbaar naar dagen), Importeren.

type Editing = { kind: 'leg'; leg: Leg } | { kind: 'trip'; trip: Trip } | null

export function Sailing({ store, notify }: { store: Store; notify: Notify }) {
  const [editing, setEditing] = useState<Editing>(null)
  const legs = useCollection(store, 'legs.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const summary = summarize(legs)
  const tripSummaries = summarizeTrips(trips, legs)
  const months = nmPerMonth(legs, todayIso())

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setReading(true)
    try {
      // Inhoud bepaalt het formaat (CSV of .xlsx), niet de naam of het MIME-type van de bestandskiezer.
      setPending(parseMileageFile(new Uint8Array(await file.arrayBuffer())))
    } catch (e) {
      recordError(e)
      setError(
        e instanceof ImportError
          ? e.message
          : 'Bestand niet leesbaar. Kies het bestand opnieuw, of sla het eerst op het apparaat op.',
      )
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
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
    const previous = legs.filter((l) => l.deletedAt === null && l.source === 'import').length
    const manual = legs.filter((l) => l.deletedAt === null && l.source === 'manual').length
    return (
      <section className="stack">
        <header className="page-header">
          <h1>Controle import</h1>
        </header>
        <p className="muted">
          Vergelijk met de samenvatting in Excel.{' '}
          {previous > 0 ? `Importeren vervangt de ${formatNumber(previous)} eerder geïmporteerde dagen.` : ''}
          {manual > 0 ? ` Zelf toegevoegde dagen (${formatNumber(manual)}) blijven staan.` : ''}
        </p>
        <SummaryGrid summary={pending.summary} />
        {pending.warnings.length > 0 && (
          <>
            <h2>{pending.warnings.length === 1 ? '1 waarschuwing' : `${pending.warnings.length} waarschuwingen`}</h2>
            <ul className="warnings">
              {pending.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
        <div className="stack">
          <button className="btn primary" onClick={() => void confirmImport()} disabled={busy}>
            {busy ? 'Importeren…' : 'Importeren'}
          </button>
          <button className="btn" onClick={() => setPending(null)} disabled={busy}>
            Annuleren
          </button>
        </div>
      </section>
    )
  }

  const importButton = (primary: boolean) => (
    <button
      className={`btn${primary ? ' primary' : ' small quiet'}`}
      onClick={() => fileInput.current?.click()}
      disabled={reading}
    >
      <Icon icon={reading ? LoaderCircle : Upload} className={reading ? 'spin' : ''} />
      {reading ? 'Bestand lezen…' : 'Importeren'}
    </button>
  )

  // Tochten per maand van de laatste dag, nieuwste eerst.
  const groups: { month: string; trips: TripSummary[] }[] = []
  for (const t of tripSummaries) {
    const month = t.endDate.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.month === month) last.trips.push(t)
    else groups.push({ month, trips: [t] })
  }

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>Zeilen</h1>
        {summary.days > 0 && importButton(false)}
      </header>
      {/* Geen accept-filter: Android en Google Drive geven CSV en Excel wisselende MIME-types en grijzen ze dan uit. */}
      <input ref={fileInput} type="file" hidden aria-label="Mijlenbestand" onChange={(e) => void onFile(e.target.files?.[0])} />
      <ErrorLine error={error} />
      {summary.days === 0 && (
        <Empty icon={FileSpreadsheet} action={importButton(true)}>
          Nog geen dagen. Importeer de mijlenregistratie (Excel of CSV), of voeg een dag toe met +.
        </Empty>
      )}
      {summary.days > 0 && (
        <>
          <SummaryGrid summary={summary} />
          <div className="section card card-body">
            <div className="section-head">
              <h2>nm per maand</h2>
              <span className="muted">12 maanden</span>
            </div>
            <BarChart
              label={`Zeemijlen per maand: ${months.map((m) => `${formatMonth(m.month)} ${formatNm(m.nm)}`).join(', ')}`}
              groups={months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), values: [m.nm] }))}
              format={(n) => formatNm(Math.round(n))}
              labelEvery={2}
            />
          </div>
          <div className="section">
            <h2>Tochten</h2>
            {groups.map((g) => (
              <div key={g.month} className="group">
                <h3 className="group-head">
                  <span>{formatMonth(g.month)}</span>
                  <span className="num">{formatNm(g.trips.reduce((n, t) => n + t.nm, 0))}</span>
                </h3>
                <ul className="rows">
                  {g.trips.map((t) => (
                    <TripRow
                      key={t.trip.id}
                      summary={t}
                      onEditTrip={() => setEditing({ kind: 'trip', trip: t.trip })}
                      onEditLeg={(leg) => setEditing({ kind: 'leg', leg })}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {editing?.kind === 'leg' && <LegSheet store={store} leg={editing.leg} onClose={() => setEditing(null)} notify={notify} />}
      {editing?.kind === 'trip' && (
        <TripSheet store={store} trip={editing.trip} onClose={() => setEditing(null)} notify={notify} />
      )}
    </section>
  )
}

export function SummaryGrid({ summary }: { summary: SailingSummary }) {
  const water = summary.nmByWater
  return (
    <dl className="grid grid-3">
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

function TripRow({
  summary,
  onEditTrip,
  onEditLeg,
}: {
  summary: TripSummary
  onEditTrip: () => void
  onEditLeg: (leg: Leg) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className="trip">
      <button className="row-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="row-icon">
          <Icon icon={Sailboat} />
        </span>
        <span className="row-main">
          <span className="row-title">{summary.trip.name}</span>
          <span className="muted">
            {formatDateRange(summary.startDate, summary.endDate)} · {summary.boat} · {summary.days}{' '}
            {summary.days === 1 ? 'dag' : 'dagen'}
          </span>
        </span>
        <span className="row-value">{formatNm(summary.nm)}</span>
        <Icon icon={ChevronDown} className="chevron" />
      </button>
      {open && (
        <ul className="legs">
          {summary.legs.map((leg) => (
            <LegRow key={leg.id} leg={leg} onEdit={() => onEditLeg(leg)} />
          ))}
          <li className="legs-actions">
            <button className="btn small quiet" onClick={onEditTrip}>
              <Icon icon={Pencil} />
              Tocht bewerken
            </button>
          </li>
        </ul>
      )}
    </li>
  )
}

function LegRow({ leg, onEdit }: { leg: Leg; onEdit: () => void }) {
  const water = [leg.nmInland > 0 && 'binnen', leg.nmSea > 0 && 'zee', leg.nmTidal > 0 && 'getij'].filter(Boolean).join(', ')
  return (
    <li className="leg">
      <button
        className="leg-button"
        onClick={onEdit}
        aria-label={`${leg.fromPlace} → ${leg.toPlace}, ${formatDate(leg.date)} · Bewerken`}
      >
        <div className="row-main">
          <span className="row-title">
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
          {water && (
            <span className="muted small">
              <br />
              {water}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
